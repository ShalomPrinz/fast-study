import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from timing import timed_pipeline

FONTS_DIR = Path(__file__).parent.parent / "assets" / "fonts"
HEBREW_FONT = FONTS_DIR / "NotoSansHebrew-Regular.ttf"
HEBREW_FONT_BOLD = FONTS_DIR / "NotoSansHebrew-Bold.ttf"
LTR_CODE_FILTER = Path(__file__).parent.parent / "assets" / "filters" / "ltr_code.lua"

LATEX_HEADER = r"""
\usepackage{polyglossia}
\setmainlanguage{hebrew}
\setotherlanguage{english}
\newfontfamily\hebrewfont{NotoSansHebrew-Regular}[Script=Hebrew, Path=FONTS_DIR_PLACEHOLDER, Extension=.ttf, BoldFont=NotoSansHebrew-Bold]
\newfontfamily\hebrewfontsf{NotoSansHebrew-Regular}[Script=Hebrew, Path=FONTS_DIR_PLACEHOLDER, Extension=.ttf, BoldFont=NotoSansHebrew-Bold]
\newfontfamily\hebrewfonttt{NotoSansHebrew-Regular}[Script=Hebrew, Path=FONTS_DIR_PLACEHOLDER, Extension=.ttf, BoldFont=NotoSansHebrew-Bold]
\newfontfamily\englishfont{NotoSansHebrew-Regular}[Path=FONTS_DIR_PLACEHOLDER, Extension=.ttf, BoldFont=NotoSansHebrew-Bold]
\newfontfamily\englishfontsf{NotoSansHebrew-Regular}[Path=FONTS_DIR_PLACEHOLDER, Extension=.ttf, BoldFont=NotoSansHebrew-Bold]
\newfontfamily\englishfonttt{MiriamMonoCLM-Book}[Path=FONTS_DIR_PLACEHOLDER, Extension=.ttf, BoldFont=MiriamMonoCLM-Bold]
\setmonofont{MiriamMonoCLM-Book}[Path=FONTS_DIR_PLACEHOLDER, Extension=.ttf, BoldFont=MiriamMonoCLM-Bold]
"""

LIST_ITEM_RE = re.compile(r"^(\s*(?:[-*+]|\d+\.)\s)")
# Excludes the backtick: a `$` inside inline code is a literal, and pandoc won't let
# math cross a code span — so two unrelated code spans must never pair up as "math".
_INLINE_MATH = r"\$[^\$\n`]+?\$"
MATH_SPAN_RE = re.compile(r"\$\$[\s\S]*?\$\$|" + _INLINE_MATH)
INLINE_CODE_RE = re.compile(r"`([^`\n]+)`")
# A code span whose ENTIRE body is one math expression, so spans mixing code and
# prose (`RSI`) are left as real code.
MATH_IN_CODE_RE = re.compile(r"`\s*(\$\$[\s\S]*?\$\$|" + _INLINE_MATH + r")\s*`")

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
# A possessive apostrophe after a sibilant ("Bayes' Rule") glues across the space
# too, so the run isn't split into two islands. Restricting the lookbehind to s/x/z
# is what keeps a closing quote between Latin words ("’word’ here") outside the run.
_POSSESSIVE = r"(?<=[sxzSXZ])['’](?=[ \t]+[" + _LATIN + r"])"
# One Latin token: an optional numeric prefix and/or leading slash glued to a letter,
# then letters/digits/underscore with separators that are FOLLOWED by more of the same.
# See docs/PDF.md for why each piece is shaped this way.
_WORD = (
    r"(?:[0-9]+-?)?(?:(?<![" + _HEBREW + r"])/)?[" + _LATIN + r"]"
    r"(?:[" + _LATIN + r"0-9_]|[\-/.'’](?=[" + _LATIN + r"0-9])|" + _POSSESSIVE + r")*"
)
# A number joins a phrase as a CONTINUATION only, never an anchor — so a lone
# Hebrew-adjacent number ("5 שקלים") stays untouched in the RTL run.
_NUM = r"[0-9]+(?:[.,][0-9]+)*"
# Separators kept INSIDE one \LR run, but only when another Latin token follows —
# a sentence-final period/comma is left for the trailing \RL{} group.
_SEP = r"(?:[ \t]+-[ \t]+|,[ \t]+|[ \t]+|\.[ \t]+)"
# A balanced parenthesized group joins the run whole, so its neutral parens can't
# reorder. Requiring the matching ) keeps a lone ) on the Hebrew side out.
_GROUP = r"\(" + _WORD + r"(?:" + _SEP + r"(?:" + _WORD + r"|" + _NUM + r"))*\)"
_ITEM = r"(?:" + _GROUP + r"|" + _WORD + r")"
_CONT = r"(?:" + _GROUP + r"|" + _WORD + r"|" + _NUM + r")"
MULTI_LATIN_RE = re.compile(r"(" + _ITEM + r"(?:" + _SEP + _CONT + r")*)([.,;:!?]*)")
LEADING_PUNCT_RE = re.compile(r"^([.,;:!?]+)")
# A whole phrase that is one parenthetical ending in a digit: a `)` right after a
# digit inside \LR{} mirrors, so these parens are kept outside the run.
_DIGIT_PAREN_GROUP_RE = re.compile(r"^\([^()]*[0-9]\)$")


