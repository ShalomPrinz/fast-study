import re
import subprocess
import tempfile
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

LIST_ITEM_RE = re.compile(r'^(\s*(?:[-*+]|\d+\.)\s)')
# Inline math body excludes the backtick: a `$` inside inline code (`$`, `$myvar`)
# is a LITERAL dollar, never a math delimiter, and pandoc won't let math cross a
# code span. Without the exclusion the pattern pairs a `$` in one code span with
# a `$` in another, swallowing the Hebrew between them as "math".
# Before: `$` לפני שמו. ללא הסימן `$`  -> \(\LR{\texttt{ לפני... }}\) "Missing $ inserted"
# After:  same input                   -> two literal code spans, no false math
_INLINE_MATH = r'\$[^\$\n`]+?\$'
MATH_SPAN_RE = re.compile(r'\$\$[\s\S]*?\$\$|' + _INLINE_MATH)
INLINE_CODE_RE = re.compile(r'`([^`\n]+)`')
# A code span whose entire body is one math expression: the LLM wraps math in
# backticks (`$...$`). The trailing ` must follow the closing $ (only whitespace
# between) so spans mixing code and prose — `RSI` — are left as real code.
MATH_IN_CODE_RE = re.compile(r'`\s*(\$\$[\s\S]*?\$\$|' + _INLINE_MATH + r')\s*`')

