"""Shared vocabulary for reading a lecture's summary.md — the structure summarize.md
produces. Both course-level workers that consume summaries (collect, merge) import this,
so the built-in section names live in exactly one place."""

import re

RLM = "‏"  # right-to-left mark

# Built-in H2 sections from summarize.md that are boilerplate, not lecture content.
BUILTINS = {"תקציר", "הערות אישיות והדגשות המרצה", "סיכום", "משימות נדרשות"}

# Per-entry heading label by kind: "Lecture 5.2" is stored/sorted in English but DISPLAYED "הרצאה 5.2".
_KIND_LABEL = {"lecture": "הרצאה", "recitation": "תרגול"}

# Tolerates an optional RLM (+ spaces) after the #s — summarize.md writes "## ‏text".
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")

# A markdown horizontal rule on its own line.
RULE_RE = re.compile(r"^(?:-{3,}|\*{3,}|_{3,})$")


def strip_rlm(s: str) -> str:
    return s.replace(RLM, "").strip()


def has_hebrew(s: str) -> bool:
    return any("֐" <= c <= "׿" for c in s)


def natural_key(name: str) -> list:
    """Sort key reading digit runs as ints, so "Lecture 2.2" orders before "Lecture 10.1"."""

    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def display_name(name: str, kind: str) -> str:
    """Translate the leading English word by kind: "Lecture 5.2" -> "הרצאה 5.2". Display only —
    sorting stays on the original name so numeric order is unaffected."""

    label = _KIND_LABEL.get(kind)
    return re.sub(r"^(Lecture|Recitation)\b", label, name) if label else name


def bullet(marker: str, text: str, indent: int = 0) -> str:
    """One output line. An RLM after the marker keeps Hebrew text RTL in the PDF; pure-ASCII
    lines get none so they stay LTR."""

    line = " " * indent + marker + " "
    if has_hebrew(text):
        line += RLM
    return line + text


def lines_with_code_flag(md: str):
    """Yield (line, in_code) for every line. Fenced blocks are opaque to callers, so a
    `## fake` line in a code sample is never mistaken for a heading; the fence lines
    themselves report in_code=True so they travel with their block."""

    in_code = False
    for line in md.split("\n"):
        if line.strip().startswith("```"):
            in_code = not in_code
            yield line, True
        else:
            yield line, in_code


def headings(md: str) -> list[tuple[int, str]]:
    """Every heading as (level, RLM-stripped text) in document order."""

    found: list[tuple[int, str]] = []
    for line, in_code in lines_with_code_flag(md):
        if in_code:
            continue
        m = HEADING_RE.match(line)
        if m:
            found.append((len(m.group(1)), strip_rlm(m.group(2))))
    return found
