# PDF rendering — pandoc + XeLaTeX

The summary is a Hebrew-primary RTL document with English fragments (code, terminology). `pipeline/to_pdf.py` preprocesses the markdown with the pure helpers in `pipeline/pdf/`, then runs pandoc → XeLaTeX with polyglossia and `\setmainlanguage{hebrew}`, the bundled fonts in `assets/fonts/`, the template in `assets/templates/`, and the Lua filter in `assets/filters/`.

## Two-pass render

`convert_to_pdf(md_path) -> (pdf_path, warning|None)` runs the two tools itself instead of letting pandoc drive the engine:

1. **pandoc → `build.tex`** (no `--pdf-engine`), so the generated LaTeX is a file we own.
2. **`xelatex -interaction=nonstopmode build.tex`, twice** — the second pass is what hyperref/bookmark need for stable references, exactly what pandoc's engine loop was doing.

Both run with the cwd set to one tempdir, so every aux file (`.aux`, `.log`, `.out`) lands there and nothing leaks beside the markdown. XeLaTeX names its output after the `.tex` stem, so `build.pdf` is moved onto `output_path` at the end.

`nonstopmode` is the recovery lever: TeX skips past an error and **still emits a PDF**, exiting non-zero. Hence the outcome rules:

| XeLaTeX outcome                   | Result                                                             |
| --------------------------------- | ------------------------------------------------------------------ |
| exit 0                            | success, `warning is None`                                          |
| non-zero, PDF exists and non-empty | accepted — the PDF is returned with the classified warning text     |
| no PDF, or a 0-byte PDF           | `PdfRenderError`. Empty stays fatal; `_require_nonempty` agrees      |

A damaged region renders wrong or blank while the rest of the document is fine, which is far more robust than guessing which source line to excise.

The warning rides two dotfiles in the lecture dir, written by `_exec_pdf` (the pipeline function stays pure and carries nothing but paths):

- `.pdf_warning` — the one-line warning, written after the PDF upload succeeds and deleted on a clean render, so it never outlives or precedes its PDF. The database inlines it onto the `summary.pdf` tree entry as `warning`, and drops it whenever `summary.pdf` is deleted — that rule lives only there.
- `.pdf_build.tex` — the generated LaTeX, kept only on a hard failure. `PdfRenderError.tex_source` carries it out of the tempdir before it vanishes; `_exec_pdf` persists it.

### Course overview PDFs

`course/to_pdf.py` mirrors this per slug: the warning for `{slug}.pdf` goes to `.{slug}.pdf_warning` in the overview dir, again written only after the PDF upload, and the database inlines it onto the `{slug}.pdf` entry of the overview file listing. It differs in how a clean render clears the marker — it writes it **empty** rather than deleting it, because the database exposes no overview delete route; an empty marker reads as no warning. There is no `.pdf_build.tex` equivalent: a hard failure raises and the runner records it as the slug's error.

## Engine constraints

This TeX Live build (`xelatex 3.141592653-2.6-0.999993`) uses the **e-TeX TeXXeT** bidi model.

- Defined: `\beginL`, `\endL`, `\beginR`, `\endR`, `\LR{}`, `\RL{}`, `\LRE{}`, `\TeXXeTstate`, `\XeTeXcharclass`.
- **Undefined**: `\pardir`, `\textdir`, `\bodydir` (LuaTeX-XeTeX primitives). In `\AtBeginEnvironment` hooks they fail with "Undefined control sequence"; inside `formatcom={...}` they may partially parse and leak their argument as literal text (`TLT` in the PDF).
- **Undefined**: `\LTRverbatim` — bidi.sty is installed but `bidiverbatim.sty` is not.

Probe with a `\ifx\foo\@undefined NO\else YES\fi` test file before assuming a primitive exists.

## Code blocks

`assets/filters/ltr_code.lua` wraps every `CodeBlock` in `\begin{english}`.

`\begin{LTR}` is not enough: it is just `\beginL...\endL`, a run-direction switch. It fixes token order but NOT **character mirroring** — `(`↔`)`, `{`↔`}`, `<`↔`>` still flip inside fancyvrb's `Verbatim` (what pandoc's `Highlighting` is built on). Mirroring is triggered by the active language's base direction at tokenization time, below the bidi-run level; per-token `\LR{}` doesn't reach it either.

`\begin{english}` is a polyglossia **language switch**: inside its scope the active language is English, so the local base direction is LTR, mirroring is off, Hebrew elsewhere is unaffected, and pandoc's Shaded/Highlighting/Verbatim machinery (including colours) works unchanged.

