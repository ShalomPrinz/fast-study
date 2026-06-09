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
MATH_SPAN_RE = re.compile(r'\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$')
INLINE_CODE_RE = re.compile(r'`([^`\n]+)`')
# A code span whose entire body is one math expression: the LLM wraps math in
# backticks (`$...$`). The trailing ` must follow the closing $ (only whitespace
# between) so spans mixing code and prose — `RSI` — are left as real code.
MATH_IN_CODE_RE = re.compile(r'`\s*(\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$)\s*`')

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
# A "Latin token" for bidi-wrapping: starts with an optional digit-hyphen
# prefix (3-way) and/or a leading slash (/index.html), then a letter, then any
# mix of letters/digits/underscore plus separators (dot/hyphen/slash and the
# apostrophes '/’) that are FOLLOWED by more letters/digits (HTTP/1.1, Node.js,
# /api/v2, NP-hard, Tukey’s). The lookahead excludes a TRAILING separator so it
# stays with the following text instead of the LTR run — and so a possessive
# apostrophe keeps "Tukey’s" as ONE \LR run instead of \LR{Tukey}’\LR{s} (which
# left the neutral ’ in RTL, reordering to "s HSD'Tukey").
_WORD = (
    r'(?:[0-9]+\-)?/?[' + _LATIN + r']'
    r"(?:[" + _LATIN + r"0-9_]|[\-/.'’](?=[" + _LATIN + r'0-9]))*'
)
MULTI_LATIN_RE = re.compile(r'(' + _WORD + r'(?:[ \t]+' + _WORD + r')*)([.,;:!?]*)')
LEADING_PUNCT_RE = re.compile(r'^([.,;:!?]+)')


def wrap_english_phrases(text: str) -> str:
    def replace(m: re.Match) -> str:
        phrase, punct = m.group(1), m.group(2)
        # Latin tokens can contain LaTeX-special chars (e.g. the _ in x86_64).
        # Unescaped, _ enters math mode inside \LR{}.
        # Before: x86_64  -> \LR{x86_64}   -> "! Missing $ inserted"
        # After:  x86_64  -> \LR{x86\_64}  -> renders "x86_64"
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
    _PROTECTED_RE = re.compile(r'(\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$|`[^`]*`)')
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


def force_ltr_inline_code(text: str) -> str:
    # RTL paragraph + plain \texttt{} = bidi reverses multi-word code spans.
    # No wrap: `void execute`         -> rendered as "execute void"
    # Wrap:    \LR{\texttt{void execute}} -> rendered as "void execute"
    return INLINE_CODE_RE.sub(
        lambda m: r'\LR{\texttt{' + _latex_escape(m.group(1)) + '}}',
        text,
    )


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
        t = normalize_math_spans(t)
        t = ensure_blank_before_lists(t)
        t = wrap_english_phrases(t)
        t = force_ltr_inline_code(t)
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
