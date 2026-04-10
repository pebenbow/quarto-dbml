-- dbml.lua  ──  Quarto/Pandoc Lua filter for DBML code blocks.
--
-- Intercepts ```dbml fenced blocks and produces:
--   HTML  →  inline SVG with CSS-variable colours (responds to dark mode)
--   PDF   →  PNG raster via @resvg/resvg-js; falls back to \includesvg
--   Other →  inline SVG fallback
--
-- Theme resolution (highest → lowest priority):
--   1. Block attribute:        ```{.dbml theme="dark"}
--   2. Document front matter:  dbml:\n  theme: dark
--   3. Project _quarto.yml:    dbml:\n  theme: dark   (Quarto merges this in)
--   4. Auto (default):         follows prefers-color-scheme / Bootstrap toggle
--
-- Echo resolution (highest → lowest priority):
--   1. Block attribute:        ```{.dbml echo="true"}
--   2. Document front matter:  dbml:\n  echo: true
--   3. Project _quarto.yml:    dbml:\n  echo: true
--   4. Default:                false (source is not shown)
--
-- Notation resolution (highest → lowest priority):
--   1. Block attribute:        ```{.dbml notation="crowsfoot"}
--   2. Document front matter:  dbml:\n  notation: crowsfoot
--   3. Project _quarto.yml:    dbml:\n  notation: crowsfoot
--   4. Default:                labels (text "1" / "N")
--                             Other values: crowsfoot, uml, arrows
--
-- Routing resolution (highest → lowest priority):
--   1. Block attribute:        ```{.dbml routing="rounded"}
--   2. Document front matter:  dbml:\n  routing: rounded
--   3. Project _quarto.yml:    dbml:\n  routing: rounded
--   4. Default:                smooth (cubic bezier curves)
--                             Other values: orthogonal, rounded
--
-- Level resolution (highest → lowest priority):
--   1. Block attribute:        ```{.dbml level="keys"}
--   2. Document front matter:  dbml:\n  level: keys
--   3. Project _quarto.yml:    dbml:\n  level: keys
--   4. Default:                full (all fields shown)
--                             Other values: keys (PK+FK only), names (header only)

-- ─── Helpers ─────────────────────────────────────────────────────────────────

local function script_dir()
  return pandoc.path.directory(PANDOC_SCRIPT_FILE)
end

--- Normalise a theme value; returns 'light', 'dark', or nil (= auto).
local function normalise_theme(raw)
  if not raw then return nil end
  local s = pandoc.utils.stringify(raw):lower():match('^%s*(.-)%s*$')
  if s == 'light' or s == 'dark' then return s end
  return nil  -- treat unknown values as auto
end

--- Document-level theme (set by Meta filter below; nil = auto).
local doc_theme = nil

--- Determine the effective theme for a given code block.
--- Returns 'light', 'dark', or nil (auto).
local function effective_theme(block)
  -- Block attribute wins
  local block_raw = block.attr and block.attr.attributes and block.attr.attributes['theme']
  local bt = normalise_theme(block_raw)
  if bt then return bt end
  -- Document / project metadata
  if doc_theme then return doc_theme end
  return nil  -- auto
end

--- Normalise an echo value; returns true, false, or nil (= not set).
local function normalise_echo(raw)
  if type(raw) == 'boolean' then return raw end
  if not raw then return nil end
  local s = pandoc.utils.stringify(raw):lower():match('^%s*(.-)%s*$')
  if s == 'true' or s == 'yes' or s == '1' then return true end
  if s == 'false' or s == 'no' or s == '0' then return false end
  return nil
end

--- Document-level echo setting (set by Meta filter below; nil = use default).
local doc_echo = nil

--- Normalise a notation value; returns 'labels', 'crowsfoot', 'uml', 'arrows', or nil.
local function normalise_notation(raw)
  if not raw then return nil end
  local s = pandoc.utils.stringify(raw):lower():match('^%s*(.-)%s*$')
  if s == 'crowsfoot' or s == 'crows-foot' or s == "crow's-foot" or s == 'crow' then
    return 'crowsfoot'
  end
  if s == 'uml' then return 'uml' end
  if s == 'arrows' or s == 'arrow' then return 'arrows' end
  if s == 'labels' or s == 'label' then return 'labels' end
  return nil  -- unknown value → caller uses default
