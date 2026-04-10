-- dbml.lua  ──  Quarto/Pandoc Lua filter for DBML code blocks.
--
-- Intercepts ```dbml fenced blocks and produces:
--   HTML  →  inline SVG with CSS-variable colours (responds to dark mode)
--   PDF   →  SVG written to a temp file + \includesvg  (requires xelatex +
--             the LaTeX `svg` package + Inkscape)
--   Other →  inline SVG fallback

-- ─── Helpers ─────────────────────────────────────────────────────────────────

local function script_dir()
  return pandoc.path.directory(PANDOC_SCRIPT_FILE)
end

local function render_dbml(code, theme)
  local script = pandoc.path.join({ script_dir(), 'dbml-render.js' })
  local args = { script }
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

-- ─── CSS (injected once into <head> for HTML output) ─────────────────────────
-- Variables are defined on .dbml-diagram so they cascade into the inline SVG.
-- Dark-mode overrides via both prefers-color-scheme and Quarto's Bootstrap
-- [data-bs-theme="dark"] attribute.

local DBML_CSS = [[<style id="quarto-dbml-styles">
.dbml-diagram {
  /* Light-mode defaults */
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

/* System dark mode */
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

/* Quarto Bootstrap dark theme toggle */
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

/* ── Hover interactions ─────────────────────────────────── */

/* Field row: highlight background on hover */
.dbml-diagram .dbml-field-row {
  cursor: default;
}
.dbml-diagram .dbml-field-row:hover > rect,
.dbml-diagram .dbml-field-row:hover > path {
  filter: brightness(0.91);
}

/* Relationship edge: thicken and brighten on hover */
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

--- Read the bundled client script from the extension directory.
local function client_js_tag()
  local path = pandoc.path.join({ script_dir(), 'dbml-client.js' })
  local fh = io.open(path, 'r')
  if not fh then return '' end
  local src = fh:read('*a')
  fh:close()
  return '<script>' .. src .. '</script>'
end

-- ─── Filter ──────────────────────────────────────────────────────────────────

function CodeBlock(block)
  if not block.classes:includes('dbml') then
    return nil
  end

  -- ── HTML ──────────────────────────────────────────────────────────────────
  if FORMAT:match('html') then
    -- Inject CSS + client JS into the document exactly once
    if not html_setup_done then
      html_setup_done = true
      quarto.doc.include_text('in-header', DBML_CSS)
      quarto.doc.include_text('after-body', client_js_tag())
    end

    -- Render with CSS variable references (responds to dark mode at runtime)
    local svg, err = render_dbml(block.text)
    if not svg or svg == '' then
      return error_block(err or 'empty output from renderer')
    end

    return pandoc.RawBlock('html',
      '<div class="dbml-diagram">\n' .. svg .. '\n</div>')
  end

  -- ── LaTeX / PDF ───────────────────────────────────────────────────────────
  if FORMAT:match('latex') or FORMAT:match('pdf') then
    local script  = pandoc.path.join({ script_dir(), 'dbml-render.js' })
    local tmpdir  = os.getenv('TMPDIR') or os.getenv('TEMP') or '/tmp'
    math.randomseed(os.time())
    local stem    = 'dbml-' .. os.time() .. '-' .. math.random(1000, 9999)

    -- ── Attempt 1: PNG via @resvg/resvg-js (no Inkscape needed) ──────────
    local png_path = tmpdir .. '/' .. stem .. '.png'
    local png_ok, png_err = pcall(
      pandoc.pipe, 'node',
      { script, '--theme=light', '--output-file=' .. png_path },
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

    -- Warn if the failure was a missing dependency
    if type(png_err) == 'string' and png_err:find('resvg') then
      io.stderr:write(
        '[quarto-dbml] @resvg/resvg-js not found — falling back to \\includesvg.\n' ..
        'For portable PDF output, run once:\n' ..
        '  npm install --prefix _extensions/quarto-dbml/\n'
      )
    end

    -- ── Attempt 2: SVG + \includesvg (xelatex + svg LaTeX package + Inkscape) ─
    local svg, svg_err = render_dbml(block.text, 'light')
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
  local svg, err = render_dbml(block.text)
  if not svg or svg == '' then
    return error_block(err or 'empty output from renderer')
  end
  return pandoc.RawBlock('html', svg)
end
