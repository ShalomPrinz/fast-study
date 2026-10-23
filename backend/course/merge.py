"""Overview compile phase: merge every lecture's summary.md (and a lectures-only course's
recitations) into one `all-lectures.md`.
Sibling of collect.py, which keeps headings only; this keeps the bodies."""

from datetime import datetime

from services import db_client

from course import ranges
from course.summary_md import (
    BUILTINS,
    DIV_MARKER_RE,
    HEADING_RE,
    RULE_RE,
    bullet,
    display_name,
    lines_with_code_flag,
    ordered_entries,
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
    """One summary's body: built-ins dropped, headings demoted one level, rules removed, callout
    divs kept — see docs/OVERVIEW.md for why every `---` can go."""

    kept: list[str] = []
    skipping = (
        False  # inside a built-in H2 section — drop it and everything nested under it
    )
    div_depth = 0  # open callout divs, so one lecture's can't swallow the next
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
        if skipping:
            continue
        m_div = DIV_MARKER_RE.match(line)
        if m_div:
            if m_div.group("attr"):
                div_depth += 1
            elif div_depth:
                div_depth -= 1
            else:
                continue  # a closer with nothing open would close a LATER lecture's div
            kept.append(line)
            continue
        if RULE_RE.match(line.strip()):
            continue
        kept.append(line)
    # A div left open (the LLM forgot its `:::`, or a built-in section ate the closer) would
    # otherwise run on into every following lecture of the merged document.
    kept.extend([":::"] * div_depth)
    return _collapse_blanks(kept)


def render_entry(name: str, kind: str, summary: str) -> str:
    """One entry block: an H1 of the display name, then its demoted, built-in-free body."""

    header = bullet("#", display_name(name, kind))
    body = strip_and_demote(summary)
    return f"{header}\n\n{body}" if body else header


def build_all_lectures_md(
    lectures: list[tuple[str, str]],
    recitations: list[tuple[str, str]] = (),
    merged: bool = False,
) -> str:
    """Assemble all-lectures.md: entry blocks in overview order separated by a `---` rule."""

    blocks = [
        render_entry(n, k, s)
        for n, k, s in ordered_entries(list(lectures), list(recitations), merged)
    ]
    return "\n\n---\n\n".join(blocks) + "\n"


def run_merge(course: str, course_node: dict) -> dict:
    """Merge every lecture summary into all-lectures.md; raises on I/O failure so the runner
    records it as "error". Recitations join only in a lectures-only course, in merged order."""

    merged = bool(course_node.get("lectures_only"))
    groups = [("lecture", course_node.get("lectures") or [])]
    if merged:
        groups.append(("recitation", course_node.get("recitations") or []))
    collected: dict[str, list[tuple[str, str]]] = {"lecture": [], "recitation": []}
    for kind, entries in groups:
        for entry in entries:
            if not ((entry.get("files") or {}).get("summary.md") or {}).get("exists"):
                continue
            summary = db_client.get_summary(course, entry["name"], kind)
            collected[kind].append((entry["name"], summary))
    if not collected["lecture"] and not collected["recitation"]:
        return {
            "status": "skipped",
            "message": "no summaries found",
            "code": "no_summaries_found",
            "params": {},
        }

    md = build_all_lectures_md(collected["lecture"], collected["recitation"], merged)
    db_client.put_overview_file(course, f"{SLUG}.md", md.encode("utf-8"))

    # Snapshot the source range at generation time; later-phase re-runs leave it intact.
    # A split course's recitation range stays None — they are not in this document.
    db_client.patch_overview_meta(
        course,
        SLUG,
        {
            "lectures": ranges.name_range([n for n, _ in collected["lecture"]]),
            "recitations": (
                ranges.name_range([n for n, _ in collected["recitation"]])
                if merged
                else None
            ),
            "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        },
    )
    return {"status": "done"}