def wrap_english_phrases(text: str) -> str:
    """Wrap Latin runs in \\LR{} so they don't reorder inside the RTL paragraph."""

    def replace(m: re.Match) -> str:
        phrase, punct = m.group(1), m.group(2)
        # Latin tokens carry LaTeX-special chars (the _ in x86_64 enters math mode unescaped).
        if _DIGIT_PAREN_GROUP_RE.match(phrase):
            result = "(" + r"\LR{" + _latex_escape(phrase[1:-1]) + "}" + ")"
        else:
            result = r"\LR{" + _latex_escape(phrase) + "}"
        if punct:
            result += r"\RL{" + punct + "}"
        return result

    # Split on math/code spans so MULTI_LATIN_RE never touches them: the capturing
    # group keeps delimiters, so odd indices are protected and even ones substituted.
    _PROTECTED_RE = re.compile(r"(\$\$[\s\S]*?\$\$|" + _INLINE_MATH + r"|`[^`]*`)")
    parts = _PROTECTED_RE.split(text)
    out = []
    for i, part in enumerate(parts):
        if i % 2 == 1:
            out.append(part)
        else:
            # Punctuation right after a protected span would attach to the LTR island via
            # bidi. Force it RTL — after the Latin sub, else the regex matches the "RL".
            leading = ""
            if i > 0:
                m = LEADING_PUNCT_RE.match(part)
                if m:
                    leading = r"\RL{" + m.group(1) + "}"
                    part = part[m.end() :]
            out.append(leading + MULTI_LATIN_RE.sub(replace, part))
    return "".join(out)


def normalize_dashes(text: str) -> str:
    """Convert em/en dashes to ASCII, which behave predictably under bidi."""

    return text.replace("—", " - ").replace("–", "-")


# Whole line: opens `$$`, no other `$` or backtick in the body, closes with a lone `$`.
_UNBALANCED_DISPLAY_MATH_RE = re.compile(
    r"^([ \t]*\$\$[^$`\n]+)\$[ \t]*$", re.MULTILINE
)


def close_unbalanced_display_math(text: str) -> str:
    """Close a display block the LLM opened with `$$` but ended with a lone `$` —
    the stray delimiter pairs with a LATER `$$`, desyncing every math span after it."""

    return _UNBALANCED_DISPLAY_MATH_RE.sub(r"\1$$", text)


def unwrap_math_code(text: str) -> str:
    """Strip the backticks the LLM puts around whole math expressions,
    which would otherwise render as literal `$...$` source."""

    return MATH_IN_CODE_RE.sub(lambda m: m.group(1), text)


# Body shape (_ + letter + 2+ ident chars) excludes real math: $x_i$, $_2F_1$, $a_{ij}$.
_MATH_IDENTIFIER_RE = re.compile(r"(?<!\$)\$\s*(_[A-Za-z][A-Za-z0-9_]+)\s*\$(?!\$)")


def demote_math_identifier(text: str) -> str:
    """Rewrite an underscore-led identifier in math (`$_exit$`) as a code span —
    it's code, and the leading _ would otherwise become a subscript operator."""

    return _MATH_IDENTIFIER_RE.sub(lambda m: "`" + m.group(1) + "`", text)


_TEXT_WRAPPED_MACRO_RE = re.compile(r"\\text\s*\{\s*(\\[A-Za-z]+)\s*\}")