Already tried and each failed differently: `\begin{LTR}`, `\LTRverbatim`, `\AtBeginEnvironment{Shaded}{\pardir TLT...}`, `\renewenvironment{Shaded}{}{}`, per-token `\LR{}`, `--listings`. Note `Shaded` is already `\newenvironment{Shaded}{}{}` in pandoc 2.9 — there is no background to remove, overriding it accomplishes nothing.

### The mono font must cover Hebrew

`Verbatim` uses the **global `\ttfamily`**, not polyglossia's `\englishfonttt` — even inside `\begin{english}`. A Latin-only mono leaves Hebrew comments as notdef boxes, and XeLaTeX has no per-glyph font fallback (that's LuaTeX/luaotfload). So one dual-script monospace is set globally via `\setmonofont`: **Miriam Mono CLM** (Culmus, dual-script, true monospace). Setting only `\englishfonttt` does nothing.

## Failure messages

Both the raised error and the non-fatal warning are classified by `pipeline/pdf/tex_errors.py`'s `parse_tex_errors` / `format_tex_errors` (pure, wrapped by `classify`) into one short line — first `! …` error, its line, the offending source, plus a count of the rest — because they reach the user as a toast. The `l.<N>` number is a line of the **generated** `.tex`, never of `summary.md`; on a hard failure that file is kept as `.pdf_build.tex`, so the number is actually lookup-able.

Sources: pandoc's own failure is classified over both its streams; the XeLaTeX passes are classified over `build.log`, falling back to stdout only when no log was written — stdout mirrors the log, so reading both would count every error twice. A failure with no `! …` lines (unparseable markdown, missing template, engine absent) keeps the full log.

## Markdown preprocessing

`convert_to_pdf` runs a fixed chain of pure string helpers via `apply_outside_fences`, which never touches content inside ``` / ~~~ fences (those are the Lua filter's job). The helpers live in `pipeline/pdf/`, split by concern: `text.py` (the shared Latin/Hebrew/inline-math vocabulary, LaTeX escaping, and the fence/list structural helpers), `math_fixes.py` (everything math), `bidi.py` (`wrap_english_phrases` + `force_ltr_inline_code`) and `tex_errors.py` (log parsing). `text.py` imports from neither of the other two — they both import from it. Each helper has a dedicated test class in `tests/pipeline/pdf/test_<module>.py`.

Protected-region handling is the recurring theme, and balanced delimiters are its precondition — one unclosed `$$` desyncs every math span after it, so `close_unbalanced_display_math` runs first. Beyond that: `$$…$$` is matched before `$…$`, the inline-math body excludes backticks (a `$` inside a code span is a literal, and pandoc won't let math cross a code span), and splitting happens over the WHOLE text — line-by-line first would break multi-line display math and leak its Latin contents into the phrase wrapper. The protected-span pattern has one definition, `text._PROTECTED_RE`, so every helper agrees on what is verbatim; its code alternative stops at a newline to match `bidi._INLINE_CODE_RE`, since a stretch one of them protects and the other declines to treat as code would be wrapped by neither.

| Helper                          | What it fixes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `close_unbalanced_display_math` | The LLM opens a display block with `$$` but closes it with a lone `$`; the stray delimiter pairs with the next `$$`, so later math bodies fall outside the protected region and `\frac` gets rewritten as `\LR{frac}`. Triggers only on a whole line of the form `$$…$` with no other `$` or backtick.                                                                                                                                                                                                                                                                                                                  |
| `normalize_dashes`              | em/en dashes → ASCII, which behave predictably under bidi. Skips code and math spans, which render verbatim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `unwrap_math_code`              | The LLM backticks whole math expressions; unwrapped they'd render as literal `$…$` source. Only fires when the span's entire body is one math expression, so `` `RSI` `` stays code.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `demote_math_identifier`        | `$_exit$` makes the leading `_` a subscript operator. Syscall/identifier names are code, not math → rewritten to a backtick span. Narrow trigger (`_` + letter + 2+ ident chars) leaves `$x_i$`, `$_2F_1$`, `$a_{ij}$` alone.                                                                                                                                                                                                                                                                                                                                                                                           |
| `unwrap_math_text_macros`       | `\text{\Pi}` switches to text mode where `\Pi` is undefined → "Missing $ inserted". Only fires when the body is a single macro.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `normalize_math_text_spaces`    | XeLaTeX trims edge spaces inside `\text{}` at the bidi boundary, fusing words together. Moves them out as math control spaces (`\ `).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `wrap_math_text_dir`            | `\text{}` inherits the surrounding base direction, so English inside math renders word-reversed and Hebrew lands on the wrong side. Gives the body an explicit direction by its FIRST strong character (UAX#9): Latin → `\LR{}`, Hebrew → `\RL{}`. A body with no strong character (`\text{ }`, `\text{123}`) is left bare — nothing to reorder, and an island would only give its neutrals a new boundary to attach to. `\RL{}` is explicit rather than relying on the inherited RTL, which is wrong once `merge_ltr_math` nests the math inside an `\LR{}`.                                                           |
| `normalize_math_spans`          | Pandoc requires no space adjacent to the `$` delimiters.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ensure_blank_before_lists`     | Pandoc needs a blank line before a list that follows a paragraph. Lines inside a `$$…$$` block are math, not a list, so they never get one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `wrap_english_phrases`          | The big one — see below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `force_ltr_inline_code`         | Backtick spans → `\LR{\texttt{…}}`. Enough for word order (a plain `\texttt` in an RTL paragraph reverses), since no `Verbatim` is involved. NOT enough for a comma-separated **number** list: digits are weak European Numbers and the comma is a neutral, so each comma jumps ahead of its number — an LRM (U+200E) after any comma preceding a digit pins it. Letters are strong L and never need this.                                                                                                                                                                                                              |
| `merge_rtl_math_number`         | The RTL mirror: a number beside a Hebrew `\text{}` sits outside it in LTR math flow, so `240 \text{ תאים}` renders "תאים 240". Pulls that one number INTO the `\RL{}` body (`\RL{}` is text-mode only, so the merged run must live inside the `\text{}`) wrapped in `\ensuremath{}` — it was math before the move, so it must still typeset as math after it; a number already inside the body (`\text{שלב 2 ואילך}`) never was math and is left as text. Only whitespace / `\ ` may separate them, one number, one side; a Latin body or a preceding `^`/`_`/digit disqualifies it, and an adjacent `=` stays outside. |
| `merge_ltr_math`                | An inline-code `\LR{}` and an adjacent `$…$` are two separate LTR islands, which RTL bidi orders right-to-left. Merges them into one run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### `wrap_english_phrases`

