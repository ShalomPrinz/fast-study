import re

_LIST_ITEM_RE = re.compile(r"^(\s*(?:[-*+]|\d+\.)\s)")
# A pandoc fenced-div marker line — the callout syntax summarize.md emits (`::: definition`
# to open, `:::` to close). `attr` is empty exactly on a closing marker. Lives here because
# it is markdown structure both the render chain and course/summary_md.py read; pipeline/
# may not import course/, so course imports this one rather than restating it.
DIV_MARKER_RE = re.compile(r"^ {0,3}:{3,}[ \t]*(?P<attr>.*?)[ \t]*$")
_DISPLAY_MATH = r"\$\$[\s\S]*?\$\$"
# Excludes the backtick: a `$` inside inline code is a literal, and pandoc won't let
# math cross a code span — so two unrelated code spans must never pair up as "math".
_INLINE_MATH = r"\$[^\$\n`]+?\$"
# Shared with `bidi._INLINE_CODE_RE` so the two can't disagree on what is code — a span
# only one of them claims comes out double-wrapped. Newline-bounded, matching pandoc.
_INLINE_CODE_BODY = r"[^`\n]+"
# Markdown's literal-backtick span. Matched FIRST and whole: taking the inner pair leaves
# the outer backticks, and pandoc re-reads the span as code, printing the \LR{} literally.
_DOUBLE_CODE_BODY = r"(?:[^`\n]|`(?!`))+"
_INLINE_CODE = r"``" + _DOUBLE_CODE_BODY + r"``|`" + _INLINE_CODE_BODY + r"`"
# The one definition of "renders verbatim", shared by every helper that must leave math AND
# code alone. The capturing group keeps the delimiters, so split() puts spans at odd indices.
_PROTECTED_RE = re.compile(
    r"(" + _DISPLAY_MATH + r"|" + _INLINE_MATH + r"|" + _INLINE_CODE + r")"
)

_LATEX_SPECIAL = {
    "{": r"\{",
    "}": r"\}",
    "$": r"\$",
    "%": r"\%",
    "&": r"\&",
    "#": r"\#",
    "_": r"\_",
    "^": r"\textasciicircum{}",
    "~": r"\textasciitilde{}",
}
# Latin incl. accented forms (Scheffé): Latin-1 Supplement + Latin Extended-A/B,
# minus the × (U+00D7) and ÷ (U+00F7) signs sitting in that block.
_LATIN = r"A-Za-zÀ-ÖØ-öø-ɏ"
_HEBREW = "֐-׿"


def normalize_dashes(text: str) -> str:
    """Convert em/en dashes to ASCII, which behave predictably under bidi. Code and
    math spans render verbatim, so a dash inside one is left alone."""

    parts = _PROTECTED_RE.split(text)
    for i in range(0, len(parts), 2):
        parts[i] = parts[i].replace("—", " - ").replace("–", "-")
    return "".join(parts)


def _latex_escape(s: str) -> str:
    """Escape LaTeX special characters. Backslash goes via a sentinel so its
    replacement isn't re-escaped by the following passes."""

    s = s.replace("\\", "\x00")
    for ch, esc in _LATEX_SPECIAL.items():
        s = s.replace(ch, esc)
    return s.replace("\x00", r"\textbackslash{}")


def apply_outside_fences(text: str, transform):
    """Run `transform` on prose only, passing fenced code blocks and callout div markers
    through untouched (the other helpers assume prose; code blocks are the Lua filter's job).

    A `::: definition` line must survive verbatim: the prose chain would rewrite its Latin
    class name to `::: \\LR{definition}` and pandoc would stop reading it as a div."""

    out, buf, in_fence = [], [], False
    for line in text.splitlines(keepends=True):
        stripped = line.lstrip()
        is_fence = stripped.startswith("```") or stripped.startswith("~~~")
        if is_fence:
            if buf:
                joined = "".join(buf)
                out.append(joined if in_fence else transform(joined))
                buf = []
            out.append(line)
            in_fence = not in_fence
        elif not in_fence and DIV_MARKER_RE.match(line.rstrip("\n")):
            if buf:
                out.append(transform("".join(buf)))
                buf = []
            out.append(line)
        else:
            buf.append(line)
    if buf:
        joined = "".join(buf)
        out.append(joined if in_fence else transform(joined))
    return "".join(out)


def ensure_blank_before_lists(text: str) -> str:
    """Insert the blank line pandoc needs before a list that follows a paragraph."""

    lines = text.splitlines(keepends=True)
    result = []
    in_display_math = False
    for i, line in enumerate(lines):
        # A `-` line inside $$…$$ is math, not a list; a blank line there would end the
        # paragraph for pandoc and split the display block.
        if not in_display_math and i > 0 and _LIST_ITEM_RE.match(line):
            prev = lines[i - 1]
            if prev.strip() and not _LIST_ITEM_RE.match(prev):
                result.append("\n")
        result.append(line)
        if line.count("$$") % 2:
            in_display_math = not in_display_math
    return "".join(result)
