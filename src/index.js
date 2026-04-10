'use strict';

const { Parser } = require('@dbml/core');

// ─── CLI flags ────────────────────────────────────────────────────────────────
// --theme=html         (default) CSS custom property refs; dark-mode at runtime
// --theme=light        hardcoded light palette (PDF / static)
// --theme=dark         hardcoded dark palette  (PDF / static)
// --notation=labels    (default) text cardinality labels ("1" / "N")
// --notation=crowsfoot SVG crow's foot markers
// --output-file=<path> write output to file instead of stdout
//                      .png → rasterise SVG via @resvg/resvg-js (2× resolution)
//                      .svg → write raw SVG text
const themeFlag    = (process.argv.find(a => a.startsWith('--theme='))       ?? '--theme=html').split('=')[1];
const notationFlag = (process.argv.find(a => a.startsWith('--notation='))    ?? '--notation=labels').split('=')[1];
const outputFile   = (process.argv.find(a => a.startsWith('--output-file=')) ?? '').slice('--output-file='.length) || null;

// ─── Palettes ────────────────────────────────────────────────────────────────
const LIGHT = {
  bg:         '#f7f9ff',
  cardBg:     '#ffffff',
  border:     '#c0cce4',
  shadow:     'rgba(184,200,224,0.35)',
  hdrBg:      '#4361a0',
  hdrFg:      '#ffffff',
  rowOdd:     '#f0f3fb',
  rowEven:    '#ffffff',
  pkFg:       '#b22222',
  pkBg:       'rgba(178,34,34,0.15)',
  fieldFg:    '#1a1a2e',
  typeFg:     '#7f8c9e',
  edge:       '#8ca0c0',
  edgeActive: '#3a6bc8',   // brighter blue for highlighted / animated edges
};

const DARK = {
  bg:         '#1a1f2e',
  cardBg:     '#252b3b',
  border:     '#3a4560',
  shadow:     'rgba(13,16,23,0.5)',
  hdrBg:      '#2d4a8a',
  hdrFg:      '#e8eef8',
  rowOdd:     '#1f2535',
  rowEven:    '#252b3b',
  pkFg:       '#e07070',
  pkBg:       'rgba(220,80,80,0.2)',
  fieldFg:    '#c8d0e4',
  typeFg:     '#6a7a94',
  edge:       '#4a6080',
  edgeActive: '#7ba8f0',   // lighter blue for highlighted / animated edges on dark bg
};

// For HTML mode: CSS custom property references with LIGHT fallbacks.
// These are resolved at runtime by the browser, enabling dark-mode switching
// without a re-render.
const CSS_VARS = {
  bg:         'var(--dbml-bg,#f7f9ff)',
  cardBg:     'var(--dbml-card-bg,#ffffff)',
  border:     'var(--dbml-border,#c0cce4)',
  shadow:     'var(--dbml-shadow,rgba(184,200,224,0.35))',
  hdrBg:      'var(--dbml-hdr-bg,#4361a0)',
  hdrFg:      'var(--dbml-hdr-fg,#ffffff)',
  rowOdd:     'var(--dbml-row-odd,#f0f3fb)',
  rowEven:    'var(--dbml-row-even,#ffffff)',
  pkFg:       'var(--dbml-pk-fg,#b22222)',
  pkBg:       'var(--dbml-pk-bg,rgba(178,34,34,0.15))',
  fieldFg:    'var(--dbml-field-fg,#1a1a2e)',
  typeFg:     'var(--dbml-type-fg,#7f8c9e)',
  edge:       'var(--dbml-edge,#8ca0c0)',
  edgeActive: 'var(--dbml-edge-active,#3a6bc8)',
};

const C = themeFlag === 'dark' ? DARK : themeFlag === 'light' ? LIGHT : CSS_VARS;

