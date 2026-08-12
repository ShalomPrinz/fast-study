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

-- Callout classes summarize.md may emit, mapped to the tcolorbox environments defined in
-- pipeline/to_pdf.py's LATEX_HEADER. Closed set — anything else falls through as prose.
local CALLOUT_ENV = {
  definition = 'calloutdefinition',
  warning = 'calloutwarning',
  insight = 'calloutinsight',
}

-- Wrap a `::: definition` fenced div in its box. The Div itself is dropped: pandoc's LaTeX
-- writer renders a Div as bare contents anyway, and returning it would nest it in its own box.
function Div(el)
  for _, class in ipairs(el.classes) do
    local env = CALLOUT_ENV[class]
    if env then
      local blocks = { pandoc.RawBlock('latex', '\\begin{' .. env .. '}') }
      for _, block in ipairs(el.content) do
        table.insert(blocks, block)
      end
      table.insert(blocks, pandoc.RawBlock('latex', '\\end{' .. env .. '}'))
      return blocks
    end
  end
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
