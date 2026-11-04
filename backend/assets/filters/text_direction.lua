-- Fail with pandoc's own version error on anything older than the pinned 3.13 instead of a nil index.
PANDOC_VERSION:must_be_at_least '3.13'

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

-- Right-align unaligned table columns: pandoc emits `l` for AlignDefault, so cells sit flush left
-- in an RTL table. An explicit alignment is the author's and is kept.
function Table(el)
  local changed = false
  for _, spec in ipairs(el.colspecs) do
    if spec[1] == 'AlignDefault' then
      spec[1] = 'AlignRight'
      changed = true
    end
  end
  if changed then return el end
end
