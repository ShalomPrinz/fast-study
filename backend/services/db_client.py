"""Thin HTTP client for the database service. Every backend filesystem read/write
goes through here so the layout under DATA_ROOT is owned by `database/` alone."""

import os
from urllib.parse import quote

import requests

DATABASE_URL = os.environ.get("DATABASE_URL", "http://localhost:8001")


class DbClientError(RuntimeError):
    """Raised when a database service call fails, i.e. answers a non-2xx status."""


def _q(s: str) -> str:
    return quote(s, safe="")


def _file_url(course: str, lecture: str, name: str) -> str:
    return (
        f"{DATABASE_URL}/courses/{_q(course)}/lectures/{_q(lecture)}/files/{_q(name)}"
    )


def _summary_url(course: str, lecture: str) -> str:
    return f"{DATABASE_URL}/courses/{_q(course)}/lectures/{_q(lecture)}/summary"


def _raise_for_status(resp: requests.Response) -> None:
    """Raise DbClientError carrying the database's {error} message on a non-2xx status, so
    callers see failures as exceptions rather than silently succeeding."""

    if not resp.ok:
        try:
            body = resp.json()
            err = body.get("error") if isinstance(body, dict) else None
        except Exception:
            err = None
        raise DbClientError(err or f"HTTP {resp.status_code}: {resp.text[:200]}")


def get_file_bytes(course: str, lecture: str, kind: str, filename: str) -> bytes:
    """Fetch one file from the lecture dir as raw bytes. Raises if missing."""

    r = requests.get(_file_url(course, lecture, filename), params={"kind": kind})
    if r.status_code == 404:
        raise DbClientError(f"{filename} not found for {course}/{lecture}")
    _raise_for_status(r)
    return r.content


def put_file_bytes(
    course: str, lecture: str, kind: str, filename: str, data: bytes
) -> None:
    """Upload raw bytes for one file in the lecture dir. Neutral write — no artifact wipe."""

    r = requests.put(
        _file_url(course, lecture, filename), params={"kind": kind}, data=data
    )
    _raise_for_status(r)


def file_exists(course: str, lecture: str, kind: str, filename: str) -> bool:
    """Cheap existence check via HEAD — avoids streaming the body."""

    r = requests.head(_file_url(course, lecture, filename), params={"kind": kind})
    return r.status_code == 200


def delete_file(course: str, lecture: str, kind: str, filename: str) -> None:
    """Delete one file in a lecture dir (no-op server-side if missing)."""

    r = requests.delete(_file_url(course, lecture, filename), params={"kind": kind})
    _raise_for_status(r)


def list_materials(course: str, lecture: str, kind: str) -> list[dict]:
    """List a lecture's material PDFs as [{name, size, mtime}] — empty when it has none.
    The database service owns their naming, so never construct a material filename here."""

    r = requests.get(
        f"{DATABASE_URL}/courses/{_q(course)}/lectures/{_q(lecture)}/materials",
        params={"kind": kind},
    )
    _raise_for_status(r)
    return r.json().get("materials", [])


def _overview_url(course: str, name: str) -> str:
    return f"{DATABASE_URL}/courses/{_q(course)}/overview/files/{_q(name)}"


def put_overview_file(course: str, filename: str, data: bytes) -> None:
    """Write one file into the course-level overview dir (created server-side on demand)."""

    r = requests.put(_overview_url(course, filename), data=data)
    _raise_for_status(r)


def get_overview_file(course: str, filename: str) -> bytes:
    """Fetch one course-level overview file as raw bytes. Raises if missing."""

    r = requests.get(_overview_url(course, filename))
    if r.status_code == 404:
        raise DbClientError(f"{filename} not found in {course}/overview")
    _raise_for_status(r)
    return r.content


def list_overview_files(course: str) -> list[dict]:
    """List a course's overview files as [{name, size, mtime}]."""

    r = requests.get(f"{DATABASE_URL}/courses/{_q(course)}/overview/files")
    _raise_for_status(r)
    return r.json().get("files", [])


def _overview_meta_url(course: str) -> str:
    return f"{DATABASE_URL}/courses/{_q(course)}/overview/meta"


def get_overview_meta(course: str) -> dict:
    """Fetch the course's overview meta map (slug -> entry), unwrapping the {meta} envelope.
    Returns {} when the course has no meta.json yet."""

    r = requests.get(_overview_meta_url(course))
    _raise_for_status(r)
    return r.json().get("meta", {})


def patch_overview_meta(course: str, slug: str, entry: dict) -> None:
    """Merge one slug's entry into the course's overview meta.json. The merge is server-side
    (atomic across concurrent per-slug PATCHes from parallel overview runs of the same course)."""

    r = requests.patch(_overview_meta_url(course), json={"slug": slug, "entry": entry})
    _raise_for_status(r)


def get_tree() -> list[dict]:
    """Fetch the full course tree (courses → lectures + recitations)."""

    r = requests.get(f"{DATABASE_URL}/tree")
    _raise_for_status(r)
    return r.json()


def get_summary(course: str, lecture: str, kind: str) -> str:
    """Fetch summary.md content, unwrapping the {content, hasOriginal} envelope."""

    r = requests.get(_summary_url(course, lecture), params={"kind": kind})
    _raise_for_status(r)
    return r.json()["content"]


def put_summary(course: str, lecture: str, kind: str, content: str) -> None:
    """Write summary.md. The database service snapshots the original on first write (enables revert)."""

    r = requests.put(
        _summary_url(course, lecture),
        params={"kind": kind},
        data=content.encode("utf-8"),
    )
    _raise_for_status(r)


def notify() -> None:
    """Fire-and-forget broadcast on the database SSE notify channel. Failure is swallowed —
    the channel is for liveness pings, not for correctness."""

    try:
        requests.post(f"{DATABASE_URL}/notify", timeout=2)
    except Exception:
        pass
