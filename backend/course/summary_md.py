"""Shared vocabulary for reading a summary.md, so collect and merge share one definition of
the built-in sections."""

import re

from pipeline.pdf.text import DIV_MARKER_RE  # noqa: F401 — re-exported for merge.py

# Built-in H2 sections from summarize.md that are boilerplate, not lecture content.
BUILTINS = {"תקציר", "הערות אישיות והדגשות המרצה", "סיכום", "משימות נדרשות"}

# Per-entry heading label by kind: "Lecture 5.2" is stored/sorted in English but DISPLAYED "הרצאה 5.2".
_KIND_LABEL = {"lecture": "הרצאה", "recitation": "תרגול"}

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")

# A markdown horizontal rule on its own line.
RULE_RE = re.compile(r"^(?:-{3,}|\*{3,}|_{3,})$")

# Mirrors the frontend's nextName.ts PATTERN: any prefix, whitespace, then a TRAILING number with an
# optional `.sub`; `[0-9]` and fullmatch match JS `\d` and `$` exactly.
_TRAILING_NUM_RE = re.compile(r"(.+?)\s+([0-9]+)(?:\.([0-9]+))?")


def natural_key(name: str) -> list:
    """Sort key reading digit runs as ints, so "Lecture 2.2" orders before "Lecture 10.1"."""

    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def merged_key(name: str, kind: str) -> tuple:
    """Lectures-only course order, as the frontend's compareMerged: by the trailing number, a
    lecture before a recitation on it, then sub; names with no trailing number after, by name."""

    m = _TRAILING_NUM_RE.fullmatch(name)
    rank = 0 if kind == "lecture" else 1
    if m is None:
        return (1, natural_key(name), rank)
    return (0, int(m[2]), rank, int(m[3] or 0), natural_key(name))


def ordered_entries(
    lectures: list[tuple[str, str]],
    recitations: list[tuple[str, str]],
    merged: bool,
) -> list[tuple[str, str, str]]:
    """(name, kind, summary) in overview order: one merged list for a lectures-only course,
    else natural-sorted lectures then natural-sorted recitations."""

    entries = [(n, "lecture", s) for n, s in lectures] + [
        (n, "recitation", s) for n, s in recitations
    ]
    if merged:
        return sorted(entries, key=lambda e: merged_key(e[0], e[1]))
    return sorted(entries, key=lambda e: (e[1] != "lecture", natural_key(e[0])))


def display_name(name: str, kind: str) -> str:
    """Translate the leading English word by kind: "Lecture 5.2" -> "הרצאה 5.2". Display only —
    sorting stays on the original name so numeric order is unaffected."""

    label = _KIND_LABEL.get(kind)
    return re.sub(r"^(Lecture|Recitation)\b", label, name) if label else name


def bullet(marker: str, text: str, indent: int = 0) -> str:
    """One output line: an indented marker and its text."""

    return " " * indent + marker + " " + text


def lines_with_code_flag(md: str):
    """Yield (line, in_code) for every line, so a `## x` inside a code sample is never a heading.
    Fence lines report in_code=True so they travel with their block."""

    in_code = False
    for line in md.split("\n"):
        if line.strip().startswith("```"):
            in_code = not in_code
            yield line, True
        else:
            yield line, in_code


def headings(md: str) -> list[tuple[int, str]]:
    """Every heading as (level, stripped text) in document order."""

    found: list[tuple[int, str]] = []
    for line, in_code in lines_with_code_flag(md):
        if in_code:
            continue
        m = HEADING_RE.match(line)
        if m:
            found.append((len(m.group(1)), m.group(2).strip()))
    return found
