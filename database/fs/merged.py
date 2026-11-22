from datetime import datetime, timezone
from pathlib import Path

from .overview import OVERVIEW_META, read_meta_map, set_meta_entry
from .paths import (
    CodedValueError,
    CourseNotFound,
    check_safe_segment,
    course_dir,
    lecture_dir,
    merged_dir,
    reject_if_locked,
    safe_name,
)


def merged_name(title: str) -> str:
    """Resolve a user title to its sanitized key; uniqueness and overwrite compare this, not the title."""

    return safe_name(title.strip())


def _require_course(course: str) -> None:
    """Raise CourseNotFound unless the course dir exists, so a typo'd course never mints a tree."""

    check_safe_segment(course)
    if not course_dir(course).is_dir():
        raise CourseNotFound(f"course not found: {course}", course=course)


def merged_pdf_path(course: str, title: str) -> tuple[str, Path]:
    """Resolve (sanitized name, absolute {name}.pdf path) for a merged PDF title."""

    check_safe_segment(course)
    name = merged_name(title)
    return name, merged_dir(course) / f"{name}.pdf"


def write_merged_pdf(course: str, title: str, data: bytes) -> str:
    """Write a merged PDF's bytes (creating merged/ on demand) and return its sanitized name."""

    _require_course(course)
    name, p = merged_pdf_path(course, title)
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        p.write_bytes(data)
    except PermissionError as e:
        reject_if_locked(e, p.name)
        raise
    return name


def merge_merged_meta(course: str, title: str, entry: dict) -> str:
    """Set the entry under the sanitized title in merged/meta.json, replacing it wholly; return the name."""

    # Never add an `await` in this path: see docs/OVERVIEW.md (same single-writer rule as overview meta).
    _require_course(course)
    if not isinstance(entry, dict):
        raise CodedValueError(
            "entry must be an object",
            "bad_request_body",
            detail="entry must be an object",
        )
    name = merged_name(title)
    d = merged_dir(course)
    d.mkdir(parents=True, exist_ok=True)
    set_meta_entry(d / OVERVIEW_META, name, entry)
    return name


def _utc(ts: float) -> datetime:
    """Convert an epoch mtime to an aware UTC datetime, the form the backend records."""

    return datetime.fromtimestamp(ts, timezone.utc)


def _parse(value) -> datetime | None:
    """Parse an ISO timestamp (naive reads as UTC), or None when it is not one."""

    try:
        dt = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _enrich_part(course: str, part) -> tuple[dict, bool]:
    """Add exists/current_pdf_mtime to one part and say whether its pdf is newer than recorded."""

    out = dict(part) if isinstance(part, dict) else {}
    exists = False
    current = None
    try:
        d = lecture_dir(course, str(out.get("name", "")), out.get("kind", "lecture"))
        exists = d.is_dir()
        pdf = d / "summary.pdf"
        if exists and pdf.is_file():
            current = _utc(pdf.stat().st_mtime)
    except Exception:
        exists = False
    out["exists"] = exists
    if current is not None:
        out["current_pdf_mtime"] = current.isoformat()
    recorded = _parse(out.get("pdf_mtime"))
    return out, current is not None and recorded is not None and current > recorded


def _enrich(course: str, name: str, entry: dict) -> dict:
    """Build the listing item: the meta entry plus name, enriched parts and the stale flag."""

    raw = entry.get("parts")
    parts, stale = [], False
    for part in raw if isinstance(raw, list) else []:
        enriched, newer = _enrich_part(course, part)
        parts.append(enriched)
        stale = stale or newer
    return {**entry, "name": name, "parts": parts, "stale": stale}


def _listed(course: str, only: str | None = None) -> dict[str, dict]:
    """Return {name: enriched item} for every meta entry (or just `only`) whose {name}.pdf is on disk."""

    d = merged_dir(course)
    items = {}
    for name, entry in read_meta_map(d / OVERVIEW_META).items():
        if not isinstance(entry, dict) or (only is not None and name != only):
            continue
        try:
            check_safe_segment(name)
        except ValueError:
            continue
        if (d / f"{name}.pdf").is_file():
            items[name] = _enrich(course, name, entry)
    return items


def list_merged(course: str) -> list[dict]:
    """List a course's merged PDFs newest first by created_at; entries without a pdf are hidden."""

    _require_course(course)
    floor = datetime.min.replace(tzinfo=timezone.utc)
    return sorted(
        _listed(course).values(),
        key=lambda i: _parse(i.get("created_at")) or floor,
        reverse=True,
    )


def get_merged(course: str, title: str) -> tuple[str, dict | None]:
    """Return (sanitized name, enriched entry or None when there is no entry or no pdf)."""

    _require_course(course)
    name = merged_name(title)
    return name, _listed(course, name).get(name)
