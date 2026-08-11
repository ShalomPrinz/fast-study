import re

from pipeline.pdf.text import _HEBREW, _INLINE_MATH, _LATIN

_MATH_SPAN_RE = re.compile(r"\$\$[\s\S]*?\$\$|" + _INLINE_MATH)
# A code span whose ENTIRE body is one math expression, so spans mixing code and
# prose (`RSI`) are left as real code.
_MATH_IN_CODE_RE = re.compile(r"`\s*(\$\$[\s\S]*?\$\$|" + _INLINE_MATH + r")\s*`")

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

    return _MATH_IN_CODE_RE.sub(lambda m: m.group(1), text)


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


# One \text{} body, shared by the two passes below. Deliberately region-wide, not
# math-only: the chain runs it over prose where a literal \text{} is not a real input.
_TEXT_BODY_RE = re.compile(r"\\text\s*\{([^{}]*)\}")


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

    return _TEXT_BODY_RE.sub(repl, text)


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

    return _TEXT_BODY_RE.sub(repl, text)


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
    last = 0  # start of the untouched run still to be flushed
    n = len(text)
    while i < n:
        # Skip display math wholesale — never reorder or descend into it.
        if text.startswith("$$", i):
            j = text.find("$$", i + 2)
            i = (j + 2) if j != -1 else n
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
                out.append(text[last:i])
                out.append(r"\LR{" + inner + " " + m.group(0) + "}")
                i = last = m.end()
                continue
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
                    out.append(text[last:i])
                    out.append(r"\LR{" + m.group(0) + " " + inner + "}")
                    i = last = end
                    continue
        i += 1
    out.append(text[last:])
    return "".join(out)


def normalize_math_spans(text: str) -> str:
    """Strip padding inside inline math — pandoc requires no space adjacent to the `$` delimiters."""

    def replace(m: re.Match) -> str:
        s = m.group(0)
        if s.startswith("$$"):
            return s
        return "$" + s[1:-1].strip() + "$"

    return _MATH_SPAN_RE.sub(replace, text)