// ─── Stdin reader ─────────────────────────────────────────────────────────────
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { buf += chunk; });
process.stdin.on('end', () => {
  try {
    const db  = Parser.parse(buf.trim(), 'dbml');
    const svg = dbmlToSvg(db);

    if (outputFile && outputFile.endsWith('.png')) {
      // ── Rasterise SVG → PNG ─────────────────────────────────────────────
      let Resvg;
      try {
        Resvg = require('@resvg/resvg-js').Resvg;
      } catch {
        process.stderr.write(
          'quarto-dbml: @resvg/resvg-js is not installed.\n' +
          'For PDF output, run once inside the extension directory:\n' +
          '  npm install --prefix _extensions/quarto-dbml/\n'
        );
        process.exit(2);  // exit 2 = missing optional dependency
      }
      const png = new Resvg(svg, {
        background: 'white',
        fitTo: { mode: 'zoom', value: 2 },  // 2× for sharp PDFs
      }).render().asPng();
      require('fs').writeFileSync(outputFile, png);

    } else if (outputFile) {
      // ── Write raw SVG to file ───────────────────────────────────────────
      require('fs').writeFileSync(outputFile, svg);

    } else {
      // ── Stream SVG to stdout (default) ─────────────────────────────────
      process.stdout.write(svg);
    }
  } catch (e) {
    // @dbml/core throws { diags: [{message, location, ...}] } rather than
    // a standard Error, so e.message is undefined. Extract the diagnostics.
    let msg;
    if (Array.isArray(e.diags) && e.diags.length > 0) {
      msg = e.diags
        .map(d => {
          const loc = d.location
            ? ` (line ${d.location.start?.line ?? '?'})`
            : '';
          return (d.message || JSON.stringify(d)) + loc;
        })
        .join('\n  ');
    } else {
      msg = (e instanceof Error ? e.message : String(e)) || 'unknown parse error';
    }
    process.stderr.write('quarto-dbml parse error:\n  ' + msg + '\n');
    process.exit(1);
  }
});

// ─── Layout constants ─────────────────────────────────────────────────────────
const TW = 240;   // table card width
const TH = 38;    // table header height
const FH = 26;    // field row height
const GAPX = 80;  // horizontal gap between table columns
const GAPY = 60;  // vertical gap between table rows
const PAD = 40;   // outer canvas padding

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