_LATEX_SPECIAL = {
    '{': r'\{',
    '}': r'\}',
    '$': r'\$',
    '%': r'\%',
    '&': r'\&',
    '#': r'\#',
    '_': r'\_',
    '^': r'\textasciicircum{}',
    '~': r'\textasciitilde{}',
}
# Latin letters incl. accented forms (Scheffé, café): Latin-1 Supplement +
# Latin Extended-A/B, minus the × (U+00D7) and ÷ (U+00F7) signs sitting in that
# block. ASCII-only [A-Za-z] used to cut "Scheffé" -> \LR{Scheff}+é, orphaning
# the é in the RTL run so it rendered as "éScheff".
_LATIN = r'A-Za-zÀ-ÖØ-öø-ɏ'
_HEBREW = '֐-׿'
# A "Latin token" for bidi-wrapping: starts with an optional numeric prefix
# (digits, optionally then a hyphen) that is GLUED to the following letter
# (3-way, 4KB, 64GB) and/or a leading slash (/index.html), then a letter, then any
# mix of letters/digits/underscore plus separators (dot/hyphen/slash and the
# apostrophes '/’) that are FOLLOWED by more letters/digits (HTTP/1.1, Node.js,
# /api/v2, NP-hard, Tukey’s). The lookahead excludes a TRAILING separator so it
# stays with the following text instead of the LTR run — and so a possessive
# apostrophe keeps "Tukey’s" as ONE \LR run instead of \LR{Tukey}’\LR{s} (which
# left the neutral ’ in RTL, reordering to "s HSD'Tukey").
# The leading slash is only glued when NOT directly attached to a preceding
# Hebrew letter: a slash bridging Hebrew→English ("גרעינים/kernels") is a word
# SEPARATOR, and pulling it into the \LR run moves it to the run's far (left)
# edge so it reads "גרעינים kernels/". A real path slash ("/index.html") is
# preceded by a space or line start, so it is still glued.
# Before: גרעינים/kernels -> ...\LR{/kernels} -> slash after the word
# After:  גרעינים/kernels -> .../\LR{kernels} -> slash between the words
# The numeric prefix's hyphen is OPTIONAL so a number glued directly to a Latin
# token stays in the LTR run; otherwise the token starts at the letter, leaving
# the neutral number to reorder after it under RTL ("4KB" -> "KB4"). A number
# with a SPACE before the letter ("4 שקלים") is not glued — the prefix must be
# immediately followed by the letter.
# Before: 4KB  -> 4\LR{KB} -> "KB4"
# After:  4KB  -> \LR{4KB} -> "4KB"
_WORD = (
    r'(?:[0-9]+-?)?(?:(?<![' + _HEBREW + r'])/)?[' + _LATIN + r']'
    r"(?:[" + _LATIN + r"0-9_]|[\-/.'’](?=[" + _LATIN + r'0-9]))*'
)
# A number token (1.0, 3.14, 2,5) joins an English phrase as a CONTINUATION
# only — never an anchor. So "Software 1.0" wraps as one \LR run (else the lone
# "1.0" stays a neutral and RTL bidi reorders it to "1.0 Software"), while a
# Hebrew-adjacent number ("5 שקלים") is left untouched in the RTL run.
_NUM = r'[0-9]+(?:[.,][0-9]+)*'
# Separator between Latin tokens kept INSIDE one \LR run: a plain space, an
# abbreviation period+space ("SMP vs. AMP", "i.e. foo"), a spaced hyphen
# (" - ", as in "FIFO - First-In"), or a comma+space (", ", as in
# "First-In, First-Out"). Each is glue ONLY when another Latin token follows
# (the (?:_SEP _CONT)* loop demands it) — a sentence-final period/comma or a
# dash before Hebrew is left for the trailing \RL{} group so it stays RTL.
# Before: (FIFO - First-In, First-Out) -> \LR{FIFO} - \LR{First-In}\RL{,} \LR{First-Out} -> "(First-Out, First-In - FIFO)"
# After:  (FIFO - First-In, First-Out) -> \LR{(FIFO - First-In, First-Out)}               -> "(FIFO - First-In, First-Out)"
_SEP = r'(?:[ \t]+-[ \t]+|,[ \t]+|[ \t]+|\.[ \t]+)'
# A balanced parenthesized acronym/group attached to the phrase. Wrapping the
# WHOLE group — parens included — in \LR stops the neutral ( ) from reordering
# under RTL bidi. Requiring a matching ) means a lone ) on the Hebrew side is
# never swallowed into the run.
# Before: Symmetric Multiprocessing (SMP) -> \LR{Symmetric Multiprocessing} (\LR{SMP}) -> "Multiprocessing Symmetric) SMP"
# After:  Symmetric Multiprocessing (SMP) -> \LR{Symmetric Multiprocessing (SMP)}       -> "Symmetric Multiprocessing (SMP)"
_GROUP = r'\(' + _WORD + r'(?:' + _SEP + r'(?:' + _WORD + r'|' + _NUM + r'))*\)'
_ITEM = r'(?:' + _GROUP + r'|' + _WORD + r')'
# Continuation items may be numbers; the anchor (_ITEM) may not, so a phrase
# always starts on a Latin word/group.
_CONT = r'(?:' + _GROUP + r'|' + _WORD + r'|' + _NUM + r')'
MULTI_LATIN_RE = re.compile(r'(' + _ITEM + r'(?:' + _SEP + _CONT + r')*)([.,;:!?]*)')
LEADING_PUNCT_RE = re.compile(r'^([.,;:!?]+)')
# A whole-phrase that is a single balanced parenthetical ending in a digit:
# "(Software 1.0)". A `)` right after a digit, INSIDE \LR{} in an RTL document,
# mirrors to `(` ("(Software (1.0"). Letter-terminated groups don't, so they
# stay inside the run as before. Keep only digit-terminated groups' parens
# OUTSIDE the run — verified to render unmirrored.
_DIGIT_PAREN_GROUP_RE = re.compile(r'^\([^()]*[0-9]\)$')