def unwrap_math_text_macros(text: str) -> str:
    """Unwrap a math-only macro the LLM put in \\text{} — text mode leaves \\Pi
    undefined. Only fires when the whole body is one macro, sparing \\text{ s.t. }."""

    return _TEXT_WRAPPED_MACRO_RE.sub(lambda m: m.group(1), text)


_TEXT_EDGE_SPACE_RE = re.compile(r"\\text\s*\{([^{}]*)\}")


def normalize_math_text_spaces(text: str) -> str:
    """Move \\text{}'s edge spaces out as math control spaces — XeLaTeX trims them
    at the bidi boundary, fusing the adjacent math token onto the word."""

    def repl(m: re.Match) -> str:
        body = m.group(1)
        if not body.strip():
            return r"\ "
        lead = r"\ " if body[:1].isspace() else ""
        trail = r"\ " if body[-1:].isspace() else ""
        return lead + r"\text{" + body.strip() + "}" + trail

    return _TEXT_EDGE_SPACE_RE.sub(repl, text)


_MATH_TEXT_BODY_RE = re.compile(r"\\text\s*\{([^{}]*)\}")
# First strong character of a \text{} body decides its base direction (UAX#9 P2/P3).
_FIRST_STRONG_RE = re.compile(r"([" + _LATIN + r"])|([" + _HEBREW + r"])")


def wrap_math_text_dir(text: str) -> str:
    """Give each \\text{} body an explicit base direction — math text mode inherits
    the document's RTL base, so English reverses and Hebrew keeps the wrong side."""

    def repl(m: re.Match) -> str:
        body = m.group(1)
        strong = _FIRST_STRONG_RE.search(body)
        # No strong character (spaces, digits, punctuation) — nothing to reorder,
        # and an island would only give the neutrals a new boundary to attach to.
        if not strong:
            return m.group(0)
        macro = r"\LR{" if strong.group(1) else r"\RL{"
        return r"\text{" + macro + body + "}}"

    return _MATH_TEXT_BODY_RE.sub(repl, text)


_MATH_NUMBER = r"[0-9]+(?:[.,][0-9]+)*"
_RTL_MATH_TEXT = r"\\text\s*\{\\RL\{([^{}]*)\}\}"
# Only whitespace and the math control space may sit between the number and the text.
_MATH_GAP = r"(?:[ \t]|\\ )*"
# The number must be a standalone math token: a preceding ^/_/./letter/digit means it
# belongs to another token (an exponent, a subscript, a decimal tail), not to the text.
_MERGE_RTL_NUMBER_RE = re.compile(
    r"(?<![0-9A-Za-z^_.\\])("
    + _MATH_NUMBER
    + r")("
    + _MATH_GAP
    + r")"
    + _RTL_MATH_TEXT
    + r"|"
    + _RTL_MATH_TEXT
    + r"("
    + _MATH_GAP
    + r")("
    + _MATH_NUMBER
    + r")"
    + r"(?![0-9A-Za-z^_.{])"
)


def merge_rtl_math_number(text: str) -> str:
    """Pull a number adjacent to a Hebrew \\text{} into its \\RL{} run — left outside,
    the number stays in LTR math flow and the two islands order wrongly against each
    other. \\RL{} is text-mode only, so the merged run has to live inside the \\text{}."""

    def repl(m: re.Match) -> str:
        num, gap, body = (
            (m.group(1), m.group(2), m.group(3))
            if m.group(1)
            else (m.group(6), m.group(5), m.group(4))
        )
        # The number was in math flow, so it keeps math typesetting after the move;
        # \ensuremath re-enters math inside the text-mode \text{} body.
        num = r"\ensuremath{" + num + "}"
        gap = " " if gap else ""
        parts = (num, gap, body) if m.group(1) else (body, gap, num)
        return r"\text{\RL{" + "".join(parts) + "}}"

    return _MERGE_RTL_NUMBER_RE.sub(repl, text)


_INLINE_MATH_ONLY_RE = re.compile(_INLINE_MATH)


def _lr_block_end(text: str, start: int) -> int:
    """Index just past the "}" matching the "\\LR{" at `start`, counting nested
    braces and skipping escaped ones."""

    i = start + 4  # past "\LR{"
    depth = 1
    n = len(text)
    while i < n and depth:
        c = text[i]
        if c == "\\":
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        i += 1
    return i


