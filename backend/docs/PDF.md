# PDF rendering - pandoc, LaTeX

## bidi/LaTeX gotchas

This is a Hebrew-primary RTL document with English fragments (code, terminology). The pipeline uses pandoc + XeLaTeX + polyglossia with `\setmainlanguage{hebrew}`. Several things that *seem* like they should work, don't — these were learned the hard way, don't re-discover them.

### Direction primitives: TeXXeT only, NOT XeTeX-native

The XeLaTeX in this TeX Live build (`xelatex 3.141592653-2.6-0.999993`, TeX Live 2022) uses the **e-TeX TeXXeT** bidi model:

- **Defined**: `\beginL`, `\endL`, `\beginR`, `\endR`, `\LR{...}`, `\RL{...}`, `\LRE{...}`, `\TeXXeTstate`, `\XeTeXcharclass`
- **UNDEFINED**: `\pardir`, `\textdir`, `\bodydir` — these are LuaTeX-XeTeX primitives that exist in some other TeX engines but not this one. Using them in `\AtBeginEnvironment` hooks fails with "Undefined control sequence", and inside `formatcom={...}` they may be partially-parsed and leak the argument as literal text (`TLT` appearing in PDF output).
- **Also undefined**: `\LTRverbatim` — bidi.sty is installed but the `bidiverbatim.sty` add-on is not. Don't try to use `\begin{LTRverbatim}...\end{LTRverbatim}` here.

`xelatex --version` to confirm the engine. To probe which primitives exist, compile a small file with `\ifx\foo\@undefined NO\else YES\fi` lines.

### Code Blocks

#### `\begin{LTR}` is not enough for code blocks

`\begin{LTR}...\end{LTR}` (polyglossia/bidi) is just `\beginL...\endL` — a **run direction switch**. It fixes word/token order at the paragraph level but does NOT fix **character mirroring**: `(` ↔ `)`, `{` ↔ `}`, `<` ↔ `>` still flip inside `fancyvrb`'s `Verbatim` (the environment pandoc's `Highlighting` is built on via `\DefineVerbatimEnvironment{Highlighting}{Verbatim}{...}`). Mirroring is triggered by the **active language's base direction** at character-tokenization time — below the bidi run level. Wrapping individual tokens in `\LR{}` doesn't help either; the mirroring is deeper still.

#### Using `\begin{english}` (polyglossia language switch)

`backend/assets/filters/ltr_code.lua` wraps every `CodeBlock` in `\begin{english}...\end{english}`. This is a polyglossia **language switch**, not just a direction switch — inside the scope, the *active language* becomes English, so:

- Local base direction is LTR → no character mirroring
- Hebrew elsewhere in the document is unaffected
- Pandoc's `Shaded`/`Highlighting`/`Verbatim` machinery works unchanged → syntax-highlighting colours preserved

This is the only approach I've found that works on this engine. Don't replace it with `\begin{LTR}`, `\LTRverbatim`, `\AtBeginEnvironment{Shaded}{\pardir TLT...}`, `\renewenvironment{Shaded}{}{}`, per-token `\LR{}` wraps, or `--listings` — all of these were tried and each failed in a different way. See the comment block in `ltr_code.lua` for the rationale.

#### The code-block mono font must cover Hebrew

`fancyvrb`'s `Verbatim` uses the **global `\ttfamily`**, NOT polyglossia's `\englishfonttt` gloss — even inside `\begin{english}`. So a Latin-only mono leaves Hebrew comments (`# שמירת...`) as notdef boxes (`￿`). XeLaTeX has **no per-glyph font fallback** (that's LuaTeX/luaotfload), so a single dual-script monospace must be set globally. We bundle **Miriam Mono CLM** (Culmus, dual-script + true monospace, all advances 600) in `assets/fonts/` and point `\setmonofont` at it in `LATEX_HEADER`. Setting only `\englishfonttt` does nothing — Verbatim never consults it. Don't revert to `Noto Sans Mono` / Latin Modern Mono (no Hebrew glyphs).

### Dead ends to remember

- **`Shaded` env is already empty in pandoc 2.9**: `\newenvironment{Shaded}{}{}`. There is no gray background to "remove" and overriding `Shaded` accomplishes nothing.
- **Inline code (` `` `) is separate**: `force_ltr_inline_code` in `to_pdf.py` wraps backtick code in `\LR{\texttt{...}}`. This is enough for inline because no `fancyvrb`/`Verbatim` is involved — it's a regular LaTeX `\texttt` token in an RTL paragraph, and `\LR{}` IS enough to fix that.
- **Verifying a PDF fix is non-negotiable**: tests on the LaTeX string output only verify structure. Bracket mirroring happens at XeLaTeX render time. Compile the actual PDF and extract text before claiming any bidi fix works — but read the PyMuPDF caveat below first, because the naive `get_text()` extraction lies about RTL.

### PyMuPDF `get_text()` returns RTL in VISUAL order — don't substring-match it

When verifying a bidi/dash/order fix, the obvious check is `fitz.open(p).load_page(0).get_text()` followed by `"NP-ש" in text`. **This gives false positives and false negatives on Hebrew lines.** PyMuPDF emits glyphs in *visual* (left-to-right on the page) order, not *logical* (reading) order. For an RTL line each Hebrew word comes out reversed, and Latin/neutral fragments land wherever they sit visually — so a correctly-rendered `כ-NP-שלמה` extracts as `המלש-NP-כ`, and a search for the bug signature `NPש` matches purely as an artifact of that reversal (the `ה` of a reversed `למחלקה` lands next to `NP`). I wasted a verification cycle trusting this.

**When it bites:** any time the line mixes RTL (Hebrew) with an LTR island (English term, code, math) AND you care about the *order/adjacency* of characters across that boundary — exactly the dash/bidi bugs this file is about. It does NOT bite when you only care about presence/absence of a glyph, or for pure-LTR code blocks.

**Reliable check — inspect true visual order via glyph x-coordinates:**

```python
import fitz
from collections import defaultdict
d = fitz.open(p).load_page(0).get_text("rawdict")
lines = defaultdict(list)
for b in d["blocks"]:
    for l in b.get("lines", []):
        for s in l["spans"]:
            for c in s["chars"]:
                lines[round(c["origin"][1])].append((c["origin"][0], c["c"]))
for y in sorted(lines):
    print(repr("".join(ch for _, ch in sorted(lines[y]))))  # sorted by x = true L→R
```

Then read the boundary by eye: Hebrew runs are reversed (e.g. `שלמה`→`המלש`), but the *relative placement* of the LTR island and the dashes is faithful. `.תומלש-NP` is visually `NP-שלמות.` (hyphen between NP and Hebrew = correct); a fused `NPשלמות` with no dash would be the real bug. Verify dash/order fixes this way, not with `in` on `get_text()`.
