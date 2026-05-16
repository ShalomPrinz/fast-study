"""Thin HTTP client for the database service. Every backend filesystem read/write
goes through here so the layout under DATA_ROOT is owned by `database/` alone."""

import os
from urllib.parse import quote

import requests

DATABASE_URL = os.environ.get("DATABASE_URL", "http://localhost:8001")


class DbClientError(RuntimeError):
    """Raised when a database service call fails (HTTP error or {ok: false} envelope)."""


def _q(s: str) -> str:
    return quote(s, safe="")


def _file_url(course: str, lecture: str, name: str) -> str:
    return f"{DATABASE_URL}/courses/{_q(course)}/lectures/{_q(lecture)}/files/{_q(name)}"


def _summary_url(course: str, lecture: str) -> str:
    return f"{DATABASE_URL}/courses/{_q(course)}/lectures/{_q(lecture)}/summary"


def _raise_for_envelope(resp: requests.Response) -> None:
    # Mutating endpoints return {ok: false, error} on failure. Lift the error
    # message into an exception so callers see failures the same way Path
    # operations raise today — silent ok:false would otherwise swallow errors.
    if not resp.ok:
        try:
            body = resp.json()
            err = body.get("error") if isinstance(body, dict) else None
        except Exception:
            err = None
        raise DbClientError(err or f"HTTP {resp.status_code}: {resp.text[:200]}")
    try:
        body = resp.json()
    except Exception:
        return
    if isinstance(body, dict) and body.get("ok") is False:
        raise DbClientError(body.get("error") or "Internal database service error")


def get_file_bytes(course: str, lecture: str, kind: str, filename: str) -> bytes:
    """Fetch one file from the lecture dir as raw bytes. Raises if missing."""

    r = requests.get(_file_url(course, lecture, filename), params={"kind": kind})
    if r.status_code == 404:
        raise DbClientError(f"{filename} not found for {course}/{lecture}")
    if not r.ok:
        raise DbClientError(f"HTTP {r.status_code}: {r.text[:200]}")
    return r.content


def put_file_bytes(course: str, lecture: str, kind: str, filename: str, data: bytes) -> None:
    """Upload raw bytes for one file in the lecture dir. Neutral write — no artifact wipe."""

    r = requests.put(_file_url(course, lecture, filename), params={"kind": kind}, data=data)
    _raise_for_envelope(r)


def file_exists(course: str, lecture: str, kind: str, filename: str) -> bool:
    """Cheap existence check via HEAD — avoids streaming the body."""

    r = requests.head(_file_url(course, lecture, filename), params={"kind": kind})
    return r.status_code == 200


def delete_file(course: str, lecture: str, kind: str, filename: str) -> None:
    """Delete one file in a lecture dir (no-op server-side if missing)."""

    r = requests.delete(_file_url(course, lecture, filename), params={"kind": kind})
    _raise_for_envelope(r)


def get_summary(course: str, lecture: str, kind: str) -> str:
    """Fetch summary.md content, unwrapping the {content, hasOriginal} envelope."""

    r = requests.get(_summary_url(course, lecture), params={"kind": kind})
    if not r.ok:
        raise DbClientError(f"HTTP {r.status_code}: {r.text[:200]}")
    body = r.json()
    if isinstance(body, dict) and body.get("ok") is False:
        raise DbClientError(body.get("error") or "Internal database service error")
    return body["content"]


def put_summary(course: str, lecture: str, kind: str, content: str) -> None:
    """Write summary.md. The database service snapshots the original on first write (enables revert)."""

    r = requests.put(_summary_url(course, lecture), params={"kind": kind}, data=content.encode("utf-8"))
    _raise_for_envelope(r)