/** XML-escape a value for safe use in SVG text content or attributes. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Cardinality markers ──────────────────────────────────────────────────────
//
// Each function draws a marker at a table edge connection point.
//
//   x, y     — the point on the table edge where the edge path starts/ends
//   relation — '@dbml/core' endpoint relation value: '*' (many) or '1' (one)
//   gapDir   — direction from the table edge into the gap: +1 (right) or -1 (left)
//   color    — stroke/fill colour string

// Crow's foot:
//   Many  → heel in the gap, two diagonal tines + vertical crossbar at the table edge
//   One   → double bar in the gap

function crowsFootMarker(x, y, relation, gapDir, color) {
  const s = `stroke:${color};stroke-width:1.5;stroke-linecap:round;fill:none;`;
  const H = 7;

  if (relation === '*') {
    const hx = x + gapDir * 12;
    return (
      `    <line x1="${hx}" y1="${y}" x2="${x}" y2="${y - H}" style="${s}"/>\n` +
      `    <line x1="${hx}" y1="${y}" x2="${x}" y2="${y + H}" style="${s}"/>\n` +
      `    <line x1="${x}"  y1="${y - H}" x2="${x}" y2="${y + H}" style="${s}"/>\n`
    );
  } else {
    const b1 = x + gapDir * 5;
    const b2 = x + gapDir * 10;
    return (
      `    <line x1="${b1}" y1="${y - H}" x2="${b1}" y2="${y + H}" style="${s}"/>\n` +
      `    <line x1="${b2}" y1="${y - H}" x2="${b2}" y2="${y + H}" style="${s}"/>\n`
    );
  }
}

// Arrows:
//   Many  → filled triangle (tip at table edge, base in the gap)
//   One   → single bar in the gap

function arrowMarker(x, y, relation, gapDir, color) {
  const H = 7;

  if (relation === '*') {
    const bx = x + gapDir * 12;  // base of triangle, 12 px into the gap
    return `    <polygon points="${x},${y} ${bx},${y - H} ${bx},${y + H}" style="fill:${color};stroke:none;"/>\n`;
  } else {
    const bx = x + gapDir * 7;   // single bar, 7 px into the gap
    return `    <line x1="${bx}" y1="${y - H}" x2="${bx}" y2="${y + H}" style="stroke:${color};stroke-width:1.5;stroke-linecap:round;"/>\n`;
  }
}

// ─── SVG builder ─────────────────────────────────────────────────────────────

function dbmlToSvg(db) {
  const tables = db.schemas.flatMap(s => s.tables ?? []);
  // refs may live on db.refs or on each schema
  const refs = [
    ...(Array.isArray(db.refs) ? db.refs : []),
    ...db.schemas.flatMap(s => Array.isArray(s.refs) ? s.refs : []),
  ];

  if (!tables.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="60">` +
      `<text x="12" y="36" style="font-family:sans-serif;font-size:14px;fill:#666;">No tables found in DBML.</text>` +
      `</svg>`;
  }

  // ── Grid layout ─────────────────────────────────────────────────────────
  const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)));

  const meta = {};
  tables.forEach((t, i) => {
    meta[t.name] = {
      col: i % cols,
      row: Math.floor(i / cols),
      h: TH + t.fields.length * FH,
    };
  });

  // Max height per row (tables in the same row may have different field counts)
  const rowMaxH = {};
  Object.values(meta).forEach(({ row, h }) => {
    rowMaxH[row] = Math.max(rowMaxH[row] ?? 0, h);
  });

  // Cumulative Y position per row
  const rowY = {};
  let curY = PAD;
  const numRows = Math.max(...Object.values(meta).map(m => m.row)) + 1;
  for (let r = 0; r < numRows; r++) {
    rowY[r] = curY;
    curY += (rowMaxH[r] ?? 0) + GAPY;
  }

  // Final absolute positions
  const pos = {};
  tables.forEach(t => {
    const { col, row, h } = meta[t.name];
    pos[t.name] = { x: PAD + col * (TW + GAPX), y: rowY[row], w: TW, h };
  });

  const svgW = PAD + cols * (TW + GAPX) - GAPX + PAD;
  const svgH = curY - GAPY + PAD;

  // ── Relationship edges ───────────────────────────────────────────────────
  let edgesSvg = '';
  refs.forEach(ref => {
    if (!ref.endpoints || ref.endpoints.length < 2) return;
    const [e1, e2] = ref.endpoints;
    const p1 = pos[e1.tableName];
    const p2 = pos[e2.tableName];
    if (!p1 || !p2) return;

    const t1 = tables.find(t => t.name === e1.tableName);
    const t2 = tables.find(t => t.name === e2.tableName);
    const fi1 = t1 ? t1.fields.findIndex(f => f.name === (e1.fieldNames?.[0] ?? '')) : -1;
    const fi2 = t2 ? t2.fields.findIndex(f => f.name === (e2.fieldNames?.[0] ?? '')) : -1;

    // Anchor Y at the connected field row's midpoint
    const ey1 = p1.y + TH + Math.max(0, fi1) * FH + FH / 2;
    const ey2 = p2.y + TH + Math.max(0, fi2) * FH + FH / 2;

    // Exit from the side facing the target table
    const goRight = p1.x <= p2.x;
    const ex1 = goRight ? p1.x + TW : p1.x;
    const ex2 = goRight ? p2.x : p2.x + TW;
    const cp  = Math.max(40, Math.abs(ex2 - ex1) * 0.4);

    const d = `M ${ex1} ${ey1} C ${ex1+(goRight?cp:-cp)} ${ey1} ${ex2+(goRight?-cp:cp)} ${ey2} ${ex2} ${ey2}`;

    // Flow direction: animate from the "one" end toward the "many" end.
    // The path is drawn e1→e2. If e1='*' and e2='1', the "one" end (e2) is
    // at the path tail, so we animate in reverse (tail→head = many→one side).
    const flowDir = (e1.relation === '*' && e2.relation === '1') ? 'reverse' : 'forward';

    edgesSvg += `  <g class="dbml-edge-group" data-flow-dir="${flowDir}">\n`;

    // Base path: stroke-width and opacity as presentation attributes so CSS
    // selectors can override them on hover/select without needing !important.
    edgesSvg += `    <path class="dbml-edge-path" d="${d}" stroke-width="1.5" fill="none" opacity="0.85" style="stroke:${C.edge};"/>\n`;

    // Animated dashes overlay — hidden until hover/selected/highlight-all.
    edgesSvg += `    <path class="dbml-edge-flow" d="${d}" stroke-width="2" fill="none" stroke-dasharray="8 6" opacity="0" pointer-events="none" style="stroke:${C.edgeActive};"/>\n`;

    // Wide transparent hit area so thin lines are easy to hover and click.
    edgesSvg += `    <path class="dbml-edge-hit" d="${d}" stroke-width="12" fill="none" stroke="transparent"/>\n`;

    // gapDir: direction from the table edge into the gap (away from the table card)
    const g1 = goRight ? 1 : -1;
    const g2 = goRight ? -1 : 1;

    if (notationFlag === 'crowsfoot') {
      edgesSvg += crowsFootMarker(ex1, ey1, e1.relation, g1, C.edge);
      edgesSvg += crowsFootMarker(ex2, ey2, e2.relation, g2, C.edge);
    } else if (notationFlag === 'arrows') {
      edgesSvg += arrowMarker(ex1, ey1, e1.relation, g1, C.edge);
      edgesSvg += arrowMarker(ex2, ey2, e2.relation, g2, C.edge);
    } else if (notationFlag === 'uml') {
      // UML multiplicity: "1" and "*" (standard UML convention)
      const umlLabel = r => r === '*' ? '*' : r === '1' ? '1' : (r ?? '');
      const lx1 = ex1 + (goRight ? 8 : -8);
      const lx2 = ex2 + (goRight ? -12 : 8);
      const labelStyle = `style="font-family:sans-serif;font-size:11px;font-weight:600;fill:${C.edge};"`;
      edgesSvg += `    <text x="${lx1}" y="${ey1-5}" text-anchor="${goRight?'start':'end'}" ${labelStyle}>${umlLabel(e1.relation)}</text>\n`;
      edgesSvg += `    <text x="${lx2}" y="${ey2-5}" text-anchor="${goRight?'end':'start'}" ${labelStyle}>${umlLabel(e2.relation)}</text>\n`;
    } else {
      // Default: text cardinality labels ("1" / "N")
      const relLabel = r => r === '*' ? 'N' : r === '1' ? '1' : (r ?? '');
      const lx1 = ex1 + (goRight ? 8 : -8);
      const lx2 = ex2 + (goRight ? -12 : 8);
      const labelStyle = `style="font-family:sans-serif;font-size:10px;font-weight:600;fill:${C.edge};"`;
      edgesSvg += `    <text x="${lx1}" y="${ey1-5}" text-anchor="${goRight?'start':'end'}" ${labelStyle}>${relLabel(e1.relation)}</text>\n`;
      edgesSvg += `    <text x="${lx2}" y="${ey2-5}" text-anchor="${goRight?'end':'start'}" ${labelStyle}>${relLabel(e2.relation)}</text>\n`;
    }

    edgesSvg += `  </g>\n`;
  });

  // ── Table cards ──────────────────────────────────────────────────────────
  let tablesSvg = '';
  tables.forEach(tbl => {
    const { x, y, w, h } = pos[tbl.name];

    // Drop shadow
    tablesSvg += `  <rect x="${x+3}" y="${y+3}" width="${w}" height="${h}" rx="6" style="fill:${C.shadow};"/>\n`;
    // Card body (class for hover targeting)
    tablesSvg += `  <rect class="dbml-card" x="${x}" y="${y}" width="${w}" height="${h}" rx="6" style="fill:${C.cardBg};stroke:${C.border};stroke-width:1;"/>\n`;
    // Header (rounded top only — patch bottom corners with a plain rect)
    tablesSvg += `  <rect x="${x}" y="${y}" width="${w}" height="${TH}" rx="6" style="fill:${C.hdrBg};"/>\n`;
    tablesSvg += `  <rect x="${x}" y="${y+TH-6}" width="${w}" height="6" style="fill:${C.hdrBg};"/>\n`;
    // Header label
    tablesSvg += `  <text x="${x+w/2}" y="${y+TH/2+6}" text-anchor="middle" ` +
      `style="font-family:${FONT};font-size:13px;font-weight:600;fill:${C.hdrFg};pointer-events:none;">${esc(tbl.name)}</text>\n`;

    // Field rows — each wrapped in a <g> for hover targeting
    tbl.fields.forEach((field, i) => {
      const fy = y + TH + i * FH;
      const isLast = i === tbl.fields.length - 1;
      const bg = i % 2 === 0 ? C.rowOdd : C.rowEven;
      const isPk = !!field.pk;
      const typeName = field.type?.type_name ?? '';

      tablesSvg += `  <g class="dbml-field-row">\n`;

      // Row background — rounded bottom corners on the last row
      if (isLast) {
        tablesSvg += `    <path d="M ${x} ${fy} L ${x} ${fy+FH-6} Q ${x} ${fy+FH} ${x+6} ${fy+FH} ` +
          `L ${x+w-6} ${fy+FH} Q ${x+w} ${fy+FH} ${x+w} ${fy+FH-6} L ${x+w} ${fy} Z" style="fill:${bg};"/>\n`;
      } else {
        tablesSvg += `    <rect x="${x}" y="${fy}" width="${w}" height="${FH}" style="fill:${bg};"/>\n`;
      }

      // PK badge
      if (isPk) {
        tablesSvg += `    <rect x="${x+8}" y="${fy+7}" width="22" height="12" rx="3" style="fill:${C.pkBg};pointer-events:none;"/>\n`;
        tablesSvg += `    <text x="${x+19}" y="${fy+FH/2+5}" text-anchor="middle" ` +
          `style="font-family:sans-serif;font-size:8px;font-weight:700;fill:${C.pkFg};pointer-events:none;">PK</text>\n`;
      }

      // Field name
      const nameX = isPk ? x + 38 : x + 12;
      tablesSvg += `    <text x="${nameX}" y="${fy+FH/2+5}" ` +
        `style="font-family:${FONT};font-size:12px;font-weight:${isPk?'600':'400'};fill:${isPk?C.pkFg:C.fieldFg};pointer-events:none;">${esc(field.name)}</text>\n`;

      // Field type (right-aligned)
      if (typeName) {
        tablesSvg += `    <text x="${x+w-10}" y="${fy+FH/2+5}" text-anchor="end" ` +
          `style="font-family:${FONT};font-size:11px;fill:${C.typeFg};pointer-events:none;">${esc(typeName)}</text>\n`;
      }

      // Transparent hit-area rect on top ensures the whole row is hoverable
      tablesSvg += `    <rect x="${x}" y="${fy}" width="${w}" height="${FH}" style="fill:transparent;"/>\n`;
      tablesSvg += `  </g>\n`;
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
  <rect width="${svgW}" height="${svgH}" style="fill:${C.bg};"/>
  <g class="dbml-edges">
${edgesSvg}  </g>
  <g class="dbml-tables">
${tablesSvg}  </g>
</svg>`;
}
