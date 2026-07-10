"""Course-level overview orchestrator. Phase boundaries live here, while actual work in separate modules.
Mirrors the per-lecture `pipeline/runner.py`, but keyed by course alone.

Each 'generate' trigger is one `OverviewRun` instance: the run owns all its state as instance data —
the selected slugs, from_phase, skip_existing, this run's live `status` dict, and the transcript
`sources` (fetched ONCE, lazily, memoized on the instance instead of threaded through a cache dict).
The run is SLUG-BY-SLUG: the outer loop walks the selected extractors in declaration order and, for
each, runs its own phase chain (from `from_phase` through to_pdf) to completion before the next
extractor starts. Net effect: the first extractor's PDF is ready before the others begin. `status`
keeps a single global `phase` = the currently-active slug's phase (so it naturally moves back to
`extract` each time a new pattern slug begins — the frontend handles that).

Module-level state: `_locks` (per-course, persists across runs to serialize triggers) and `_runs`
(course → latest run; the registry keeps the reference so its `status` stays queryable after the run
finishes)."""

import asyncio
from datetime import datetime, timezone

from course import analyze, collect, extract, overview, to_pdf
from services import db_client

# One lock per course
_locks: dict[str, asyncio.Lock] = {}      # per-course; created lazily via setdefault, persists across runs
_runs: dict[str, "OverviewRun"] = {}      # course → latest run; its .status survives after completion

_EMPTY_STATUS = {"running": False, "phase": None, "started_at": None, "extractors": {}}

PHASE_ORDER = ("extract", "analyze", "topics", "to_pdf")
DEFAULT_FROM_PHASE = PHASE_ORDER[0]
_PHASE_SUFFIX = {"extract": ".txt", "analyze": ".md", "topics": ".md", "to_pdf": ".pdf"}


def get_status(course: str) -> dict:
    """Status of the latest overview run; the never-run shape for unknown courses."""
    run = _runs.get(course)
    return run.status if run else _EMPTY_STATUS

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


def try_run_generate(course: str, course_node: dict, slugs: list[str],
                     from_phase: str = DEFAULT_FROM_PHASE, skip_existing: bool = False) -> str:
    """Run all 'slugs' course overview sequentially in the background, starting from `from_phase`.
    With `skip_existing`, any phase output already on disk at run start is kept."""
    lock = _locks.setdefault(course, asyncio.Lock())
    if lock.locked():
        return "busy"
    run = OverviewRun(course, course_node, slugs, from_phase, skip_existing)
    # Install before scheduling so the first poll sees the run.
    _runs[course] = run
    asyncio.create_task(run.execute(lock))
    return "started"


def _start_index(from_phase: str) -> int:
    """Phase index of PHASE_ORDER to start from."""
    return PHASE_ORDER.index(from_phase) if from_phase in PHASE_ORDER else 0


class OverviewRun:
    """One overview 'generate' trigger. Created per trigger; owns all run-scoped state — the selected
    slugs, from_phase, skip_existing, this run's live `status` dict, and the transcript `sources`
    (fetched ONCE, lazily, the first time any slug enters extract, then reused for the whole run).
    Sequences the slugs SLUG-BY-SLUG (declaration order) under the course lock: each extractor runs
    its own phase chain from `from_phase` through to_pdf before the next starts."""

    def __init__(self, course: str, course_node: dict, slugs: list[str], from_phase: str, skip_existing: bool):
        self.course = course
        self.course_node = course_node
        self.slugs = slugs
        self.from_phase = from_phase
        self.skip_existing = skip_existing
        self.start = _start_index(from_phase)
        self._sources = None  # in-memory, filled on first `sources` access
        self.status = self._initial_status()

    @property
    def sources(self):
        # Fetch every transcript once, then reuse for every pattern extractor.
        if self._sources is None:
            self._sources = extract.fetch_sources(self.course, self.course_node)
        return self._sources

    def _slug_phases(self, slug: str) -> list[str]:
        """This extractor's declared phases at/after `from_phase`, in PHASE_ORDER order."""
        return [p for p in overview.EXTRACTORS_BY_SLUG[slug].phases if PHASE_ORDER.index(p) >= self.start]

    def _initial_status(self) -> dict:
        # Seed phase from the FIRST slug's first participating phase so the first poll shows a
        # sensible phase (falls back to from_phase when that slug has none at/after start).
        first = self._slug_phases(self.slugs[0]) if self.slugs else []
        phase = first[0] if first else self.from_phase
        return {
            "running": True,
            "phase": phase,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "extractors": {s: {"status": "pending"} for s in self.slugs},
        }

    async def execute(self, lock: asyncio.Lock) -> None:
        """Hold the course lock across every slug so nothing else runs in between. For each slug, run
        its phase chain from `from_phase` through to_pdf; earlier phases are skipped (their files kept).
        One slug's failure stops only its own remaining phases — the next slug still runs. With
        `skip_existing`, a phase whose output already existed at run start is kept (not re-run)."""
        # Snapshot the overview dir once at run start (continue mode reads only this snapshot).
        existing = self._existing_outputs() if self.skip_existing else set()
        async with lock:
            try:
                for slug in self.slugs:
                    for phase in self._slug_phases(slug):
                        self.status["phase"] = phase

                        # continue mode: keep an output already on disk at run start; run the rest normally.
                        if self.skip_existing and f"{slug}{_PHASE_SUFFIX[phase]}" in existing:
                            self._mark_kept(slug)
                            db_client.notify()
                            continue

                        if await asyncio.to_thread(self._run_slug_phase, slug, phase):
                            break  # slug errored: stop its chain (don't run to_pdf on a failed analyze); others go on
            finally:
                self.status["running"] = False
                db_client.notify()

    def _existing_outputs(self) -> set[str]:
        """Snapshot the course's overview output filenames."""
        return {f["name"] for f in db_client.list_overview_files(self.course)}

    def _mark_kept(self, slug: str) -> None:
        """A kept (already-on-disk) participant: non-error status."""
        self.status["extractors"][slug] = {"status": "skipped", "message": "already generated"}

    def _run_slug_phase(self, slug: str, phase: str) -> bool:
        """Run one extractor's single phase in a worker thread: mark running, run its worker, fold the
        result dict into status, notify. Returns True if it raised (caller stops the slug's chain)."""
        self.status["extractors"][slug] = {"status": "running"}  # replace whole dict so a prior phase's message can't linger
        try:
            self.status["extractors"][slug] = self._phase_worker(slug, phase)
            errored = False
        except Exception as e:
            self.status["extractors"][slug] = {"status": "error", "message": str(e)}
            errored = True
        finally:
            db_client.notify()
        return errored

    def _phase_worker(self, slug: str, phase: str) -> dict:
        """Dispatch one (slug, phase) to its worker; each returns a "done"/"skipped" status dict."""
        extractor = overview.EXTRACTORS_BY_SLUG[slug]
        if phase == "extract":
            return extract.run_extractor(self.course, extractor, self.sources)
        if phase == "analyze":
            return analyze.run_analyze(self.course, extractor)
        if phase == "topics":
            # topics ignores the slug: it distills every lecture/recitation summary into topics.md.
            return collect.run_collect(self.course, self.course_node)
        if phase == "to_pdf":
            return to_pdf.run_to_pdf(self.course, slug)
        raise ValueError(f"unknown phase: {phase}")  # unreachable — phases come from PHASE_ORDER
