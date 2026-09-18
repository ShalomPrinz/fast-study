# Bidi — Hebrew RTL with English islands

The summary is a Hebrew-primary RTL document with English fragments (code, terminology, math). Direction is fixed in three places: the pure markdown helpers in `pipeline/pdf/`, the Lua filter `assets/filters/text_direction.lua`, and `LATEX_HEADER` in `pipeline/to_pdf.py`. The render itself is [PDF.md](PDF.md).

## Engine constraints

Tectonic bundles XeTeX, which uses the **e-TeX TeXXeT** bidi model.

- Defined: `\beginL`, `\endL`, `\beginR`, `\endR`, `\LR{}`, `\RL{}`, `\LRE{}`, `\TeXXeTstate`, `\XeTeXcharclass`.
- **Undefined**: `\pardir`, `\textdir`, `\bodydir` (LuaTeX primitives). In `\AtBeginEnvironment` hooks they fail with "Undefined control sequence"; inside `formatcom={...}` they may leak their argument as literal text (`TLT` in the PDF).
- **Undefined**: `\LTRverbatim` — bidi.sty is installed but `bidiverbatim.sty` is not.

Probe with a `\ifx\foo\@undefined NO\else YES\fi` test file before assuming a primitive exists.

**Package order in `LATEX_HEADER` is load-bearing.** bidi (loaded by polyglossia for Hebrew) rejects `graphicx` and `lineno` loaded after it, so `fvextra` and `tcolorbox`, which pull them in, sit at the very top, above polyglossia.

## The direction filter

`text_direction.lua` holds the AST rewrites that can't happen in the markdown or the header.

### Code blocks

Every `CodeBlock` is wrapped in `\begin{english}`. `\begin{LTR}` is not enough: it is a run-direction switch that fixes token order but NOT **character mirroring** — `(`↔`)`, `{`↔`}`, `<`↔`>` still flip inside fancyvrb's `Verbatim` (what pandoc's `Highlighting` builds on), because mirroring follows the active language's base direction at tokenization time. `\begin{english}` is a polyglossia **language switch**: base direction LTR, mirroring off, Hebrew elsewhere unaffected, pandoc's highlighting intact.

Tried and failed: `\begin{LTR}`, `\LTRverbatim`, `\AtBeginEnvironment{Shaded}{\pardir TLT...}`, `\renewenvironment{Shaded}{}{}`, per-token `\LR{}`, `--listings`. `Shaded` is already empty in pandoc 2.9 — there is no background to remove.

**The mono font must cover Hebrew.** `Verbatim` uses the **global `\ttfamily`**, not `\englishfonttt`, even inside `\begin{english}`, and XeTeX has no per-glyph fallback — a Latin-only mono leaves Hebrew comments as notdef boxes. So one dual-script monospace, **Miriam Mono CLM**, is set globally via `\setmonofont`.

**Long lines wrap.** `Verbatim` never warns about an over-long line — it just runs off the margin and is clipped. `fvextra`'s `breaklines` + `breakanywhere` + `breakautoindent` wrap at the original indent and split an unbreakable token (a URL) mid-token. `breaklines` is an fvextra key, not a fancyvrb one. Every break marker is suppressed so the code stays copy-pasteable.

### Tables

Every `AlignDefault` column becomes `AlignRight`. bidi already reverses column order, but pandoc emits `l` for an unaligned column, leaving cell contents flush left. An explicit alignment (`:---`, `---:`) is the author's and is kept — which is why this is an AST rewrite rather than a global redefinition of `l`.

### Callout boxes

`summarize.md` may mark a passage as a fenced div — `::: definition` … `:::` — in a **closed set**: `definition`, `warning`, `insight`. The filter maps each to a `tcolorbox` environment (`callout<class>`) from `LATEX_HEADER` and drops the `Div` node itself. An unmapped class falls through as plain prose, so a hallucinated class degrades instead of failing. `fenced_divs` is on by default in pandoc 2.9.2.1's markdown reader.

