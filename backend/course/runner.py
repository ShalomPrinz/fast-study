"""Course-level overview orchestrator. Phase boundaries live here, while actual work in separate modules.
Mirrors the per-lecture `pipeline/runner.py`, but keyed by course alone."""

import asyncio
from datetime import datetime, timezone

from course import analyze, collect, extract, overview, to_pdf
from services import db_client

# One lock per course
_locks: dict[str, asyncio.Lock] = {}   # per-course; created lazily via setdefault
_status: dict[str, dict] = {}          # course → latest run's status (survives after the run)

_EMPTY_STATUS = {"running": False, "phase": None, "started_at": None, "extractors": {}}

PHASE_ORDER = ("extract", "analyze", "topics", "to_pdf")
DEFAULT_FROM_PHASE = PHASE_ORDER[0]


def get_status(course: str) -> dict:
    """Status of the latest overview run; the never-run shape for unknown courses."""
    return _status.get(course, _EMPTY_STATUS)

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


def _participants(phase: str, slugs: list[str]) -> list[str]:
    """Slugs whose extractor declares `phase` — only they run/reset in it."""
    return [s for s in slugs if phase in overview.EXTRACTORS_BY_SLUG[s].phases]


def try_run_generate(course: str, course_node: dict, slugs: list[str], from_phase: str = DEFAULT_FROM_PHASE) -> str:
    """Run all 'slugs' course overview sequentially in the background, starting from `from_phase`."""
    lock = _locks.setdefault(course, asyncio.Lock())
    if lock.locked():
        return "busy"
    # Status must be installed before the task is scheduled so the first poll sees the run.
    _status[course] = _new_run(from_phase, slugs)
    asyncio.create_task(_run_generate(lock, course, course_node, slugs, from_phase))
    return "started"


def _start_index(from_phase: str) -> int:
    """Phase index of PHASE_ORDER to start from."""
    return PHASE_ORDER.index(from_phase) if from_phase in PHASE_ORDER else 0


def _new_run(from_phase: str, slugs: list[str]) -> dict:
    start = _start_index(from_phase)
    phase = next((p for p in PHASE_ORDER[start:] if _participants(p, slugs)), from_phase)
    return {
        "running": True,
        "phase": phase,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "extractors": {s: {"status": "pending"} for s in slugs},
    }


async def _run_generate(lock: asyncio.Lock, course: str, course_node: dict, slugs: list[str], from_phase: str) -> None:
    """Hold the course lock across all phases so nothing else runs in between. Skips phases before
    `from_phase`, and any phase with no participating extractor (no phase-advance, no notify, no work)."""
    start = _start_index(from_phase)
    workers = {
        "extract": lambda ps: _extract_phase(course, course_node, ps),
        "analyze": lambda ps: _analyze_phase(course, ps),
        "topics":  lambda ps: _topics_phase(course, course_node, ps),
        "to_pdf":  lambda ps: _to_pdf_phase(course, ps),
    }
    async with lock:
        try:
            first = True
            for phase in PHASE_ORDER[start:]:
                if not _participants(phase, slugs):
                    continue  # no extractor declares this phase → skip entirely (no advance/notify/work)
                # Drop extractors that errored earlier; keep their "error" visible (never a downstream skip).
                survivors = [s for s in _participants(phase, slugs)
                             if _status[course]["extractors"][s].get("status") != "error"]
                if not first:
                    _advance_phase(course, phase, survivors)
                first = False
                if survivors:
                    await asyncio.to_thread(workers[phase], survivors)
        finally:
            _status[course]["running"] = False
            db_client.notify()


def _advance_phase(course: str, phase: str, participants: list[str]) -> None:
    """Phase boundary: switch phase, reset each participant to pending, and ping."""
    status = _status[course]
    status["phase"] = phase
    for s in participants:
        status["extractors"][s] = {"status": "pending"}
    db_client.notify()


def _run_phase(course: str, slugs: list[str], process) -> None:
    """Loop the per-extractor work of one phase: mark running, run `process(slug)`, ping per phase."""
    status = _status[course]
    for slug in slugs:
        entry_status = status["extractors"][slug]
        entry_status["status"] = "running"
        try:
            entry_status.update(process(slug))
        except Exception as e:
            entry_status.update({"status": "error", "message": str(e)})
        finally:
            db_client.notify()


def _extract_phase(course: str, course_node: dict, slugs: list[str]) -> None:
    """Extraction: fetch every transcript once, then run each selected extractor."""
    sources = extract.fetch_sources(course, course_node)
    _run_phase(course, slugs,
               lambda slug: extract.run_extractor(course, overview.EXTRACTORS_BY_SLUG[slug], sources))


def _analyze_phase(course: str, slugs: list[str]) -> None:
    """Analysis: per extractor, read {slug}.txt and send it to an LLM."""
    _run_phase(course, slugs,
               lambda slug: analyze.run_analyze(course, overview.EXTRACTORS_BY_SLUG[slug]))


def _topics_phase(course: str, course_node: dict, slugs: list[str]) -> None:
    """Topics: collect every lecture/recitation summary into topics.md (one immediate extractor)."""
    _run_phase(course, slugs, lambda _: collect.run_collect(course, course_node))


def _to_pdf_phase(course: str, slugs: list[str]) -> None:
    """PDF render: per extractor, render {slug}.md to {slug}.pdf."""
    _run_phase(course, slugs, lambda slug: to_pdf.run_to_pdf(course, slug))
