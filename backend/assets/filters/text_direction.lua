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

-- Plain text of a bidi-made `\LR{...}` / `\RL{...}` run, or nil when it holds TeX beyond bidi's escapes.
local function lr_plain(tex)
  local body = tex:match('^\\LR{(.*)}$') or tex:match('^\\RL{(.*)}$')
  if not body then return nil end
  body = body:gsub('^\\textenglish{\\texttt{(.*)}}$', '%1'):gsub('^\\textenglish{(.*)}$', '%1')
  body = body:gsub('\\textbackslash{}', '\1'):gsub('\\textasciitilde{}', '\2'):gsub('\\textasciicircum{}', '\3')
  -- Only bidi's own `\{`-style escapes may remain; any other TeX leaves the run alone.
  if body:gsub('\\[_&%%#${}]', ''):find('[\\{}$]') then return nil end
  body = body:gsub('\\([_&%%#${}])', '%1')
  return (body:gsub('\1', '\\'):gsub('\2', '~'):gsub('\3', '^'))
end

-- pandoc builds a heading's PDF bookmark from the AST and drops raw TeX, so a `\LR{X}` run vanishes
-- from it. Pair each run with its plain text in a nested \texorpdfstring.
function Header(el)
  el.content = el.content:walk {
    RawInline = function(raw)
      if raw.format ~= 'tex' and raw.format ~= 'latex' then return nil end
      local plain = lr_plain(raw.text)
      if not plain then return nil end
      return {
        pandoc.RawInline('latex', '\\texorpdfstring{' .. raw.text .. '}{'),
        pandoc.Str(plain),
        pandoc.RawInline('latex', '}'),
      }
    end,
  }
  return el
end