def wrap_english_phrases(text: str) -> str:
    def replace(m: re.Match) -> str:
        phrase, punct = m.group(1), m.group(2)
        # Latin tokens can contain LaTeX-special chars (e.g. the _ in x86_64).
        # Unescaped, _ enters math mode inside \LR{}.
        # Before: x86_64  -> \LR{x86_64}   -> "! Missing $ inserted"
        # After:  x86_64  -> \LR{x86\_64}  -> renders "x86_64"
        if _DIGIT_PAREN_GROUP_RE.match(phrase):
            # Before: \LR{(Software 1.0)}  -> "(Software (1.0" (close paren flips)
            # After:  (\LR{Software 1.0})  -> "(Software 1.0)"
            result = '(' + r'\LR{' + _latex_escape(phrase[1:-1]) + '}' + ')'
        else:
            result = r'\LR{' + _latex_escape(phrase) + '}'
        if punct:
            result += r'\RL{' + punct + '}'
        return result

    # Split on math/code spans so they are never touched by MULTI_LATIN_RE.
    # The capturing group makes re.split keep delimiters in the list: even
    # indices are plain text (substituted), odd indices are protected (passed
    # through). $$ before $ so display math isn't parsed as two inline spans.
    # Split across the WHOLE text — splitting line-by-line first would break
    # multi-line $$...$$ blocks, leaking their Latin contents into MULTI_LATIN_RE
    # and yielding `\LR{W}` inside math mode → "Missing $ inserted" from LaTeX.
    _PROTECTED_RE = re.compile(r'(\$\$[\s\S]*?\$\$|' + _INLINE_MATH + r'|`[^`]*`)')
    parts = _PROTECTED_RE.split(text)
    out = []
    for i, part in enumerate(parts):
        if i % 2 == 1:
            out.append(part)
        else:
            # If this plain-text part directly follows a protected span
            # (code/math) and starts with punctuation, that punctuation
            # would otherwise attach to the LTR span via bidi and render
            # LTR. Wrap it in \RL{} explicitly — but only AFTER the Latin
            # sub, otherwise MULTI_LATIN_RE matches the literal "RL".
            leading = ''
            if i > 0:
                m = LEADING_PUNCT_RE.match(part)
                if m:
                    leading = r'\RL{' + m.group(1) + '}'
                    part = part[m.end():]
            out.append(leading + MULTI_LATIN_RE.sub(replace, part))
    return ''.join(out)


def normalize_dashes(text: str) -> str:
    return text.replace('—', ' - ').replace('–', '-')


def unwrap_math_code(text: str) -> str:
    # Math the LLM wrapped in backticks renders as literal text otherwise:
    # force_ltr_inline_code escapes the `$`/`\` into \texttt, so the source
    # `$RDI \leftarrow RSI$` shows verbatim instead of as a formula.
    # Before: `$RDI \leftarrow RSI$`  -> "$RDI \leftarrow RSI$" (literal)
    # After:  `$RDI \leftarrow RSI$`  -> RDI ← RSI (rendered math)
    return MATH_IN_CODE_RE.sub(lambda m: m.group(1), text)


# An inline $...$ whose WHOLE body is an underscore-led identifier (_ + letter +
# 1+ more ident chars): a C syscall / name like _exit, _Exit. The lookarounds
# exclude $$-display delimiters. The body shape excludes real math — $x_i$
# (no leading _), $_2F_1$ (digit after _), $a_{ij}$ (has a brace).
_MATH_IDENTIFIER_RE = re.compile(
    r'(?<!\$)\$\s*(_[A-Za-z][A-Za-z0-9_]+)\s*\$(?!\$)'
)


def demote_math_identifier(text: str) -> str:
    # An underscore-led identifier in math $...$ makes the leading _ a subscript
    # operator, so "_exit" renders as a subscript "e" + "xit". These are CODE,
    # not math — rewrite the span as a backtick code span so it flows through the
    # working inline-code path (force_ltr_inline_code -> \LR{\texttt{\_exit}}).
    # Before: $_exit$  -> subscript "e" then "xit"
    # After:  `_exit`  -> "_exit"
    return _MATH_IDENTIFIER_RE.sub(lambda m: '`' + m.group(1) + '`', text)


_TEXT_WRAPPED_MACRO_RE = re.compile(r'\\text\s*\{\s*(\\[A-Za-z]+)\s*\}')


def unwrap_math_text_macros(text: str) -> str:
    # The LLM sometimes wraps a math-only macro in \text{}, e.g. \text{\Pi}_k.
    # \text switches to text mode where \Pi is undefined -> "Missing $ inserted".
    # Only fires when \text{}'s whole body is a single macro (real text like
    # \text{ s.t. } is left untouched).
    # Before: \text{\Pi}_k  -> pandoc/XeLaTeX error "Missing $ inserted"
    # After:  \Pi_k         -> renders as Π_k
    return _TEXT_WRAPPED_MACRO_RE.sub(lambda m: m.group(1), text)


_TEXT_EDGE_SPACE_RE = re.compile(r'\\text\s*\{([^{}]*)\}')


