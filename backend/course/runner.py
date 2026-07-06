"""Course-level overview execution engine - course overview generation driver.
Mirrors the per-lecture `runner.py` at backend root, but keyed by course alone."""

import asyncio
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from course import overview
from pipeline.to_pdf import convert_to_pdf
from services import db_client

# One lock per course
_locks: dict[str, asyncio.Lock] = {}   # per-course; created lazily via setdefault
_status: dict[str, dict] = {}          # course → latest run's status (survives after the run)

_EMPTY_STATUS = {"running": False, "phase": None, "started_at": None, "extractors": {}}


def get_status(course: str) -> dict:
    """Status of the latest overview run; the never-run shape for unknown courses."""
    return _status.get(course, _EMPTY_STATUS)

def resolve_slugs(csv: str | None) -> tuple[list[str], str | None]:
    """Parse the optional `extractors` CSV into extractor slugs (default: all)."""
    if csv:
        slugs = [s.strip() for s in csv.split(",") if s.strip()]
    else:
        slugs = [e.slug for e in overview.EXTRACTORS]
    unknown = [s for s in slugs if s not in overview.EXTRACTORS_BY_SLUG]
    if unknown:
        return slugs, f"unknown extractor(s): {', '.join(unknown)}"
    return slugs, None


def try_run_generate(course: str, course_node: dict, slugs: list[str]) -> str:
    """Run all 'slugs' course overview sequentially in the background. Returns "started" or "busy"."""
    lock = _locks.setdefault(course, asyncio.Lock())
    if lock.locked():
        return "busy"
    # Status must be installed before the task is scheduled so the first poll sees the run.
    _status[course] = _new_run("extract", slugs)
    asyncio.create_task(_run_generate(lock, course, course_node, slugs))
    return "started"


def _new_run(phase: str, slugs: list[str]) -> dict:
    return {
        "running": True,
        "phase": phase,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "extractors": {s: {"status": "pending"} for s in slugs},
    }


async def _run_generate(lock: asyncio.Lock, course: str, course_node: dict, slugs: list[str]) -> None:
    """Hold the course lock across all phases so nothing else runs in between."""
    async with lock:
        try:
            await asyncio.to_thread(_extract_phase, course, course_node, slugs)
            slugs = _advance_phase(course, "analyze", slugs)
            await asyncio.to_thread(_analyze_phase, course, slugs)
            slugs = _advance_phase(course, "to_pdf", slugs)
            await asyncio.to_thread(_to_pdf_phase, course, slugs)
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


def _extract_phase(course: str, course_node: dict, slugs: list[str]) -> None:
    """Blocking extraction: fetch every transcript once (tree-driven), run each selected
    extractor over all of them, write {slug}.txt per extractor. One extractor's failure
    never aborts the others. `running` is owned by the generate driver, not here."""
    status = _status[course]
    sources: list[tuple[str, str]] = []  # (source label, transcript text)
    groups = [("lecture", "", course_node.get("lectures") or []),
              ("recitation", "Recitations/", course_node.get("recitations") or [])]
    for kind, prefix, entries in groups:
        for entry in entries:
            # The tree already reports file existence — trust it, no HEAD round-trips.
            if not ((entry.get("files") or {}).get("transcript.txt") or {}).get("exists"):
                continue
            data = db_client.get_file_bytes(course, entry["name"], kind, "transcript.txt")
            sources.append((f"{prefix}{entry['name']}", data.decode("utf-8")))

    for slug in slugs:
        extractor = overview.EXTRACTORS_BY_SLUG[slug]
        entry_status = status["extractors"][slug]
        entry_status["status"] = "running"
        try:
            sections = [(label, overview.extract_snippets(extractor, text)) for label, text in sources]
            report = overview.build_report(extractor, course, sections)
            if not report:
                entry_status.update({"status": "skipped", "message": "no snippets found"})
                continue
            db_client.put_overview_file(course, f"{slug}.txt", report.encode("utf-8"))
            entry_status["status"] = "done"
        except Exception as e:
            entry_status.update({"status": "error", "message": str(e)})
        finally:
            db_client.notify()


def _analyze_phase(course: str, slugs: list[str]) -> None:
    """Blocking analysis: per extractor, read the existing {slug}.txt from the overview area,
    send it to Gemini, write {slug}-analyzed.md. No transcript fetching, no re-extraction —
    a missing .txt just skips that extractor. `running` is owned by the generate driver."""
    status = _status[course]
    for slug in slugs:
        extractor = overview.EXTRACTORS_BY_SLUG[slug]
        entry_status = status["extractors"][slug]
        entry_status["status"] = "running"
        try:
            try:
                report = db_client.get_overview_file(course, f"{slug}.txt").decode("utf-8")
            except db_client.DbClientError:
                entry_status.update({"status": "skipped", "message": "no snippets file — run extract first"})
                continue
            analyzed = overview.analyze(extractor, report, course)
            if not analyzed:
                raise RuntimeError("Gemini returned no text")
            db_client.put_overview_file(course, f"{slug}-analyzed.md", analyzed.encode("utf-8"))
            entry_status["status"] = "done"
        except Exception as e:
            entry_status.update({"status": "error", "message": str(e)})
        finally:
            db_client.notify()  # per-extractor ping, same as the extract phase


def _to_pdf_phase(course: str, slugs: list[str]) -> None:
    """Blocking PDF render: per extractor, read the analyzed {slug}-analyzed.md, render it via
    the pipeline's convert_to_pdf, write {slug}-analyzed.pdf. A missing analyzed .md (analyze
    skipped/failed it) just skips that extractor. `running` is owned by the generate driver."""
    status = _status[course]
    for slug in slugs:
        entry_status = status["extractors"][slug]
        entry_status["status"] = "running"
        try:
            md_name = f"{slug}-analyzed.md"
            try:
                md_bytes = db_client.get_overview_file(course, md_name)
            except db_client.DbClientError:
                entry_status.update({"status": "skipped", "message": "no analyzed markdown — run analyze first"})
                continue
            # convert_to_pdf needs the .md on disk and drops the .pdf beside it (same stem),
            # so round-trip through a temp dir: db bytes → file → convert → db bytes.
            with tempfile.TemporaryDirectory() as tmp:
                md_path = Path(tmp) / md_name
                md_path.write_bytes(md_bytes)
                pdf_path = convert_to_pdf(str(md_path))
                pdf_bytes = Path(pdf_path).read_bytes()
            db_client.put_overview_file(course, f"{slug}-analyzed.pdf", pdf_bytes)
            entry_status["status"] = "done"
        except Exception as e:
            entry_status.update({"status": "error", "message": str(e)})
        finally:
            db_client.notify()  # per-extractor ping, same as the other phases
