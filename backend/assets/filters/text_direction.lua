-- Direction fixes pandoc's AST is the only place to make, in an RTL (Hebrew) document.
-- See backend/docs/PDF.md.

-- Force LTR rendering for every fenced code block.
-- \begin{english} is a polyglossia LANGUAGE switch, so the local base direction is LTR and
-- bracket mirroring stops; \begin{LTR} only switches run direction and is not enough.
function CodeBlock(el)
  return {
    pandoc.RawBlock('latex', '\\begin{english}'),
    el,
    pandoc.RawBlock('latex', '\\end{english}'),
  }
end

-- Right-align table columns the markdown left unaligned. bidi already reverses the column
-- ORDER, but pandoc emits `l` for AlignDefault, so cells stay flush left inside an RTL table.
-- An explicit alignment in the markdown is the author's, and is left alone.
function Table(el)
  for i, align in ipairs(el.aligns) do
    if align == 'AlignDefault' then
      el.aligns[i] = 'AlignRight'
    end
  end
  return el
end
