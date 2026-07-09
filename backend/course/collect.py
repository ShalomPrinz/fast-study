"""Overview topics phase: read every lecture/recitation summary.md, distill its heading
tree (H1 title, H2 topics, H3 subtopics), and write one aggregated `topics.md`. The phase
worker the runner drives — run_collect.

Pure work: parsing/formatting are standalone helpers (no run-level state, no notify);
run_collect only fetches summaries and writes the result. The runner owns loop/status/isolation."""

import re

from services import db_client

RLM = "‏"  # right-to-left mark

# Built-in H2 sections from summarize.md that are boilerplate, not lecture topics.
BUILTINS = {"תקציר", "הערות אישיות והדגשות המרצה", "סיכום", "משימות נדרשות"}

# Per-entry heading label by kind: "Lecture 5.2" is stored/sorted in English but DISPLAYED "הרצאה 5.2".
_KIND_LABEL = {"lecture": "הרצאה", "recitation": "תרגול"}

# Headings tolerate an optional RLM (+ spaces) after the #s — summarize.md writes "## ‏text".
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")


def _strip_rlm(s: str) -> str:
    return s.replace(RLM, "").strip()


def _has_hebrew(s: str) -> bool:
    return any("֐" <= c <= "׿" for c in s)


def _natural_key(name: str) -> list:
    """Sort key that orders "Lecture 2.2" before "Lecture 10.1".
    Before: str compare        -> "Lecture 10.1" < "Lecture 2.2" (lexicographic "1" < "2")
    After:  digit runs as ints -> 2 < 10, so "Lecture 2.2" sorts first."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def _display_name(name: str, kind: str) -> str:
    """Translate the leading English word by kind, keeping the number: "Lecture 5.2" -> "הרצאה 5.2".
    Sorting uses the original English `name` so numeric order is unaffected; only display changes."""
    label = _KIND_LABEL.get(kind)
    return re.sub(r"^(Lecture|Recitation)\b", label, name) if label else name


def _headings(md: str) -> list[tuple[int, str]]:
    """Every heading as (level, RLM-stripped text) in document order.
    Fenced code blocks are opaque: a heading-looking line inside a ``` fence is skipped, so
    e.g. a `## fake` line in a code sample never becomes a topic."""
    headings: list[tuple[int, str]] = []
    in_code = False
    for line in md.split("\n"):
        if line.strip().startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        m = _HEADING_RE.match(line)
        if m:
            headings.append((len(m.group(1)), _strip_rlm(m.group(2))))
    return headings


# To also list each heading's list items later: retain each heading's body lines (the lines
# until the next heading of same-or-higher level, skipping fenced code), take the least-indented
# list items, reduce each to a title = the first `**bold**` span, else the text before the first
# `:` (colon excluded), preserve the original marker (numbered vs bulleted), and emit them as
# bullets nested one level under the heading. Removed for now — topics are headers only.


def parse_summary(md: str) -> dict:
    """Parse a summary.md into {"title", "topics": [{"title", "subtopics": [{"title"}]}]}.
    First H1 = title; H2 = topic (built-ins skip their whole section, H3s included);
    H3 = subtopic nested under its parent H2."""
    title = ""
    topics: list[dict] = []
    current: dict | None = None
    skipping = False  # inside a built-in H2 section — drop it and any nested H3
    for level, text in _headings(md):
        if level == 1:
            if not title:
                title = text
        elif level == 2:
            if text in BUILTINS:
                skipping, current = True, None
                continue
            skipping = False
            current = {"title": text, "subtopics": []}
            topics.append(current)
        elif level == 3:
            if skipping or current is None:
                continue
            current["subtopics"].append({"title": text})
    return {"title": title, "topics": topics}


def _bullet(marker: str, text: str, indent: int) -> str:
    """One output line. A RLM after the marker keeps Hebrew text rendering RTL in the PDF;
    pure-ASCII lines (e.g. an English H1 title) get none so they stay LTR."""
    line = " " * indent + marker + " "
    if _has_hebrew(text):
        line += RLM
    return line + text


def render_entry(name: str, kind: str, summary: str) -> str:
    """Render one entry's `#name / ##title` block plus its topic/subtopic heading bullets.
    `name` is the raw English entry name; `kind` translates it to its הרצאה/תרגול display label."""
    parsed = parse_summary(summary)
    lines = [_bullet("#", _display_name(name, kind), 0), _bullet("##", parsed["title"], 0)]
    body: list[str] = []
    for topic in parsed["topics"]:
        body.append(_bullet("-", topic["title"], 0))
        for sub in topic["subtopics"]:
            body.append(_bullet("-", sub["title"], 2))
    if body:
        lines.append("")
        lines.extend(body)
    return "\n".join(lines)


def build_topics_md(lectures: list[tuple[str, str]], recitations: list[tuple[str, str]]) -> str:
    """Assemble topics.md: natural-sorted lectures, then a `---` rule, then natural-sorted recitations.
    Sort keys off the original English `name`; render translates it to הרצאה/תרגול for display."""
    lec = [render_entry(n, "lecture", s) for n, s in sorted(lectures, key=lambda t: _natural_key(t[0]))]
    rec = [render_entry(n, "recitation", s) for n, s in sorted(recitations, key=lambda t: _natural_key(t[0]))]
    blocks = list(lec)
    if rec:
        if blocks:
            blocks.append("---")
        blocks.extend(rec)
    return "\n\n".join(blocks) + "\n"


def run_collect(course: str, course_node: dict) -> dict:
    """Collect every lecture/recitation summary into topics.md. Returns a status dict
    ("skipped"/"done"); raises on I/O failure so the runner records it as "error"."""
    groups = [("lecture", course_node.get("lectures") or []),
              ("recitation", course_node.get("recitations") or [])]
    collected: dict[str, list[tuple[str, str]]] = {"lecture": [], "recitation": []}

    # Fetch summaries of all lectures and recitations
    for kind, entries in groups:
        for entry in entries:
            if not ((entry.get("files") or {}).get("summary.md") or {}).get("exists"):
                continue
            summary = db_client.get_summary(course, entry["name"], kind)
            collected[kind].append((entry["name"], summary))
    if not collected["lecture"] and not collected["recitation"]:
        return {"status": "skipped", "message": "no summaries found"}

    # Build topics.md and write it to the course overview
    md = build_topics_md(collected["lecture"], collected["recitation"])
    db_client.put_overview_file(course, "topics.md", md.encode("utf-8"))
    return {"status": "done"}