def normalize_math_text_spaces(text: str) -> str:
    # XeLaTeX trims a leading/trailing space INSIDE \text{} at the RTL/LTR bidi
    # boundary, fusing the adjacent math token onto the word.
    # Before: 1 \text{ within } t \text{ steps}  -> "within tsteps"
    # After:  1 \text{within}\  t \text{steps}\  -> "within t steps"
    # Move the edge spaces OUT of \text{} as math control spaces (\ ), which the
    # bidi layer preserves.
    def repl(m: re.Match) -> str:
        body = m.group(1)
        if not body.strip():
            return r'\ '
        lead = r'\ ' if body[:1].isspace() else ''
        trail = r'\ ' if body[-1:].isspace() else ''
        return lead + r'\text{' + body.strip() + '}' + trail
    return _TEXT_EDGE_SPACE_RE.sub(repl, text)


_MATH_TEXT_BODY_RE = re.compile(r'\\text\s*\{([^{}]*)\}')


def wrap_math_text_ltr(text: str) -> str:
    # English inside \text{} in math renders RTL (words reversed): \text switches
    # to text mode, which inherits the document's RTL base direction. Wrap the
    # body in \LR{} so the run is laid out left-to-right.
    # Before: \text{is an undirected graph}  -> "graph undirected an is"
    # After:  \text{\LR{is an undirected graph}} -> "is an undirected graph"
    def repl(m: re.Match) -> str:
        body = m.group(1)
        if not body.strip():
            return m.group(0)
        return r'\text{\LR{' + body + '}}'
    return _MATH_TEXT_BODY_RE.sub(repl, text)


_INLINE_MATH_ONLY_RE = re.compile(_INLINE_MATH)


def _lr_block_end(text: str, start: int) -> int:
    # start points at the backslash of a "\LR{". Return the index just past its
    # matching "}", counting nested braces and skipping escaped ones (\{ \} \\).
    i = start + 4  # past "\LR{"
    depth = 1
    n = len(text)
    while i < n and depth:
        c = text[i]
        if c == '\\':
            i += 2
            continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
        i += 1
    return i


def merge_ltr_math(text: str) -> str:
    # An inline-code span (now \LR{\texttt{...}}) and an adjacent inline math
    # $...$ are two SEPARATE LTR islands; RTL bidi orders the islands right-to-
    # left, reversing "current ← v" to "← v current". Merge a \LR{...} and an
    # adjacent inline $...$ (either order, whitespace between) into ONE \LR run.
    # Before: \LR{\texttt{current}} $\leftarrow v$  -> "← v current"
    # After:  \LR{\texttt{current} $\leftarrow v$}  -> "current ← v"
    out = []
    i = 0
    n = len(text)
    while i < n:
        # Skip display math wholesale — never reorder or descend into it.
        if text.startswith('$$', i):
            j = text.find('$$', i + 2)
            j = (j + 2) if j != -1 else n
            out.append(text[i:j])
            i = j
            continue
        if text.startswith(r'\LR{', i):
            end = _lr_block_end(text, i)
            inner = text[i + 4:end - 1]
            k = end
            while k < n and text[k] in ' \t':
                k += 1
            m = _INLINE_MATH_ONLY_RE.match(text, k) if k < n and text[k] == '$' else None
            if m:
                out.append(r'\LR{' + inner + ' ' + m.group(0) + '}')
                i = m.end()
                continue
            out.append(text[i:end])
            i = end
            continue
        if text[i] == '$':
            m = _INLINE_MATH_ONLY_RE.match(text, i)
            if m:
                k = m.end()
                while k < n and text[k] in ' \t':
                    k += 1
                if text.startswith(r'\LR{', k):
                    end = _lr_block_end(text, k)
                    inner = text[k + 4:end - 1]
                    out.append(r'\LR{' + m.group(0) + ' ' + inner + '}')
                    i = end
                    continue
        out.append(text[i])
        i += 1
    return ''.join(out)


def normalize_math_spans(text: str) -> str:
    # Pandoc's inline math requires next to math `$`.
    # No normalization: `$ \geq 0$`     -> Error: "Missing $ inserted"
    # Normalization:    `$ \geq 0 $`    -> "$\geq 0$"
    def replace(m: re.Match) -> str:
        s = m.group(0)
        if s.startswith('$$'):
            return s
        return '$' + s[1:-1].strip() + '$'
    return MATH_SPAN_RE.sub(replace, text)


def _latex_escape(s: str) -> str:
    # Sentinel for backslash so the replacement isn't re-escaped.
    s = s.replace('\\', '\x00')
    for ch, esc in _LATEX_SPECIAL.items():
        s = s.replace(ch, esc)
    return s.replace('\x00', r'\textbackslash{}')


