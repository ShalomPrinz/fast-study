"""Overview extract phase: scan every transcript for a pattern extractor's snippets and
assemble its report. Pure work — the runner owns the loop, status and failure isolation."""

import re
from datetime import datetime

from services import db_client

from course import ranges
from course.overview import Extractor

_RECITATION_PREFIX = "Recitations/"


# A run ending in ./?/! (terminator kept), or a terminator-less trailing run. \n is
# excluded from both so newlines always act as boundaries.
_SENTENCE_RE = re.compile(r"[^.?!\n]*[.?!]+|[^.?!\n]+")


def split_sentences(text: str) -> list[str]:
    """Split text into sentences on ./?/! and newlines, dropping blank ones."""

    return [s.strip() for s in _SENTENCE_RE.findall(text) if s.strip()]


def _pattern_snippets(extractor: Extractor, sentences: list[str]) -> list[str]:
    """One context window per matched sentence, overlapping windows merged into one snippet."""

    # Patterns are unanchored so Hebrew prefixed forms (ו/ה/ש/ב) match for free.
    compiled = [(p, re.compile(p)) for p in extractor.patterns]

    # `before` is constant, so windows come out already sorted by start.
    windows: list[list] = []  # [start, end, [patterns]]
    for i, sent in enumerate(sentences):
        hit = [p for p, rx in compiled if rx.search(sent)]
        if hit:
            windows.append(
                [
                    max(0, i - extractor.before),
                    min(len(sentences) - 1, i + extractor.after),
                    hit,
                ]
            )

    # Merge overlapping/adjacent windows so clustered matches yield one snippet.
    merged: list[list] = []
    for start, end, pats in windows:
        if merged and start <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], end)
            merged[-1][2].extend(pats)
        else:
            merged.append([start, end, list(pats)])

    snippets = []
    for start, end, pats in merged:
        uniq = list(dict.fromkeys(pats))  # dedupe, keep first-hit order
        text = " ".join(sentences[start : end + 1])
        snippets.append(f"--- [patterns: {', '.join(uniq)}] ---\n{text}")
    return snippets


def extract_snippets(extractor: Extractor, transcript: str) -> list[str]:
    """Extract annotated snippet blocks ('--- [...] ---\\n{text}') from one transcript."""

    sentences = split_sentences(transcript)
    if not sentences:
        return []
    return _pattern_snippets(extractor, sentences)


def build_report(
    extractor: Extractor, course: str, sections: list[tuple[str, list[str]]]
) -> str:
    """Assemble the report from (source label, snippets) sections, omitting empty sources.
    Returns "" when all are empty so the caller can skip the write."""

    non_empty = [(label, snips) for label, snips in sections if snips]
    if not non_empty:
        return ""
    parts = [
        f"# {course}: {extractor.title}",
        "",
    ]
    for label, snips in non_empty:
        parts.append(f"=== {label} ===")
        parts.append("")
        for snippet in snips:
            parts.append(snippet)
            parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def fetch_sources(course: str, course_node: dict) -> list[tuple[str, str]]:
    """Fetch every lecture/recitation transcript once as (source label, text) pairs."""

    sources: list[tuple[str, str]] = []
    groups = [
        ("lecture", "", course_node.get("lectures") or []),
        ("recitation", "Recitations/", course_node.get("recitations") or []),
    ]
    for kind, prefix, entries in groups:
        for entry in entries:
            # The tree already reports file existence — no HEAD round-trips needed.
            if not ((entry.get("files") or {}).get("transcript.txt") or {}).get(
                "exists"
            ):
                continue
            data = db_client.get_file_bytes(
                course, entry["name"], kind, "transcript.txt"
            )
            sources.append((f"{prefix}{entry['name']}", data.decode("utf-8")))
    return sources


def run_extractor(
    course: str, extractor: Extractor, sources: list[tuple[str, str]]
) -> dict:
    """Run one extractor over pre-fetched sources and write {slug}.txt; raises on I/O
    failure so the runner records it as "error"."""

    sections = [(label, extract_snippets(extractor, text)) for label, text in sources]
    report = build_report(extractor, course, sections)
    if not report:
        return {"status": "skipped", "message": "no snippets found"}
    db_client.put_overview_file(course, f"{extractor.slug}.txt", report.encode("utf-8"))

    # Snapshot the source range at generation time; later-phase re-runs leave it intact.
    lec = [label for label, _ in sources if not label.startswith(_RECITATION_PREFIX)]
    rec = [
        label[len(_RECITATION_PREFIX) :]
        for label, _ in sources
        if label.startswith(_RECITATION_PREFIX)
    ]
    db_client.patch_overview_meta(
        course,
        extractor.slug,
        {
            "lectures": ranges.name_range(lec),
            "recitations": ranges.name_range(rec),
            "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        },
    )
    return {"status": "done"}
