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

local function render_dbml(code, theme)
  local script = pandoc.path.join({ script_dir(), 'dbml-render.js' })
  local args = { script }
  -- For auto HTML we pass no --theme flag (defaults to CSS vars internally).
  -- For an explicit theme, or any static output, we pass it.
  if theme then
    args[#args + 1] = '--theme=' .. theme
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
  --dbml-bg:       #f7f9ff;
  --dbml-card-bg:  #ffffff;
  --dbml-border:   #c0cce4;
  --dbml-shadow:   rgba(184,200,224,0.35);
  --dbml-hdr-bg:   #4361a0;
  --dbml-hdr-fg:   #ffffff;
  --dbml-row-odd:  #f0f3fb;
  --dbml-row-even: #ffffff;
  --dbml-pk-fg:    #b22222;
  --dbml-pk-bg:    rgba(178,34,34,0.15);
  --dbml-field-fg: #1a1a2e;
  --dbml-type-fg:  #7f8c9e;
  --dbml-edge:     #8ca0c0;

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
    --dbml-bg:       #1a1f2e;
    --dbml-card-bg:  #252b3b;
    --dbml-border:   #3a4560;
    --dbml-shadow:   rgba(13,16,23,0.5);
    --dbml-hdr-bg:   #2d4a8a;
    --dbml-hdr-fg:   #e8eef8;
    --dbml-row-odd:  #1f2535;
    --dbml-row-even: #252b3b;
    --dbml-pk-fg:    #e07070;
    --dbml-pk-bg:    rgba(220,80,80,0.2);
    --dbml-field-fg: #c8d0e4;
    --dbml-type-fg:  #6a7a94;
    --dbml-edge:     #4a6080;
  }
}

/* ── Auto dark: Quarto Bootstrap toggle ─── */
[data-bs-theme="dark"] .dbml-diagram {
  --dbml-bg:       #1a1f2e;
  --dbml-card-bg:  #252b3b;
  --dbml-border:   #3a4560;
  --dbml-shadow:   rgba(13,16,23,0.5);
  --dbml-hdr-bg:   #2d4a8a;
  --dbml-hdr-fg:   #e8eef8;
  --dbml-row-odd:  #1f2535;
  --dbml-row-even: #252b3b;
  --dbml-pk-fg:    #e07070;
  --dbml-pk-bg:    rgba(220,80,80,0.2);
  --dbml-field-fg: #c8d0e4;
  --dbml-type-fg:  #6a7a94;
  --dbml-edge:     #4a6080;
}

/* ── Explicit overrides (declared last → win the cascade) ── */

.dbml-diagram.dbml-theme-light {
  --dbml-bg:       #f7f9ff;
  --dbml-card-bg:  #ffffff;
  --dbml-border:   #c0cce4;
  --dbml-shadow:   rgba(184,200,224,0.35);
  --dbml-hdr-bg:   #4361a0;
  --dbml-hdr-fg:   #ffffff;
  --dbml-row-odd:  #f0f3fb;
  --dbml-row-even: #ffffff;
  --dbml-pk-fg:    #b22222;
  --dbml-pk-bg:    rgba(178,34,34,0.15);
  --dbml-field-fg: #1a1a2e;
  --dbml-type-fg:  #7f8c9e;
  --dbml-edge:     #8ca0c0;
}

.dbml-diagram.dbml-theme-dark {
  --dbml-bg:       #1a1f2e;
  --dbml-card-bg:  #252b3b;
  --dbml-border:   #3a4560;
  --dbml-shadow:   rgba(13,16,23,0.5);
  --dbml-hdr-bg:   #2d4a8a;
  --dbml-hdr-fg:   #e8eef8;
  --dbml-row-odd:  #1f2535;
  --dbml-row-even: #252b3b;
  --dbml-pk-fg:    #e07070;
  --dbml-pk-bg:    rgba(220,80,80,0.2);
  --dbml-field-fg: #c8d0e4;
  --dbml-type-fg:  #6a7a94;
  --dbml-edge:     #4a6080;
}

/* ── Hover interactions ─────────────────── */

.dbml-diagram .dbml-field-row {
  cursor: default;
}
.dbml-diagram .dbml-field-row:hover > rect,
.dbml-diagram .dbml-field-row:hover > path {
  filter: brightness(0.91);
}

.dbml-diagram .dbml-edge-path {
  transition: stroke-width 0.15s ease, opacity 0.15s ease;
  cursor: pointer;
}
.dbml-diagram .dbml-edge-path:hover {
  stroke-width: 3px;
  opacity: 1 !important;
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
  if meta.dbml and meta.dbml.theme then
    doc_theme = normalise_theme(meta.dbml.theme)
  end
  return meta
end

-- ─── CodeBlock filter ────────────────────────────────────────────────────────

function CodeBlock(block)
  if not block.classes:includes('dbml') then
    return nil
  end

  local theme = effective_theme(block)  -- 'light', 'dark', or nil (auto)

  -- ── HTML ────────────────────────────────────────────────────────────────
  if FORMAT:match('html') then
    if not html_setup_done then
      html_setup_done = true
      quarto.doc.include_text('in-header', DBML_CSS)
      quarto.doc.include_text('after-body', client_js_tag())
    end

    -- When an explicit theme is set, pass it to Node (so CSS vars get the
    -- right fallback values too). Auto (nil) uses the CSS-var default path.
    local svg, err = render_dbml(block.text, theme)
    if not svg or svg == '' then
      return error_block(err or 'empty output from renderer')
    end

    -- Build wrapper class list
    local classes = 'dbml-diagram'
    if theme then classes = classes .. ' dbml-theme-' .. theme end

    return pandoc.RawBlock('html',
      '<div class="' .. classes .. '">\n' .. svg .. '\n</div>')
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
    local png_ok, png_err = pcall(
      pandoc.pipe, 'node',
      { script, '--theme=' .. pdf_theme, '--output-file=' .. png_path },
      block.text
    )

    if png_ok then
      local f = io.open(png_path, 'rb')
      if f then
        f:close()
        return pandoc.Para({
          pandoc.Image({}, png_path, '', pandoc.Attr('', {}, { width = '100%' }))
        })
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
    local svg, svg_err = render_dbml(block.text, pdf_theme)
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
    return pandoc.RawBlock('latex',
      '\\includesvg[width=\\linewidth]{' .. latex_path .. '}')
  end

  -- ── Fallback ─────────────────────────────────────────────────────────────
  local svg, err = render_dbml(block.text, theme)
  if not svg or svg == '' then
    return error_block(err or 'empty output from renderer')
  end
  return pandoc.RawBlock('html', svg)
end
