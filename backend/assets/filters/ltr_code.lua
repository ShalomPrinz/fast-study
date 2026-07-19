-- Force LTR rendering for every fenced code block in an RTL (Hebrew) document.
-- \begin{english} is a polyglossia LANGUAGE switch, so the local base direction is LTR and
-- bracket mirroring stops; \begin{LTR} only switches run direction and is not enough.
-- See backend/docs/PDF.md.

function CodeBlock(el)
  return {
    pandoc.RawBlock('latex', '\\begin{english}'),
    el,
    pandoc.RawBlock('latex', '\\end{english}'),
  }
end