_LRM = '‎'  # LEFT-TO-RIGHT MARK — a zero-width strong-LTR anchor
_CODE_NUM_COMMA_RE = re.compile(r',(?=\s*[0-9])')


def force_ltr_inline_code(text: str) -> str:
    # RTL paragraph + plain \texttt{} = bidi reverses multi-word code spans.
    # No wrap: `void execute`         -> rendered as "execute void"
    # Wrap:    \LR{\texttt{void execute}} -> rendered as "void execute"
    #
    # A comma-separated NUMBER list still misorders inside \LR{\texttt{}}: digits
    # are bidi "European Numbers" (weak) and a comma between them is a neutral
    # separator that \LR alone doesn't anchor, so each comma jumps ahead of its
    # number. An LRM after a comma that precedes a digit pins it LTR. (Letters are
    # strong L and never need this — only number lists break.)
    # Before: \LR{\texttt{98, 183, 37}}  -> ",98 ,183 37"
    # After:  \LR{\texttt{98,‎ 183,‎ 37}} -> "98, 183, 37"
    def repl(m: re.Match) -> str:
        body = _CODE_NUM_COMMA_RE.sub(',' + _LRM, _latex_escape(m.group(1)))
        return r'\LR{\texttt{' + body + '}}'
    return INLINE_CODE_RE.sub(repl, text)


def apply_outside_fences(text: str, transform):
    # Other markdown helpers treats input as prose without ```...``` fences, this function clears the fences.
    # Before: ```\nimport socket\n```        -> rendered text shows "\LR{import socket}"
    # After:  ```\nimport socket\n```        -> rendered as a clean code block
    out, buf, in_fence = [], [], False
    for line in text.splitlines(keepends=True):
        stripped = line.lstrip()
        is_fence = stripped.startswith('```') or stripped.startswith('~~~')
        if is_fence:
            if buf:
                joined = ''.join(buf)
                out.append(joined if in_fence else transform(joined))
                buf = []
            out.append(line)
            in_fence = not in_fence
        else:
            buf.append(line)
    if buf:
        joined = ''.join(buf)
        out.append(joined if in_fence else transform(joined))
    return ''.join(out)


def ensure_blank_before_lists(text: str) -> str:
    lines = text.splitlines(keepends=True)
    result = []
    for i, line in enumerate(lines):
        if i > 0 and LIST_ITEM_RE.match(line):
            prev = lines[i - 1]
            if prev.strip() and not LIST_ITEM_RE.match(prev):
                result.append('\n')
        result.append(line)
    return ''.join(result)


@timed_pipeline("pdf")
def convert_to_pdf(md_path: str) -> str:
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
        t = normalize_dashes(t)
        t = unwrap_math_code(t)
        t = demote_math_identifier(t)
        t = unwrap_math_text_macros(t)
        t = normalize_math_text_spaces(t)
        t = wrap_math_text_ltr(t)
        t = normalize_math_spans(t)
        t = ensure_blank_before_lists(t)
        t = wrap_english_phrases(t)
        t = force_ltr_inline_code(t)
        t = merge_ltr_math(t)
        return t

    fixed_md = apply_outside_fences(raw_md, preprocess)

    with tempfile.NamedTemporaryFile(mode="w", suffix=".tex", delete=False) as f:
        f.write(header)
        header_path = f.name

    with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False, encoding="utf-8") as f:
        f.write(fixed_md)
        md_temp_path = f.name

    template_path = Path(__file__).parent.parent / "assets" / "templates" / "pandoc_template.tex"

    cmd = [
        "pandoc", md_temp_path,
        "-o", str(output_path),
        "--from=markdown-smart",
        "--pdf-engine=xelatex",
        f"--template={template_path}",
        "-V", "geometry:margin=2.5cm",
        "-V", "linestretch=1.3",
        f"--include-in-header={header_path}",
        f"--lua-filter={LTR_CODE_FILTER}",
        "--standalone",
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    Path(header_path).unlink(missing_ok=True)
    Path(md_temp_path).unlink(missing_ok=True)

    if result.returncode != 0:
        raise RuntimeError(f"pandoc failed:\n{result.stderr}")

    return str(output_path)
