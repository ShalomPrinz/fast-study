"""Course-level overview orchestrator. Phase boundaries live here, while actual work in separate modules.
Mirrors the per-lecture `pipeline/runner.py`, but keyed by course alone."""

import asyncio
from datetime import datetime, timezone

from course import analyze, extract, overview, to_pdf
from services import db_client

# One lock per course
_locks: dict[str, asyncio.Lock] = {}   # per-course; created lazily via setdefault
_status: dict[str, dict] = {}          # course → latest run's status (survives after the run)

_EMPTY_STATUS = {"running": False, "phase": None, "started_at": None, "extractors": {}}

PHASE_ORDER = ("extract", "analyze", "to_pdf")
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


def try_run_generate(course: str, course_node: dict, slugs: list[str], from_phase: str = DEFAULT_FROM_PHASE) -> str:
    """Run all 'slugs' course overview sequentially in the background, starting from `from_phase`."""
    lock = _locks.setdefault(course, asyncio.Lock())
    if lock.locked():
        return "busy"
    # Status must be installed before the task is scheduled so the first poll sees the run.
    _status[course] = _new_run(from_phase, slugs)
    asyncio.create_task(_run_generate(lock, course, course_node, slugs, from_phase))
    return "started"


def _new_run(phase: str, slugs: list[str]) -> dict:
    return {
        "running": True,
        "phase": phase,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "extractors": {s: {"status": "pending"} for s in slugs},
    }


async def _run_generate(lock: asyncio.Lock, course: str, course_node: dict, slugs: list[str], from_phase: str) -> None:
    """Hold the course lock across all phases so nothing else runs in between. Skips phases before given `from_phase`."""
    start = PHASE_ORDER.index(from_phase)
    workers = {
        "extract": lambda s: _extract_phase(course, course_node, s),
        "analyze": lambda s: _analyze_phase(course, s),
        "to_pdf":  lambda s: _to_pdf_phase(course, s),
    }
    async with lock:
        try:
            for i, phase in enumerate(PHASE_ORDER[start:], start=start):
                if i > start:
                    slugs = _advance_phase(course, phase, slugs)
                await asyncio.to_thread(workers[phase], slugs)
        finally:
            _status[course]["running"] = False
            db_client.notify()


def _advance_phase(course: str, phase: str, slugs: list[str]) -> list[str]:
    """Phase boundary: switch phase, reset each not-yet-errored extractor to pending."""
    status = _status[course]
    status["phase"] = phase
    surviving = [s for s in slugs if status["extractors"][s].get("status") != "error"]
    for s in surviving:
        status["extractors"][s] = {"status": "pending"}
    db_client.notify()
    return surviving


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
    """Analysis: per extractor, read {slug}.txt and send it to Gemini."""
    _run_phase(course, slugs,
               lambda slug: analyze.run_analyze(course, overview.EXTRACTORS_BY_SLUG[slug]))


def _to_pdf_phase(course: str, slugs: list[str]) -> None:
    """PDF render: per extractor, render {slug}.md to {slug}.pdf."""
    _run_phase(course, slugs, lambda slug: to_pdf.run_to_pdf(course, slug))
