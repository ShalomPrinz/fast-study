-- Drop an image whose src is under figures/ and whose file is not in the build dir (pandoc's cwd), so a
-- link to a deleted figure vanishes instead of failing the render; any other src is left alone.
-- Runs on pandoc 3.1 and up, so it carries no version check.

local function is_file(src)
  if src == '' or src:sub(1, 1) == '/' or src:find('^%a:') or src:find('%.%.') then
    return false
  end
  local f = io.open(src, 'rb')
  if not f then return false end
  local _, err = f:read(0) -- a directory opens fine and only fails here
  f:close()
  return err == nil
end

local function is_gone_figure(el)
  return el.src:sub(1, 8) == 'figures/' and not is_file(el.src)
end

function Image(el)
  if is_gone_figure(el) then return {} end
end

local function blank(inlines)
  for _, i in ipairs(inlines) do
    if i.t ~= 'Space' and i.t ~= 'SoftBreak' then return false end
  end
  return true
end

-- What an image left alone in its paragraph becomes once it is gone.
function Para(el)
  if blank(el.content) then return {} end
end

Plain = Para

-- pandoc 3 wraps a lone image in a Figure; an emptied one would still print a captioned float.
function Figure(el)
  for _, b in ipairs(el.content) do
    if (b.t ~= 'Plain' and b.t ~= 'Para') or not blank(b.content) then return end
  end
  return {}
end
