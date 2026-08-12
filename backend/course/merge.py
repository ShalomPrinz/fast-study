"""Overview compile phase: merge every lecture's summary.md into one `all-lectures.md`
holding the full course content. Pure work — the runner owns the loop, status and failure
isolation.

Sibling of collect.py: that one keeps headings only, this one keeps the bodies."""

from datetime import datetime

from services import db_client

from course import ranges
from course.summary_md import (
    BUILTINS,
    HEADING_RE,
    RULE_RE,
    bullet,
    display_name,
    lines_with_code_flag,
    natural_key,
)

SLUG = "all-lectures"

# Deepest ATX heading level; demotion saturates here rather than emitting "#######".
_MAX_LEVEL = 6


def _collapse_blanks(lines: list[str]) -> str:
    """Join lines with runs of blanks squeezed to one and the edges trimmed — dropping whole
    sections otherwise leaves gaps that read as page-breaks in the PDF."""

    out: list[str] = []
    for line in lines:
        if not line.strip():
            if not out or not out[-1]:
                continue
            out.append("")
        else:
            out.append(line)
    while out and not out[-1]:
        out.pop()
    return "\n".join(out)


def strip_and_demote(md: str) -> str:
    """One summary's body: built-in sections dropped whole, every heading pushed one level
    down (H1→H2, …) to make room for the per-lecture H1, and horizontal rules removed.

    summarize.md mandates exactly two `---` rules, both bordering a built-in section, so
    dropping all of them leaves only the rule this phase inserts between lectures."""

    kept: list[str] = []
    skipping = (
        False  # inside a built-in H2 section — drop it and everything nested under it
    )
    for line, in_code in lines_with_code_flag(md):
        if in_code:
            if not skipping:
                kept.append(line)
            continue
        m = HEADING_RE.match(line)
        if m:
            level, text = len(m.group(1)), m.group(2).strip()
            # Only an H1/H2 ends a built-in section; deeper headings stay inside it.
            if level <= 2:
                skipping = level == 2 and text in BUILTINS
            if not skipping:
                kept.append(bullet("#" * min(level + 1, _MAX_LEVEL), text))
            continue
        if skipping or RULE_RE.match(line.strip()):
            continue
        kept.append(line)
    return _collapse_blanks(kept)


def render_entry(name: str, summary: str) -> str:
    """One lecture block: an H1 of the display name, then its demoted, built-in-free body."""

    header = bullet("#", display_name(name, "lecture"))
    body = strip_and_demote(summary)
    return f"{header}\n\n{body}" if body else header


def build_all_lectures_md(lectures: list[tuple[str, str]]) -> str:
    """Assemble all-lectures.md: natural-sorted lecture blocks separated by a `---` rule."""

    blocks = [
        render_entry(n, s) for n, s in sorted(lectures, key=lambda t: natural_key(t[0]))
    ]
    return "\n\n---\n\n".join(blocks) + "\n"


def run_merge(course: str, course_node: dict) -> dict:
    """Merge every lecture summary into all-lectures.md; raises on I/O failure so the runner
    records it as "error". Recitations are deliberately excluded — this is the lecture content."""

    collected: list[tuple[str, str]] = []
    for entry in course_node.get("lectures") or []:
        if not ((entry.get("files") or {}).get("summary.md") or {}).get("exists"):
            continue
        collected.append(
            (entry["name"], db_client.get_summary(course, entry["name"], "lecture"))
        )
    if not collected:
        return {"status": "skipped", "message": "no summaries found"}

    md = build_all_lectures_md(collected)
    db_client.put_overview_file(course, f"{SLUG}.md", md.encode("utf-8"))

    # Snapshot the source range at generation time; later-phase re-runs leave it intact.
    db_client.patch_overview_meta(
        course,
        SLUG,
        {
            "lectures": ranges.name_range([n for n, _ in collected]),
            "recitations": None,
            "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        },
    )
    return {"status": "done"}
