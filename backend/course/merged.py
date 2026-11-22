"""The course-level merged PDF run: validate a request, then join the chosen parts' summary.pdf
under one title. Own small store (in flight, errors, a per-course lock), merged into /status by
the pipeline runner. See docs/PIPELINE.md#merged-pdf."""

import asyncio
import logging
import re
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import timing
from pydantic import BaseModel
from services import db_client
from services.errors import CodedError, failure, own_fields

from course.merged_pdf import join_pdfs
from course.summary_md import display_name

log = logging.getLogger("merged")

STEP = "merge_pdf"
KIND = "merged"
# Runner `kind` slot → the tree key that lists those parts.
_TREE_KEYS = {"lecture": "lectures", "recitation": "recitations"}

_in_flight: dict[
    str, dict
] = {}  # skey → {course, lecture, kind, step, started_at, waiting}
_errors: dict[
    str, dict
] = {}  # skey → last error record; cleared when a merge of that name starts
_locks: dict[str, asyncio.Lock] = {}  # per course: one merge at a time


class Part(BaseModel):
    name: str
    kind: Literal["lecture", "recitation"]


class MergeRequest(BaseModel):
    title: str
    parts: list[Part]
    overwrite: bool = False


class Refused(Exception):
    """A request the route answers with this status and failure body, before anything starts."""

    def __init__(self, status: int, message: str, code: str, **params):
        super().__init__(message)
        self.status = status
        self.body = failure(message, code, **params)


def skey(course: str, name: str) -> str:
    return f"{course}||{name}||{KIND}"


def clean_title(title: str) -> str:
    """Drop the path separators, which no stored name may hold and `%2F` could not route anyway."""

    return re.sub(r"[/\\]", "", title).strip()


def in_flight() -> list[dict]:
    return list(_in_flight.values())


def errors() -> dict[str, dict]:
    return dict(_errors)


def prune_errors(before: dict[str, dict], live_courses: set[str]) -> bool:
    """Drop the errors in `before` whose course left the tree; True iff one went. Only a record
    the tree fetch predates may go, and a running merge keeps its course."""

    removed = False
    for key, record in before.items():
        if (
            key.split("||", 1)[0] not in live_courses
            and key not in _in_flight
            and _errors.get(key) is record
        ):
            del _errors[key]
            removed = True
    return removed


def _part_missing(name: str, kind: str) -> CodedError:
    return CodedError(
        f"{kind} {name} has no summary.pdf", "merged_part_missing", name=name, kind=kind
    )


def _summary_pdf_mtime(course_node: dict, part: Part) -> float:
    """The part's summary.pdf mtime off the tree; `merged_part_missing` when it or the part is gone."""

    for item in course_node.get(_TREE_KEYS[part.kind]) or []:
        if item.get("name") == part.name:
            f = (item.get("files") or {}).get("summary.pdf") or {}
            if f.get("exists") and f.get("mtime") is not None:
                return f["mtime"]
            break
    raise _part_missing(part.name, part.kind)


def _course_node(course: str) -> dict:
    node = next((c for c in db_client.get_tree() if c.get("name") == course), None)
    if node is None:
        raise CodedError(
            f"course not found: {course}", "course_not_found", course=course
        )
    return node


def validate(req: MergeRequest, course: str) -> tuple[str, str]:
    """Run the request's refusals in order; return (clean title, stored name). Blocking (database
    calls). A storage failure other than the two it names propagates as `DbClientError`."""

    title = clean_title(req.title)
    if not title:
        raise Refused(400, "a title is required", "merged_title_required")
    if not req.parts:
        raise Refused(400, "at least one part is required", "merged_parts_required")
    try:
        found = db_client.get_merged(course, title)
        node = _course_node(course)
    except db_client.DbClientError as e:
        if e.code in ("course_not_found", "name_has_no_legal_characters"):
            raise Refused(
                404 if e.code == "course_not_found" else 400, str(e), e.code, **e.params
            ) from e
        raise
    except CodedError as e:
        raise Refused(404, str(e), e.code, **e.params) from e
    if found["entry"] is not None and not req.overwrite:
        raise Refused(
            409, f"a merged PDF titled {title} exists", "merged_pdf_exists", title=title
        )
    for part in req.parts:
        try:
            _summary_pdf_mtime(node, part)
        except CodedError as e:
            raise Refused(409, str(e), e.code, **e.params) from e
    return title, found["name"]