def merge_ltr_math(text: str) -> str:
    """Merge an adjacent \\LR{...} and inline $...$ (either order) into one run —
    as two separate LTR islands, RTL bidi would order them right-to-left."""

    out = []
    i = 0
    n = len(text)
    while i < n:
        # Skip display math wholesale — never reorder or descend into it.
        if text.startswith("$$", i):
            j = text.find("$$", i + 2)
            j = (j + 2) if j != -1 else n
            out.append(text[i:j])
            i = j
            continue
        if text.startswith(r"\LR{", i):
            end = _lr_block_end(text, i)
            inner = text[i + 4 : end - 1]
            k = end
            while k < n and text[k] in " \t":
                k += 1
            m = (
                _INLINE_MATH_ONLY_RE.match(text, k)
                if k < n and text[k] == "$"
                else None
            )
            if m:
                out.append(r"\LR{" + inner + " " + m.group(0) + "}")
                i = m.end()
                continue
            out.append(text[i:end])
            i = end
            continue
        if text[i] == "$":
            m = _INLINE_MATH_ONLY_RE.match(text, i)
            if m:
                k = m.end()
                while k < n and text[k] in " \t":
                    k += 1
                if text.startswith(r"\LR{", k):
                    end = _lr_block_end(text, k)
                    inner = text[k + 4 : end - 1]
                    out.append(r"\LR{" + m.group(0) + " " + inner + "}")
                    i = end
                    continue
        out.append(text[i])
        i += 1
    return "".join(out)


def normalize_math_spans(text: str) -> str:
    """Strip padding inside inline math — pandoc requires no space adjacent to the `$` delimiters."""

    def replace(m: re.Match) -> str:
        s = m.group(0)
        if s.startswith("$$"):
            return s
        return "$" + s[1:-1].strip() + "$"

    return MATH_SPAN_RE.sub(replace, text)


def _latex_escape(s: str) -> str:
    """Escape LaTeX special characters. Backslash goes via a sentinel so its
    replacement isn't re-escaped by the following passes."""

    s = s.replace("\\", "\x00")
    for ch, esc in _LATEX_SPECIAL.items():
        s = s.replace(ch, esc)
    return s.replace("\x00", r"\textbackslash{}")


_LRM = "‎"  # LEFT-TO-RIGHT MARK — a zero-width strong-LTR anchor
_CODE_NUM_COMMA_RE = re.compile(r",(?=\s*[0-9])")


def force_ltr_inline_code(text: str) -> str:
    """Render inline code LTR as \\LR{\\texttt{...}}; an LRM after a comma that
    precedes a digit additionally pins comma-separated number lists (weak bidi)."""

    def repl(m: re.Match) -> str:
        body = _CODE_NUM_COMMA_RE.sub("," + _LRM, _latex_escape(m.group(1)))
        return r"\LR{\texttt{" + body + "}}"

    return INLINE_CODE_RE.sub(repl, text)


def apply_outside_fences(text: str, transform):
    """Run `transform` on prose only, passing fenced code blocks through untouched
    (the other helpers assume prose; code blocks are the Lua filter's job)."""

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
    for i, line in enumerate(lines):
        if i > 0 and LIST_ITEM_RE.match(line):
            prev = lines[i - 1]
            if prev.strip() and not LIST_ITEM_RE.match(prev):
                result.append("\n")
        result.append(line)
    return "".join(result)


@dataclass(frozen=True)
class TexError:
    """One `! …` error from a TeX run. `line` numbers the GENERATED .tex, which is
    thrown away with pandoc's temp dir — it maps to nothing in summary.md."""

    message: str
    line: int | None
    source: str  # offending source line, rejoined across TeX's break
    at: str  # the part TeX had read when it failed — the error point


_TEX_LINE_RE = re.compile(r"^l\.(\d+)(.*)$")
# TeX puts the `l.<N>` marker a few lines after the `!`, past any <recently read> /
# <argument> context lines; bounded so a `!` with no marker can't adopt a later one.
_TEX_LINE_LOOKAHEAD = 20
_AT_MAX_CHARS = 40