end

--- Document-level notation setting (set by Meta filter below; nil = use default).
local doc_notation = nil

--- Determine whether to echo the source for a given code block.
--- Returns true or false.
local function effective_echo(block)
  -- Block attribute wins
  local block_raw = block.attr and block.attr.attributes and block.attr.attributes['echo']
  if block_raw ~= nil then
    local v = normalise_echo(block_raw)
    if v ~= nil then return v end
  end
  -- Document / project metadata
  if doc_echo ~= nil then return doc_echo end
  return false  -- default: don't show source
end

--- Determine the effective notation for a given code block.
--- Returns 'crowsfoot', 'labels', or nil (= use renderer default).
local function effective_notation(block)
  -- Block attribute wins
  local block_raw = block.attr and block.attr.attributes and block.attr.attributes['notation']
  if block_raw ~= nil then
    local v = normalise_notation(block_raw)
    if v ~= nil then return v end
  end
  -- Document / project metadata
  if doc_notation ~= nil then return doc_notation end
  return nil  -- let the renderer use its default ('labels')
end

--- Normalise a routing value; returns 'smooth', 'orthogonal', 'rounded', or nil.
local function normalise_routing(raw)
  if not raw then return nil end
  local s = pandoc.utils.stringify(raw):lower():match('^%s*(.-)%s*$')
  if s == 'smooth' or s == 'curved' or s == 'curve' then return 'smooth' end
  if s == 'orthogonal' or s == 'ortho' or s == 'angular' then return 'orthogonal' end
  if s == 'rounded' or s == 'round' then return 'rounded' end
  return nil
end

--- Document-level routing setting (set by Meta filter below; nil = use default).
local doc_routing = nil

--- Determine the effective routing style for a given code block.
--- Returns 'smooth', 'orthogonal', 'rounded', or nil (= use renderer default).
local function effective_routing(block)
  local block_raw = block.attr and block.attr.attributes and block.attr.attributes['routing']
  if block_raw ~= nil then
    local v = normalise_routing(block_raw)
    if v ~= nil then return v end
  end
  if doc_routing ~= nil then return doc_routing end
  return nil  -- let the renderer use its default ('smooth')
end

--- Normalise a level value; returns 'full', 'keys', 'names', or nil.
local function normalise_level(raw)
  if not raw then return nil end
  local s = pandoc.utils.stringify(raw):lower():match('^%s*(.-)%s*$')
  if s == 'full' or s == 'all' then return 'full' end
  if s == 'keys' or s == 'key' then return 'keys' end
  if s == 'names' or s == 'name' or s == 'headers' or s == 'header' then return 'names' end
  return nil
end

--- Document-level detail level setting (set by Meta filter below; nil = use default).
local doc_level = nil

--- Determine the effective detail level for a given code block.
--- Returns 'full', 'keys', 'names', or nil (= use renderer default = 'full').
local function effective_level(block)
  local block_raw = block.attr and block.attr.attributes and block.attr.attributes['level']
  if block_raw ~= nil then
    local v = normalise_level(block_raw)
    if v ~= nil then return v end
  end
  if doc_level ~= nil then return doc_level end
  return nil
end