The boxes are title-less — frame colour identifies the kind, so a short summary doesn't read like a textbook. Tints are near-white for grayscale contrast, and the frames sit at distinct luminances to stay tellable apart in print. `breakable` is a separate tcolorbox library and not available, so a callout must fit on one page. RTL needs nothing special: contents inherit the document's base direction.

The marker line must reach pandoc **byte-for-byte** — `wrap_english_phrases` would otherwise rewrite it to `::: \LR{definition}`, which is no longer a div. `apply_outside_fences` passes it through verbatim like a fence line, so the exemption covers the whole prose chain; the div's body is still preprocessed. `DIV_MARKER_RE` lives in `pipeline/pdf/text.py` and `course/summary_md.py` re-exports it, since `pipeline/` may not import `course/`.

## Markdown preprocessing

`preprocess_markdown` is a fixed chain of pure string helpers run via `apply_outside_fences`, which never touches ``` / ~~~ fences (the filter's job) nor a `:::` marker line. Modules: `text.py` (shared Latin/Hebrew/inline-math vocabulary, LaTeX escaping, fence/list helpers — imports neither sibling), `math_fixes.py`, `bidi.py` (`wrap_english_phrases`, `force_ltr_inline_code`) and `tex_errors.py` (log parsing).

Protected regions are the recurring theme, and balanced delimiters are their precondition — one unclosed `$$` desyncs every math span after it, so `close_unbalanced_display_math` runs first. `$$…$$` is matched before `$…$`; the inline-math body excludes backticks (a `$` in a code span is literal, and pandoc won't let math cross one); and splitting runs over the WHOLE text — line-by-line would break multi-line display math and leak its Latin into the phrase wrapper.

Math **and** code compose into one splitter, `_PROTECTED_RE`, each alternative defined once in `text.py`, so no two helpers disagree on what is verbatim. Both protections must hold in one pass: a backtick inside `$$…$$` must not pair with a later prose one, and a `$…$` inside a code span (`` `awk '{print $1}'` ``) must not cut it in two. `bidi._INLINE_CODE_RE` reuses the same bodies because a span one protects and the other doesn't comes out double-wrapped. A **doubled** backtick delimiter is matched first and whole, with markdown's one-space padding strip — matching the inner pair leaves the outer backticks and the `\LR{…}` prints literally.

| Helper                          | What it fixes                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `close_unbalanced_display_math` | The LLM opens with `$$` and closes with a lone `$`; the stray pairs with the next `$$` and later math gets rewritten as prose. Triggers only on a whole `$$…$` line with no other `$` or backtick.                                                                                                                                              |
| `normalize_dashes`              | em/en dashes → ASCII, which behave predictably under bidi. Skips code and math.                                                                                                                                                                                                                                                                |
| `unwrap_math_code`              | The LLM backticks whole math expressions, which would render as literal `$…$`. Fires only when the whole span body is one math expression, so `` `RSI` `` stays code.                                                                                                                                                                          |
| `demote_math_identifier`        | `$_exit$` makes `_` a subscript. Identifier names are code → rewritten to a backtick span. Narrow trigger (`_` + letter + 2+ ident chars) leaves `$x_i$`, `$a_{ij}$` alone.                                                                                                                                                                    |
| `unwrap_math_text_macros`       | `\text{\Pi}` is text mode, where `\Pi` is undefined → "Missing $ inserted". Only for a single-macro body.                                                                                                                                                                                                                                       |
| `normalize_math_text_spaces`    | XeTeX trims edge spaces inside `\text{}` at the bidi boundary, fusing words. Moves them out as `\ `.                                                                                                                                                                                                                                           |
| `wrap_math_text_dir`            | `\text{}` inherits the surrounding direction, reversing English and misplacing Hebrew. Wraps the body by its FIRST strong character (UAX#9): Latin → `\LR{}`, Hebrew → `\RL{}`; no strong character → bare. `\RL{}` is explicit because the inherited RTL is wrong once `merge_ltr_math` nests the math in an `\LR{}`.                           |
| `normalize_math_spans`          | Pandoc requires no space adjacent to the `$` delimiters.                                                                                                                                                                                                                                                                                       |
| `ensure_blank_before_lists`     | Pandoc needs a blank line before a list after a paragraph. Lines inside `$$…$$` are math, never a list.                                                                                                                                                                                                                                        |
| `wrap_english_phrases`          | See below.                                                                                                                                                                                                                                                                                                                                     |
| `force_ltr_inline_code`         | Backtick spans → `\LR{\textenglish{\texttt{…}}}`, rewriting the protected halves of the shared split and leaving math alone. `\LR{}` keeps the span one LTR run and is the prefix `merge_ltr_math` matches; `\textenglish{}` makes the base direction LTR, without which a comma-separated number list reorders (`98, 183, 37` → `,98 ,183 37`). |
| `merge_rtl_math_number`         | A number beside a Hebrew `\text{}` sits in LTR math flow, so `240 \text{ תאים}` renders reversed. Pulls that one number into the `\RL{}` body (`\RL{}` is text-mode only) inside `\ensuremath{}`, since it was math; a number already in the body stays text. Whitespace-only separation, one number, one side; a Latin body or a preceding `^`/`_`/digit disqualifies. |
| `merge_ltr_math`                | An `\LR{}` run and an adjacent `$…$` are two LTR islands that RTL orders right-to-left. Merges them into one, brace-matching so a nested `\textenglish{}` survives (`ה-$init$ (PID 1)` → `\LR{$init$ \textenglish{(PID 1)}}`).                                                                                                                  |

### `wrap_english_phrases`

Wraps Latin runs in `\LR{}` (LaTeX-escaped — `x86_64` carries special chars) so they don't reorder inside the RTL paragraph. The regex is deliberately fussy:

- **Latin includes accented forms** (Latin-1 Supplement + Extended-A/B, minus `×`/`÷`), else "Scheffé" orphans its `é`.
- **A numeric prefix glued to a letter joins the run** (`4KB`, `3-way`); "4 שקלים", with a space, does not.
- **A number alone is a continuation, never an anchor** — "Software 1.0" is one run, "5 שקלים" stays untouched.
- **Separators (space, `, `, `-`, abbreviation `. `) glue only when another Latin token follows**, so a sentence-final period or a dash before Hebrew stays RTL.
- **Trailing separators are excluded**, so they don't jump to the run's far edge. A possessive apostrophe stays inside ("Tukey's"), and after a sibilant (`s`/`x`/`z`) glues across the following space ("Bayes' Rule") — the sibilant restriction keeps a closing quote ("’word’ here") outside.
- **A leading slash is glued only when not right after a Hebrew letter**: `/index.html` is a path, "גרעינים/kernels" is a separator.
- **A balanced `(…)` / `[…]` group is wrapped whole**, delimiters included; requiring the closer means a lone one on the Hebrew side is never swallowed. The body must still anchor on a Latin word — a bare `(0)` already resolves correctly.
- **A group directly after a word belongs to it** (`console.log('hi')`, `arr[i]`), else the two islands print backwards.
- **A run ENDING in `<digit>)` becomes `\LR{\textenglish{…}}`** — that paren sits on the RTL boundary and mirrors inside a bare `\LR{}` (`(Software 1.0)` → `(Software (1.0`). Only `)` mirrors; `]` and a mid-run `)` are safe.
- **Punctuation directly after a protected span** is wrapped in `\RL{}`, else bidi attaches it to the LTR island — after the Latin substitution, or the phrase regex matches the literal "RL".

## Verifying a bidi fix

Tests on the LaTeX string verify structure only — mirroring happens at render time, so compile the real PDF. **Never substring-match PyMuPDF's `get_text()`**: it emits glyphs in _visual_ order, reversing each Hebrew word and placing Latin islands wherever they sit, so a bug-signature search gives false positives and negatives on any line mixing RTL with an LTR island. Instead reconstruct true left-to-right order: take `get_text("rawdict")`, group every char by its rounded `origin` y, and sort each line by `origin` x. Hebrew runs read reversed, but the placement of the LTR island and its punctuation is faithful. `tests/pipeline/test_to_pdf.py` does exactly this.
