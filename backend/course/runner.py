"""Course-level overview orchestrator. Phase boundaries live here, while actual work in separate modules.
Mirrors the per-lecture `pipeline/runner.py`, but keyed by (course, slug).

Each 'generate' trigger is one `OverviewRun` instance: the run owns its selection (slugs, from_phase,
skip_existing) and the transcript `sources` (fetched ONCE, lazily, memoized on the instance), but it
does NOT own status — it WRITES its slug entries into the shared per-(course, slug) `_status` store.
The run is SLUG-BY-SLUG: the outer loop walks the selected extractors in declaration order and, for
each, acquires that slug's OWN lock, runs its phase chain (from `from_phase` through to_pdf) to
completion, then releases the lock before the next slug. Because a run only ever holds the CURRENT
slug's lock, a SEPARATE trigger can run a DIFFERENT slug of the same course fully in parallel — "let
the user lead". Same slug + same course serialize on the (course, slug) lock; same slug in different
courses run in parallel for free (different keys).

Collision rule = "first-come keeps it, other skips": when a run reaches a slug whose (course, slug)
lock is already held by ANOTHER run, it SKIPS that slug and does NOT touch its status entry (the
lock-holder owns that entry). No waiting, no double work, no clobber.

Module-level state: `_locks` (per-(course, slug), persists across runs to serialize same-slug triggers)
and `_status` (course → {slug → entry}; the shared store the runs write into, survives after a run
finishes so `get_status` reads it)."""

import asyncio

from course import analyze, collect, extract, overview, to_pdf
from services import db_client

# Per-(course, slug); created lazily via setdefault, persists across runs so same-slug triggers serialize.
_locks: dict[tuple[str, str], asyncio.Lock] = {}
# course → { slug → entry }; entry = {"status", "phase"?, "message"?}. The lock-holder is the only
# writer of a given slug's entry; survives after the run finishes so `get_status` can read it.
_status: dict[str, dict[str, dict]] = {}


def get_status(course: str) -> dict:
    """Aggregate the shared per-slug store for a course. `running` is DERIVED (any entry running);
    unknown/never-run course → the empty shape."""
    entries = _status.get(course, {})
    return {
        "running": any(e.get("status") == "running" for e in entries.values()),
        "extractors": entries,
    }

def resolve_slugs(csv: str | None) -> tuple[list[str], str | None]:
    """Parse the optional `extractors` CSV into extractor slugs (default: all)."""
    # default - all extractors
    if not csv:
        return overview.ALL_SLUGS, None

    # parse slugs from csv
    slugs = [s.strip() for s in csv.split(",") if s.strip()]
    unknown = [s for s in slugs if s not in overview.EXTRACTORS_BY_SLUG]
    if unknown:
        return slugs, f"unknown extractor(s): {', '.join(unknown)}"
    return slugs, None


def resolve_from_phase(from_phase: str | None) -> tuple[overview.Phase | None, str | None]:
    """Parse the optional from_phase id into a Phase (None = full chain / not provided)."""
    if from_phase is None:
        return None, None
    phase = overview.Phase.from_id(from_phase)
    if phase is None:
        return None, f"unknown phase: {from_phase}"
    return phase, None


def try_run_generate(course: str, course_node: dict, slugs: list[str],
                     from_phase: "overview.Phase | None" = None, skip_existing: bool = False) -> str:
    """Schedule an overview run over `slugs` (slug-by-slug, each under its own (course, slug) lock).
    Seeds pending status synchronously so the first poll sees the run — but only for slugs NOT already
    in flight under another run (never clobber a live entry). Returns "busy" iff EVERY requested slug's
    lock is currently held (nothing new to start), else "started"."""
    entries = _status.setdefault(course, {})
    seeded_any = False
    for slug in slugs:
        lock = _locks.get((course, slug))
        if lock is not None and lock.locked():
            continue  # another run is actively driving this slug — leave its entry alone
        entries[slug] = {"status": "pending"}
        seeded_any = True
    if not seeded_any:
        return "busy"  # all requested slugs already in flight
    run = OverviewRun(course, course_node, slugs, from_phase, skip_existing)
    asyncio.create_task(run.execute())
    return "started"


