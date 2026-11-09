-- Drop an image whose src is not a file in the build dir (pandoc's cwd) -- a deleted figure, a URL, a typed
-- path -- so a missing image vanishes instead of failing the render.
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

function Image(el)
  if not is_file(el.src) then return {} end
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