def try_start(course: str, title: str, name: str, parts: list[Part]) -> str:
    """Fire-and-forget one merge unless that (course, name) is waiting or running. 'busy' or 'started'."""

    key = skey(course, name)
    if key in _in_flight:
        return "busy"
    _in_flight[key] = {
        "course": course,
        "lecture": name,
        "kind": KIND,
        "step": STEP,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "waiting": True,
    }
    _errors.pop(key, None)  # a re-run's failure must not look like the old one
    db_client.notify()
    asyncio.create_task(_run(course, title, name, parts))
    return "started"


async def _run(course: str, title: str, name: str, parts: list[Part]) -> None:
    key = skey(course, name)
    lock = _locks.setdefault(course, asyncio.Lock())
    try:
        async with lock:
            _in_flight[key]["waiting"] = False
            _in_flight[key]["started_at"] = datetime.now(timezone.utc).isoformat()
            db_client.notify()
            try:
                await asyncio.to_thread(_merge, course, title, name, parts)
                _errors.pop(key, None)
            except Exception as e:
                _errors[key] = _error_record(e)
    finally:
        _in_flight.pop(key, None)
        db_client.notify()


def _error_record(e: Exception) -> dict:
    fields = own_fields(e)
    if fields is None:
        log.error("merge failed", exc_info=e)
        fields = ("unknown_error", {})
    elif fields[0] == "merge_pdf_failed":
        log.error("merge failed", exc_info=e)
    else:
        log.warning("merge failed: %s", e)
    code, params = fields
    return {
        "step": STEP,
        "message": str(e),
        "code": code,
        "params": params,
        "provider": None,
        "blocked": False,
    }


def _merge(course: str, title: str, name: str, parts: list[Part]) -> None:
    """Blocking body: fetch each part's summary.pdf, join, write the PDF and then the meta entry."""

    started = time.monotonic()
    node = _course_node(course)
    mtimes = [_summary_pdf_mtime(node, p) for p in parts]
    with tempfile.TemporaryDirectory() as tmp:
        inputs = []
        for i, part in enumerate(parts):
            path = Path(tmp) / f"{i}.pdf"
            try:
                data = db_client.get_file_bytes(
                    course, part.name, part.kind, "summary.pdf"
                )
            except db_client.DbClientError as e:
                if e.code in ("file_not_found", "lecture_not_found"):
                    raise _part_missing(part.name, part.kind) from e
                raise
            path.write_bytes(data)
            inputs.append(path)
        size = sum(p.stat().st_size for p in inputs)
        labels = [display_name(p.name, p.kind) for p in parts]
        try:
            out = join_pdfs(inputs, labels, title, Path(tmp) / "merged.pdf")
        except Exception as e:
            raise CodedError(
                f"merging failed: {e}", "merge_pdf_failed", detail=str(e)
            ) from e
        db_client.put_merged_pdf(course, name, out.read_bytes())
    entry = {
        "title": title,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "parts": [
            {
                "name": p.name,
                "kind": p.kind,
                "pdf_mtime": datetime.fromtimestamp(m, timezone.utc).isoformat(),
            }
            for p, m in zip(parts, mtimes, strict=True)
        ],
    }
    db_client.patch_merged_meta(course, title, entry)
    try:
        timing.record(STEP, size, max(time.monotonic() - started, 1e-6))
    except Exception:
        log.warning("could not record merge timing", exc_info=True)