class OverviewRun:
    """One overview 'generate' trigger. Owns run-scoped selection (slugs, from_phase, skip_existing)
    and the transcript `sources` (fetched ONCE, lazily, the first time any slug enters extract, then
    reused for the whole run). Does NOT own status — it writes its slug entries into the shared
    `_status[course]` store, and only for slugs whose (course, slug) lock IT holds. Sequences the
    slugs SLUG-BY-SLUG (declaration order): each extractor runs its own phase chain from `from_phase`
    through to_pdf under its own lock before the next starts."""

    def __init__(self, course: str, course_node: dict, slugs: list[str],
                 from_phase: "overview.Phase | None", skip_existing: bool):
        self.course = course
        self.course_node = course_node
        self.slugs = slugs
        self.from_phase = from_phase
        self.skip_existing = skip_existing
        self._sources = None  # in-memory, filled on first `sources` access

    @property
    def sources(self):
        # Fetch every transcript once, then reuse for every pattern extractor.
        if self._sources is None:
            self._sources = extract.fetch_sources(self.course, self.course_node)
        return self._sources

    async def execute(self) -> None:
        """Walk the selected slugs in declaration order. For each, grab its OWN (course, slug) lock and
        run its phase chain from `from_phase` through to_pdf; earlier phases are skipped (files kept).
        One slug's failure stops only its own remaining phases — the next slug still runs. With
        `skip_existing`, a phase whose output already existed at run start is kept (not re-run)."""
        # Snapshot the overview dir once at run start (continue mode reads only this snapshot).
        existing = self._existing_outputs() if self.skip_existing else set()
        for slug in self.slugs:
            extractor = overview.EXTRACTORS_BY_SLUG[slug]
            lock = _locks.setdefault((self.course, slug), asyncio.Lock())
            # Acquiring an un-held asyncio.Lock completes WITHOUT yielding to the event loop (CPython
            # sets _locked=True and returns immediately when there are no waiters), so between this
            # `locked()` check being False and entering `async with` below no other task can grab it —
            # as long as there is NO await in between. That makes skip-on-collision atomic vs. the check.
            if lock.locked():
                continue  # another run owns this slug right now — skip, don't touch its entry
            async with lock:
                for phase in extractor.phases_from(self.from_phase):
                    self._set_phase(slug, phase)

                    # continue mode: keep an output already on disk at run start; run the rest normally.
                    if self.skip_existing and extractor.output_file(phase) in existing:
                        self._mark_kept(slug)
                        db_client.notify()
                        continue

                    if await asyncio.to_thread(self._run_slug_phase, slug, phase):
                        break  # slug errored: stop its chain (don't run to_pdf on a failed analyze); others go on
        # No global running flag to clear — get_status derives it. Notify so the UI refreshes at run end.
        db_client.notify()

    def _existing_outputs(self) -> set[str]:
        """Snapshot the course's overview output filenames."""
        return {f["name"] for f in db_client.list_overview_files(self.course)}

    def _entry(self, slug: str) -> dict:
        """The shared status entry for this run's slug (created on demand under the store's course dict)."""
        return _status.setdefault(self.course, {}).setdefault(slug, {})

    def _set_phase(self, slug: str, phase: overview.Phase) -> None:
        """Mark the slug's current phase in the shared store (creates the entry if needed).
        Stores the STRING `phase.id` — a Phase object must never reach the JSON-serialized store."""
        self._entry(slug)["phase"] = phase.id

    def _mark_kept(self, slug: str) -> None:
        """A kept (already-on-disk) participant: non-error status; keeps the phase _set_phase stamped."""
        self._entry(slug).update({"status": "skipped", "message": "already generated"})

    def _run_slug_phase(self, slug: str, phase: overview.Phase) -> bool:
        """Run one extractor's single phase in a worker thread: mark running, run its worker, fold the
        result dict into the shared entry, notify. Returns True if it raised (caller stops the chain).
        Keeps `phase` on the entry across the running→result transition so the UI's per-step spinner
        stays correct; a fresh dict on running so a prior phase's message can't linger. The stored
        `phase` is always the STRING `phase.id` — the store is serialized straight to JSON."""
        entries = _status.setdefault(self.course, {})
        entries[slug] = {"status": "running", "phase": phase.id}  # fresh dict, phase preserved
        try:
            entries[slug] = {**self._phase_worker(slug, phase), "phase": phase.id}
            errored = False
        except Exception as e:
            entries[slug] = {"status": "error", "message": str(e), "phase": phase.id}
            errored = True
        finally:
            db_client.notify()
        return errored

    def _phase_worker(self, slug: str, phase: overview.Phase) -> dict:
        """Dispatch one (slug, phase) to its worker; each returns a "done"/"skipped" status dict.
        The phase list comes from each `Extractor.phases`; dispatch stays here (importing the worker
        modules that import `overview` back would be a cycle)."""
        extractor = overview.EXTRACTORS_BY_SLUG[slug]
        if phase is overview.Phase.EXTRACT:
            return extract.run_extractor(self.course, extractor, self.sources)
        if phase is overview.Phase.ANALYZE:
            return analyze.run_analyze(self.course, extractor)
        if phase is overview.Phase.TOPICS:
            # topics ignores the slug: it distills every lecture/recitation summary into topics.md.
            return collect.run_collect(self.course, self.course_node)
        if phase is overview.Phase.TO_PDF:
            return to_pdf.run_to_pdf(self.course, slug)
        raise ValueError(f"unknown phase: {phase}")