local function render_dbml(code, theme, notation, routing, level)
  local script = pandoc.path.join({ script_dir(), 'dbml-render.js' })
  local args = { script }
  -- For auto HTML we pass no --theme flag (defaults to CSS vars internally).
  -- For an explicit theme, or any static output, we pass it.
  if theme then
    args[#args + 1] = '--theme=' .. theme
  end
  if notation then
    args[#args + 1] = '--notation=' .. notation
  end
  if routing then
    args[#args + 1] = '--routing=' .. routing
  end
  if level then
    args[#args + 1] = '--level=' .. level
  end
  local ok, result = pcall(pandoc.pipe, 'node', args, code)
  if ok then return result, nil end
  return nil, tostring(result)
end

local function error_block(msg)
  return pandoc.Div(
    { pandoc.Para({ pandoc.Str('[quarto-dbml error: ' .. msg .. ']') }) },
    pandoc.Attr('', { 'dbml-error' }, {
      style = 'color:red;border:1px solid red;padding:0.5em;border-radius:4px;'
    })
  )
end

-- ─── CSS ─────────────────────────────────────────────────────────────────────
-- Variables are defined on .dbml-diagram so they cascade into the inline SVG.
--
-- Priority (CSS cascade, high → low):
--   .dbml-theme-light / .dbml-theme-dark  — explicit override (specificity 0,2,0)
--   [data-bs-theme="dark"] .dbml-diagram  — Quarto Bootstrap toggle  (0,2,0, earlier)
--   @media prefers-color-scheme: dark     — system preference         (0,1,0)
--   .dbml-diagram                         — light defaults            (0,1,0)
--
-- The force-theme rules are declared last and share the highest specificity,
-- so they win regardless of system or Bootstrap dark mode.

local DBML_CSS = [[<style id="quarto-dbml-styles">
.dbml-diagram {
  /* ── Light-mode defaults ─────────────── */
  --dbml-bg:          #f7f9ff;
  --dbml-card-bg:     #ffffff;
  --dbml-border:      #c0cce4;
  --dbml-shadow:      rgba(184,200,224,0.35);
  --dbml-hdr-bg:      #4361a0;
  --dbml-hdr-fg:      #ffffff;
  --dbml-row-odd:     #f0f3fb;
  --dbml-row-even:    #ffffff;
  --dbml-pk-fg:       #b22222;
  --dbml-pk-bg:       rgba(178,34,34,0.15);
  --dbml-field-fg:    #1a1a2e;
  --dbml-type-fg:     #7f8c9e;
  --dbml-edge:        #8ca0c0;
  --dbml-edge-active: #3a6bc8;

  position: relative;
  overflow: hidden;
  max-width: 100%;
  margin: 1em 0;
  border-radius: 8px;
  border: 1px solid var(--dbml-border, #c0cce4);
}

/* ── Auto dark: system preference ───────── */
@media (prefers-color-scheme: dark) {
  .dbml-diagram {
    --dbml-bg:          #1a1f2e;
    --dbml-card-bg:     #252b3b;
    --dbml-border:      #3a4560;
    --dbml-shadow:      rgba(13,16,23,0.5);
    --dbml-hdr-bg:      #2d4a8a;
    --dbml-hdr-fg:      #e8eef8;
    --dbml-row-odd:     #1f2535;
    --dbml-row-even:    #252b3b;
    --dbml-pk-fg:       #e07070;
    --dbml-pk-bg:       rgba(220,80,80,0.2);
    --dbml-field-fg:    #c8d0e4;
    --dbml-type-fg:     #6a7a94;
    --dbml-edge:        #4a6080;
    --dbml-edge-active: #7ba8f0;
  }
}

/* ── Auto dark: Quarto Bootstrap toggle ─── */
[data-bs-theme="dark"] .dbml-diagram {
  --dbml-bg:          #1a1f2e;
  --dbml-card-bg:     #252b3b;
  --dbml-border:      #3a4560;
  --dbml-shadow:      rgba(13,16,23,0.5);
  --dbml-hdr-bg:      #2d4a8a;
  --dbml-hdr-fg:      #e8eef8;
  --dbml-row-odd:     #1f2535;
  --dbml-row-even:    #252b3b;
  --dbml-pk-fg:       #e07070;
  --dbml-pk-bg:       rgba(220,80,80,0.2);
  --dbml-field-fg:    #c8d0e4;
  --dbml-type-fg:     #6a7a94;
  --dbml-edge:        #4a6080;
  --dbml-edge-active: #7ba8f0;
}

/* ── Explicit overrides (declared last → win the cascade) ── */

.dbml-diagram.dbml-theme-light {
  --dbml-bg:          #f7f9ff;
  --dbml-card-bg:     #ffffff;
  --dbml-border:      #c0cce4;
  --dbml-shadow:      rgba(184,200,224,0.35);
  --dbml-hdr-bg:      #4361a0;
  --dbml-hdr-fg:      #ffffff;
  --dbml-row-odd:     #f0f3fb;
  --dbml-row-even:    #ffffff;
  --dbml-pk-fg:       #b22222;
  --dbml-pk-bg:       rgba(178,34,34,0.15);
  --dbml-field-fg:    #1a1a2e;
  --dbml-type-fg:     #7f8c9e;
  --dbml-edge:        #8ca0c0;
  --dbml-edge-active: #3a6bc8;
}

.dbml-diagram.dbml-theme-dark {
  --dbml-bg:          #1a1f2e;
  --dbml-card-bg:     #252b3b;
  --dbml-border:      #3a4560;
  --dbml-shadow:      rgba(13,16,23,0.5);
  --dbml-hdr-bg:      #2d4a8a;
  --dbml-hdr-fg:      #e8eef8;
  --dbml-row-odd:     #1f2535;
  --dbml-row-even:    #252b3b;
  --dbml-pk-fg:       #e07070;
  --dbml-pk-bg:       rgba(220,80,80,0.2);
  --dbml-field-fg:    #c8d0e4;
  --dbml-type-fg:     #6a7a94;
  --dbml-edge:        #4a6080;
  --dbml-edge-active: #7ba8f0;
}

/* ── Field-row hover ────────────────────── */

.dbml-diagram .dbml-field-row {
  cursor: default;
}
.dbml-diagram .dbml-field-row:hover > rect,
.dbml-diagram .dbml-field-row:hover > path {
  filter: brightness(0.91);
}

/* ── Edge group: hover & click-to-select ── */

.dbml-diagram .dbml-edge-group {
  cursor: pointer;
}

/* stroke-width and opacity are presentation attributes in the SVG so CSS
   selectors can override them here without needing !important. */
.dbml-diagram .dbml-edge-group:hover .dbml-edge-path,
.dbml-diagram .dbml-edge-group.dbml-edge-selected .dbml-edge-path {
  stroke-width: 3;
  opacity: 1;
}

/* ── Flow animation overlay ─────────────── */

.dbml-diagram .dbml-edge-flow {
  pointer-events: none;
  transition: opacity 0.15s ease;
}

/* Reveal the dashed overlay on hover or when locked (selected) */
.dbml-diagram .dbml-edge-group:hover .dbml-edge-flow,
.dbml-diagram .dbml-edge-group.dbml-edge-selected .dbml-edge-flow {
  opacity: 1;
  animation: dbml-flow-fwd 0.7s linear infinite;
}

/* Reverse direction for edges where the "one" end is at the path tail */
.dbml-diagram .dbml-edge-group[data-flow-dir="reverse"]:hover .dbml-edge-flow,
.dbml-diagram .dbml-edge-group[data-flow-dir="reverse"].dbml-edge-selected .dbml-edge-flow {
  animation: dbml-flow-rev 0.7s linear infinite;
}

/* ── Highlight-all mode (button toggle) ─── */

.dbml-diagram.dbml-highlight-all .dbml-edge-path {
  stroke-width: 3;
  opacity: 1;
}
.dbml-diagram.dbml-highlight-all .dbml-edge-flow {
  opacity: 1;
  animation: dbml-flow-fwd 0.7s linear infinite;
}
.dbml-diagram.dbml-highlight-all .dbml-edge-group[data-flow-dir="reverse"] .dbml-edge-flow {
  animation: dbml-flow-rev 0.7s linear infinite;
}

@keyframes dbml-flow-fwd {
  from { stroke-dashoffset: 14; }
  to   { stroke-dashoffset: 0;  }
}
@keyframes dbml-flow-rev {
  from { stroke-dashoffset: 0;  }
  to   { stroke-dashoffset: 14; }
}

/* ── Toggle button ──────────────────────── */

.dbml-diagram .dbml-toggle-btn {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 20;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--dbml-border, #c0cce4);
  border-radius: 6px;
  background: var(--dbml-card-bg, #ffffff);
  color: var(--dbml-edge, #8ca0c0);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.7;
  transition: opacity 0.15s, background 0.15s, color 0.15s, border-color 0.15s;
}
.dbml-diagram .dbml-toggle-btn:hover {
  opacity: 1;
}
.dbml-diagram .dbml-toggle-btn[aria-pressed="true"] {
  background: var(--dbml-hdr-bg, #4361a0);
  border-color: var(--dbml-hdr-bg, #4361a0);
  color: var(--dbml-hdr-fg, #ffffff);
  opacity: 1;
}

/* ── Detail level button ────────────────── */

.dbml-diagram .dbml-detail-btn {
  position: absolute;
  top: 8px;
  left: 44px;
  z-index: 20;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--dbml-border, #c0cce4);
  border-radius: 6px;
  background: var(--dbml-card-bg, #ffffff);
  color: var(--dbml-edge, #8ca0c0);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 10px;
  font-weight: 600;
  opacity: 0.7;
  transition: opacity 0.15s, background 0.15s, color 0.15s, border-color 0.15s;
}
.dbml-diagram .dbml-detail-btn:hover {
  opacity: 1;
}
.dbml-diagram .dbml-detail-btn.dbml-detail-active {
  background: var(--dbml-hdr-bg, #4361a0);
  border-color: var(--dbml-hdr-bg, #4361a0);
  color: var(--dbml-hdr-fg, #ffffff);
  opacity: 1;
}

/* ── Detail level: hide field rows ─────── */

/* keys mode: hide regular (non-key) field rows */
.dbml-diagram.dbml-level-keys .dbml-field-row[data-field-type="regular"] {
  display: none;
}
/* names mode: hide all field rows */
.dbml-diagram.dbml-level-names .dbml-field-row {
  display: none;
}
</style>]]

local html_setup_done = false

local function client_js_tag()
  local path = pandoc.path.join({ script_dir(), 'dbml-client.js' })
  local fh = io.open(path, 'r')
  if not fh then return '' end
  local src = fh:read('*a')
  fh:close()
  return '<script>' .. src .. '</script>'
end

-- ─── Meta filter — reads document / project theme setting ────────────────────
-- Runs before CodeBlock, so doc_theme is available to all block handlers.

function Meta(meta)
  if meta.dbml then
    if meta.dbml.theme then
      doc_theme = normalise_theme(meta.dbml.theme)
    end
    if meta.dbml.echo ~= nil then
      doc_echo = normalise_echo(meta.dbml.echo)
    end
    if meta.dbml.notation then
      doc_notation = normalise_notation(meta.dbml.notation)
    end
    if meta.dbml.routing then
      doc_routing = normalise_routing(meta.dbml.routing)
    end
    if meta.dbml.level then
      doc_level = normalise_level(meta.dbml.level)
    end
  end
  return meta
end

-- ─── CodeBlock filter ────────────────────────────────────────────────────────

function CodeBlock(block)
  if not block.classes:includes('dbml') then
    return nil
  end

  local theme      = effective_theme(block)    -- 'light', 'dark', or nil (auto)
  local show_echo  = effective_echo(block)     -- true or false
  local notation   = effective_notation(block) -- 'crowsfoot', 'labels', 'uml', 'arrows', or nil
  local routing    = effective_routing(block)  -- 'smooth', 'orthogonal', 'rounded', or nil
  local level      = effective_level(block)    -- 'full', 'keys', 'names', or nil

  --- Optionally prepend the DBML source as a styled code block.
  local function with_echo(diagram_block)
    if not show_echo then return diagram_block end
    local source = pandoc.CodeBlock(block.text, pandoc.Attr('', { 'dbml' }, {}))
    return pandoc.Blocks({ source, diagram_block })
  end

  -- ── HTML ────────────────────────────────────────────────────────────────
  if FORMAT:match('html') then
    if not html_setup_done then
      html_setup_done = true
      quarto.doc.include_text('in-header', DBML_CSS)
      quarto.doc.include_text('after-body', client_js_tag())
    end

    -- For HTML output, always render with CSS vars (interactive mode) regardless
    -- of any explicit theme setting. Theme is enforced purely through the wrapper
    -- CSS class (.dbml-theme-light / .dbml-theme-dark), which overrides the CSS
    -- custom properties at runtime. Passing a hardcoded theme to the renderer
    -- would suppress the interactive data attributes (clipPaths, data-* on edges
    -- and table groups) that the browser JS requires.
    -- Level is also NOT passed — all fields are rendered so the browser can
    -- toggle between levels interactively.
    local svg, err = render_dbml(block.text, nil, notation, routing, nil)
    if not svg or svg == '' then
      return error_block(err or 'empty output from renderer')
    end

    -- Build wrapper class list
    local classes = 'dbml-diagram'
    if theme then classes = classes .. ' dbml-theme-' .. theme end
    -- Always include a level class; 'full' is the default if not set
    local eff_level = level or 'full'
    classes = classes .. ' dbml-level-' .. eff_level

    return with_echo(pandoc.RawBlock('html',
      '<div class="' .. classes .. '">\n' .. svg .. '\n</div>'))
  end

  -- ── LaTeX / PDF ─────────────────────────────────────────────────────────
  if FORMAT:match('latex') or FORMAT:match('pdf') then
    -- Default to light for static output; respect explicit dark override
    local pdf_theme = theme or 'light'
    local script  = pandoc.path.join({ script_dir(), 'dbml-render.js' })
    local tmpdir  = os.getenv('TMPDIR') or os.getenv('TEMP') or '/tmp'
    math.randomseed(os.time())
    local stem    = 'dbml-' .. os.time() .. '-' .. math.random(1000, 9999)

    -- Attempt 1: PNG via @resvg/resvg-js
    local png_path = tmpdir .. '/' .. stem .. '.png'
    local png_args = { script, '--theme=' .. pdf_theme, '--output-file=' .. png_path }
    if notation then png_args[#png_args + 1] = '--notation=' .. notation end
    if routing  then png_args[#png_args + 1] = '--routing='  .. routing  end
    if level    then png_args[#png_args + 1] = '--level='    .. level    end
    local png_ok, png_err = pcall(pandoc.pipe, 'node', png_args, block.text)

    if png_ok then
      local f = io.open(png_path, 'rb')
      if f then
        f:close()
        return with_echo(pandoc.Para({
          pandoc.Image({}, png_path, '', pandoc.Attr('', {}, { width = '100%' }))
        }))
      end
    end

    if type(png_err) == 'string' and png_err:find('resvg') then
      io.stderr:write(
        '[quarto-dbml] @resvg/resvg-js not found — falling back to \\includesvg.\n' ..
        'For portable PDF output, run once:\n' ..
        '  npm install --prefix _extensions/quarto-dbml/\n'
      )
    end

    -- Attempt 2: SVG + \includesvg (xelatex + svg LaTeX package + Inkscape)
    local svg, svg_err = render_dbml(block.text, pdf_theme, notation, routing, level)
    if not svg or svg == '' then
      return error_block(svg_err or 'empty output from renderer')
    end

    local svg_path = tmpdir .. '/' .. stem .. '.svg'
    local fh = io.open(svg_path, 'w')
    if not fh then
      return error_block('could not write temp file to ' .. tmpdir)
    end
    fh:write(svg)
    fh:close()

    local latex_path = svg_path:gsub('\\', '/')
    return with_echo(pandoc.RawBlock('latex',
      '\\includesvg[width=\\linewidth]{' .. latex_path .. '}'))
  end

  -- ── Fallback ─────────────────────────────────────────────────────────────
  local svg, err = render_dbml(block.text, theme, notation, routing, level)
  if not svg or svg == '' then
    return error_block(err or 'empty output from renderer')
  end
  return with_echo(pandoc.RawBlock('html', svg))
end
