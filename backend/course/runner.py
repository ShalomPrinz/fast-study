"""Course-level overview orchestrator: phase boundaries live here, the work lives in the
phase modules. Mirrors pipeline/runner.py but is keyed by (course, slug).

Each 'generate' trigger is one OverviewRun owning its selection and transcript sources; status
is NOT run-scoped — runs write into the shared module-level store. See docs/OVERVIEW.md for the
lock/collision/failure-isolation model."""
import asyncio

from course import analyze, collect, extract, overview, to_pdf
from course.overview import Phase
from services import db_client

# Per-(course, slug); created lazily via setdefault, persists across runs so same-slug triggers serialize.
_locks: dict[tuple[str, str], asyncio.Lock] = {}
# course → { slug → entry }; entry = {"status", "phase"?, "message"?}. The lock-holder is the only
# writer of a given slug's entry; survives after the run finishes so `get_status` can read it.
_status: dict[str, dict[str, dict]] = {}


def get_status(course: str) -> dict:
    """Aggregate the shared per-slug store for a course; `running` is derived from the entries."""

    entries = _status.get(course, {})
    return {
        "running": any(e.get("status") == "running" for e in entries.values()),
        "extractors": entries,
    }

def resolve_slugs(csv: str | None) -> tuple[list[str], str | None]:
    """Parse the optional `extractors` CSV into extractor slugs (default: all)."""

    if not csv:
        return overview.ALL_SLUGS, None
    slugs = [s.strip() for s in csv.split(",") if s.strip()]
    unknown = [s for s in slugs if s not in overview.EXTRACTORS_BY_SLUG]
    if unknown:
        return slugs, f"unknown extractor(s): {', '.join(unknown)}"
    return slugs, None


def resolve_from_phase(from_phase: str | None) -> tuple[Phase | None, str | None]:
    """Parse the optional from_phase id into a Phase (None = full chain / not provided)."""

    if from_phase is None:
        return None, None
    phase = Phase.from_id(from_phase)
    if phase is None:
        return None, f"unknown phase: {from_phase}"
    return phase, None


def try_run_generate(course: str, course_node: dict, slugs: list[str],
                     from_phase: "Phase | None" = None, skip_existing: bool = False) -> str:
    """Schedule an overview run over `slugs`, seeding pending status synchronously so the first
    poll sees it. Returns "busy" iff every requested slug's lock is already held."""

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
    """One overview 'generate' trigger: owns the run-scoped selection and the transcript sources,
    and walks the slugs one at a time, each running its full phase chain under its own lock."""

    def __init__(self, course: str, course_node: dict, slugs: list[str],
                 from_phase: "Phase | None", skip_existing: bool):
        self.course = course
        self.course_node = course_node
        self.slugs = slugs
        self.from_phase = from_phase
        self.skip_existing = skip_existing
        self._sources = None  # in-memory, filled on first `sources` access

    @property
    def sources(self):
        """Every transcript, fetched once on first access and reused for the whole run."""

        if self._sources is None:
            self._sources = extract.fetch_sources(self.course, self.course_node)
        return self._sources

    async def execute(self) -> None:
        """Walk the selected slugs in declaration order, running each one's phase chain under its
        own lock. One slug's failure stops only its own remaining phases."""

        # Snapshot the overview dir once at run start (continue mode reads only this snapshot).
        existing = self._existing_outputs() if self.skip_existing else set()
        for slug in self.slugs:
            extractor = overview.EXTRACTORS_BY_SLUG[slug]
            lock = _locks.setdefault((self.course, slug), asyncio.Lock())
            # An un-held asyncio.Lock acquires without yielding, so with no await between this
            # check and the `async with` below, skip-on-collision is atomic.
            if lock.locked():
                continue  # another run owns this slug right now — skip, don't touch its entry
            async with lock:
                for phase in extractor.phases_from(self.from_phase):
                    self._set_phase(slug, phase)

                    # Continue mode: keep an output already on disk at run start.
                    if self.skip_existing and extractor.output_file(phase) in existing:
                        self._mark_kept(slug)
                        db_client.notify()
                        continue

                    if await asyncio.to_thread(self._run_slug_phase, slug, phase):
                        break  # slug errored: stop its chain, the other slugs go on
        db_client.notify()

    def _existing_outputs(self) -> set[str]:
        """Snapshot the course's overview output filenames."""

        return {f["name"] for f in db_client.list_overview_files(self.course)}

    def _entry(self, slug: str) -> dict:
        """The shared status entry for this run's slug, created on demand."""

        return _status.setdefault(self.course, {}).setdefault(slug, {})

    def _set_phase(self, slug: str, phase: Phase) -> None:
        """Mark the slug's current phase in the shared store as the STRING `phase.id` —
        a Phase object must never reach the JSON-serialized store."""

        self._entry(slug)["phase"] = phase.id

    def _mark_kept(self, slug: str) -> None:
        """A kept (already-on-disk) participant: non-error status, keeping the stamped phase."""

        self._entry(slug).update({"status": "skipped", "message": "already generated"})

    def _run_slug_phase(self, slug: str, phase: Phase) -> bool:
        """Run one (slug, phase) worker and fold its result into the shared entry; returns True
        if it raised, so the caller stops that slug's chain."""

        entries = _status.setdefault(self.course, {})
        # Fresh dict so a prior phase's message can't linger, but `phase` is carried across the
        # running→result transition so the UI's per-step spinner stays correct.
        entries[slug] = {"status": "running", "phase": phase.id}
        try:
            entries[slug] = {**self._phase_worker(slug, phase), "phase": phase.id}
            errored = False
        except Exception as e:
            entries[slug] = {"status": "error", "message": str(e), "phase": phase.id}
            errored = True
        finally:
            db_client.notify()
        return errored

    def _phase_worker(self, slug: str, phase: Phase) -> dict:
        """Dispatch one (slug, phase) to its worker. Dispatch lives here, not in the registry —
        the workers import `overview` back, so a worker import there would cycle."""

        extractor = overview.EXTRACTORS_BY_SLUG[slug]
        if phase is Phase.EXTRACT:
            return extract.run_extractor(self.course, extractor, self.sources)
        if phase is Phase.ANALYZE:
            return analyze.run_analyze(self.course, extractor)
        if phase is Phase.TOPICS:
            # topics ignores the slug: it distills every summary into one topics.md.
            return collect.run_collect(self.course, self.course_node)
        if phase is Phase.TO_PDF:
            return to_pdf.run_to_pdf(self.course, slug)
        raise ValueError(f"unknown phase: {phase}")
