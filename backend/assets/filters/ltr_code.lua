-- ltr_code.lua
--
-- Force LTR rendering for every fenced code block in an RTL (Hebrew) document.
--
-- Why \begin{english} and not \begin{LTR}:
--   \begin{LTR} (from bidi/polyglossia) is just \beginL...\endL — a paragraph-
--   level run direction switch. It fixes word order but NOT character mirroring:
--   ( -> ), { -> }, < -> > all still flip inside fancyvrb's Verbatim
--   (the environment pandoc's Highlighting is built on). The mirroring is
--   applied at a level below bidi runs whenever the document base direction
--   is RTL.
--
--   \begin{english} is polyglossia's language switch — it sets English as the
--   *active language* inside its scope, which makes the local base direction
--   LTR. Character mirroring is disabled because the surrounding context is
--   no longer RTL. Hebrew elsewhere in the document is unaffected.
--
-- This works for plain verbatim blocks AND syntax-highlighted blocks
-- (Shaded / Highlighting / Verbatim from fancyvrb), preserving colours.

function CodeBlock(el)
  return {
    pandoc.RawBlock('latex', '\\begin{english}'),
    el,
    pandoc.RawBlock('latex', '\\end{english}'),
  }
end