def parse_tex_errors(log: str) -> list[TexError]:
    """Extract the `! message` / `l.<N>` / offending-source triples from a XeLaTeX log.
    Tolerant: an error with no `l.<N>` marker is still returned, with no line number."""

    lines = log.splitlines()
    errors: list[TexError] = []
    for i, line in enumerate(lines):
        if not line.startswith("!") or not line[1:].strip():
            continue
        num, at, source = None, "", ""
        for j in range(i + 1, min(i + 1 + _TEX_LINE_LOOKAHEAD, len(lines))):
            if lines[j].startswith("!"):
                break
            m = _TEX_LINE_RE.match(lines[j])
            if not m:
                continue
            num = int(m.group(1))
            at = m.group(2).strip()
            # TeX echoes the rest of the source line indented on the next line,
            # padded to align under the break point.
            tail = lines[j + 1] if j + 1 < len(lines) else ""
            source = (at + tail.strip()) if tail.startswith(" ") else at
            break
        errors.append(TexError(line[1:].strip().rstrip("."), num, source, at))
    return errors


def format_tex_errors(errors: list[TexError]) -> str:
    """Render parsed TeX errors as ONE short line — it lands in a toast and in /status,
    so it reports the first error plus a count of the rest, never the whole log."""

    if not errors:
        return ""
    first = errors[0]
    where = ""
    if first.line is not None:
        at = first.at[:_AT_MAX_CHARS]
        where = f" (line {first.line}: {at})" if at else f" (line {first.line})"
    more = f" and {len(errors) - 1} more" if len(errors) > 1 else ""
    return f"LaTeX error: {first.message}{where}{more}"


@timed_pipeline("pdf")
def convert_to_pdf(md_path: str) -> str:
    """Preprocess a markdown file and render it to a PDF beside it via pandoc + XeLaTeX."""

    input_path = Path(md_path)
    if not input_path.exists():
        raise FileNotFoundError(f"File not found: {md_path}")
    if not HEBREW_FONT.exists():
        raise FileNotFoundError(f"Font not found: {HEBREW_FONT}")
    if not HEBREW_FONT_BOLD.exists():
        raise FileNotFoundError(f"Font not found: {HEBREW_FONT_BOLD}")
    if not LTR_CODE_FILTER.exists():
        raise FileNotFoundError(f"Lua filter not found: {LTR_CODE_FILTER}")

    output_path = input_path.with_suffix(".pdf")
    fonts_dir = str(FONTS_DIR) + "/"
    header = LATEX_HEADER.replace("FONTS_DIR_PLACEHOLDER", fonts_dir)

    raw_md = input_path.read_text(encoding="utf-8")

    def preprocess(t: str) -> str:
        t = close_unbalanced_display_math(t)
        t = normalize_dashes(t)
        t = unwrap_math_code(t)
        t = demote_math_identifier(t)
        t = unwrap_math_text_macros(t)
        t = normalize_math_text_spaces(t)
        t = wrap_math_text_dir(t)
        t = normalize_math_spans(t)
        t = ensure_blank_before_lists(t)
        t = wrap_english_phrases(t)
        t = force_ltr_inline_code(t)
        t = merge_rtl_math_number(t)
        t = merge_ltr_math(t)
        return t

    fixed_md = apply_outside_fences(raw_md, preprocess)

    with tempfile.NamedTemporaryFile(mode="w", suffix=".tex", delete=False) as f:
        f.write(header)
        header_path = f.name

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".md", delete=False, encoding="utf-8"
    ) as f:
        f.write(fixed_md)
        md_temp_path = f.name

    template_path = (
        Path(__file__).parent.parent / "assets" / "templates" / "pandoc_template.tex"
    )

    cmd = [
        "pandoc",
        md_temp_path,
        "-o",
        str(output_path),
        "--from=markdown-smart",
        "--pdf-engine=xelatex",
        f"--template={template_path}",
        "-V",
        "geometry:margin=2.5cm",
        "-V",
        "linestretch=1.3",
        f"--include-in-header={header_path}",
        f"--lua-filter={LTR_CODE_FILTER}",
        "--standalone",
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    Path(header_path).unlink(missing_ok=True)
    Path(md_temp_path).unlink(missing_ok=True)

    if result.returncode != 0:
        # pandoc relays engine output on either stream, so classify both; a failure
        # with no `! …` at all is pandoc's own and keeps the full log.
        tex_errors = parse_tex_errors(f"{result.stdout}\n{result.stderr}")
        if tex_errors:
            raise RuntimeError(format_tex_errors(tex_errors))
        raise RuntimeError(f"pandoc failed:\n{result.stderr}")

    return str(output_path)