Wraps Latin runs in `\LR{}` (with LaTeX escaping, since tokens like `x86_64` carry special chars) so they don't reorder inside the RTL paragraph. Its regex is deliberately fussy; the durable reasons:

- **Latin range includes accented forms** (Latin-1 Supplement + Latin Extended-A/B, minus `×`/`÷`). ASCII-only would cut "Scheffé" and orphan the `é` in the RTL run.
- **A numeric prefix glued to a letter joins the run** (`4KB`, `64GB`, `3-way`) — otherwise the neutral number reorders after it. A number with a space before the letter ("4 שקלים") is not glued.
- **A number alone is a continuation, never an anchor** — so "Software 1.0" is one run, while a Hebrew-adjacent "5 שקלים" stays untouched.
- **Separators (space, `, `, `-`, abbreviation `. `) are glue only when another Latin token follows**, so a sentence-final period or a dash before Hebrew stays with the RTL side.
- **Trailing separators are excluded** from the run so they don't jump to its far edge; a possessive apostrophe is kept inside ("Tukey's" as one run, not `\LR{Tukey}’\LR{s}`). It also glues **across a following space** ("Bayes' Rule" as one run, else the two islands reverse to "Rule' Bayes") — but only after a sibilant (`s`/`x`/`z`), which is what keeps a closing quote between Latin words ("’word’ here") outside the run.
- **A leading slash is glued only when not directly after a Hebrew letter**: `/index.html` is a path, but "גרעינים/kernels" is a word separator and pulling the slash into the run moves it to the run's left edge.
- **A balanced parenthesized group is wrapped whole**, parens included, so the neutral `(` `)` don't reorder. Requiring the matching `)` means a lone `)` on the Hebrew side is never swallowed.
- **Exception**: a group ending in a digit (`(Software 1.0)`) has its parens kept OUTSIDE the run — a `)` right after a digit inside `\LR{}` mirrors. Letter-terminated groups don't.
- **Punctuation directly after a protected span** is wrapped in `\RL{}` explicitly, else bidi attaches it to the LTR island. This happens after the Latin substitution, otherwise the phrase regex matches the literal "RL".

## Verifying a bidi fix

Tests on the LaTeX string only verify structure — mirroring happens at render time. Compile the real PDF and inspect it, but **do not substring-match `fitz` `get_text()`**: PyMuPDF emits glyphs in _visual_ order, so each Hebrew word comes out reversed and Latin islands land wherever they sit on the page. Searching for a bug signature there yields both false positives and false negatives. It only bites when the line mixes RTL with an LTR island AND you care about order/adjacency across that boundary; presence/absence checks and pure-LTR code blocks are fine.

Reliable check — reconstruct true left-to-right order from glyph x-coordinates:

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

Read the boundary by eye: Hebrew runs are reversed, but the relative placement of the LTR island and its dashes is faithful.
