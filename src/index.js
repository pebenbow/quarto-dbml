'use strict';

const { Parser } = require('@dbml/core');

// ─── CLI flags ────────────────────────────────────────────────────────────────
// --theme=html         (default) CSS custom property refs; dark-mode at runtime
// --theme=light        hardcoded light palette (PDF / static)
// --theme=dark         hardcoded dark palette  (PDF / static)
// --notation=labels    (default) text cardinality labels ("1" / "N")
// --notation=crowsfoot SVG crow's foot markers
// --routing=smooth     (default) cubic bezier curves
// --routing=orthogonal 90-degree elbow connectors
// --routing=rounded    90-degree elbows with rounded corners
// --level=full         (default) all fields
// --level=keys         PK + FK fields only
// --level=names        table name headers only (no field rows)
// --output-file=<path> write output to file instead of stdout
//                      .png → rasterise SVG via @resvg/resvg-js (2× resolution)
//                      .svg → write raw SVG text
const themeFlag    = (process.argv.find(a => a.startsWith('--theme='))       ?? '--theme=html').split('=')[1];
const notationFlag = (process.argv.find(a => a.startsWith('--notation='))    ?? '--notation=labels').split('=')[1];
const routingFlag  = (process.argv.find(a => a.startsWith('--routing='))     ?? '--routing=smooth').split('=')[1];
const levelFlag    = (process.argv.find(a => a.startsWith('--level='))       ?? '--level=full').split('=')[1];
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
  edgeActive: '#3a6bc8',
  fkFg:       '#1558b0',
  fkBg:       'rgba(21,88,176,0.12)',
  unFg:       '#9a5700',
  unBg:       'rgba(154,87,0,0.12)',
  nnFg:       '#2e7d32',
  nnBg:       'rgba(46,125,50,0.12)',
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
  edgeActive: '#7ba8f0',
  fkFg:       '#74b0f4',
  fkBg:       'rgba(116,176,244,0.2)',
  unFg:       '#e9a020',
  unBg:       'rgba(233,160,32,0.2)',
  nnFg:       '#66bb6a',
  nnBg:       'rgba(102,187,106,0.2)',
};

// For HTML mode: CSS custom property references with LIGHT fallbacks.
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
  fkFg:       'var(--dbml-fk-fg,#1558b0)',
  fkBg:       'var(--dbml-fk-bg,rgba(21,88,176,0.12))',
  unFg:       'var(--dbml-un-fg,#9a5700)',
  unBg:       'var(--dbml-un-bg,rgba(154,87,0,0.12))',
  nnFg:       'var(--dbml-nn-fg,#2e7d32)',
  nnBg:       'var(--dbml-nn-bg,rgba(46,125,50,0.12))',
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
      let Resvg;
      try {
        Resvg = require('@resvg/resvg-js').Resvg;
      } catch {
        process.stderr.write(
          'quarto-dbml: @resvg/resvg-js is not installed.\n' +
          'For PDF output, run once inside the extension directory:\n' +
          '  npm install --prefix _extensions/quarto-dbml/\n'
        );
        process.exit(2);
      }
      const png = new Resvg(svg, {
        background: 'white',
        fitTo: { mode: 'zoom', value: 2 },
      }).render().asPng();
      require('fs').writeFileSync(outputFile, png);

    } else if (outputFile) {
      require('fs').writeFileSync(outputFile, svg);

    } else {
      process.stdout.write(svg);
    }
  } catch (e) {
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

// Crow's foot notation with mandatory/optional modality.
// Reading outward from the entity (card edge at x, line extends in gapDir direction):
//   +4  → modality:    | bar (mandatory)  or  o circle (optional)
//   +7  → tine roots   (many end only)
//   +12 → cardinality: | bar (one end)
//   +14 → crow's foot heel (many end)
function crowsFootMarker(x, y, relation, gapDir, mandatory, color) {
  const s = `stroke:${color};stroke-width:1.5;stroke-linecap:round;fill:none;`;
  const H = 7;

  const mdx = x + gapDir * 4;
  const mod = mandatory
    ? `<line x1="${mdx}" y1="${y - H}" x2="${mdx}" y2="${y + H}" style="${s}"/>`
    : `<circle cx="${mdx}" cy="${y}" r="3.5" style="${s}"/>`;

  if (relation === '*') {
    const hx = x + gapDir * 14;  // heel
    const tx = x + gapDir * 7;   // tine root
    return mod +
      `<line x1="${hx}" y1="${y}" x2="${tx}" y2="${y - H}" style="${s}"/>` +
      `<line x1="${hx}" y1="${y}" x2="${tx}" y2="${y + H}" style="${s}"/>`;
  }

  const bx = x + gapDir * 12;
  return mod + `<line x1="${bx}" y1="${y - H}" x2="${bx}" y2="${y + H}" style="${s}"/>`;
}

// Arrows:  Many → filled triangle;  One → single bar
function arrowMarker(x, y, relation, gapDir, color) {
  const H = 7;
  if (relation === '*') {
    const bx = x + gapDir * 12;
    return `<polygon points="${x},${y} ${bx},${y - H} ${bx},${y + H}" style="fill:${color};stroke:none;"/>`;
  } else {
    const bx = x + gapDir * 7;
    return `<line x1="${bx}" y1="${y - H}" x2="${bx}" y2="${y + H}" style="stroke:${color};stroke-width:1.5;stroke-linecap:round;"/>`;
  }
}

// ─── Orthogonal path builder ──────────────────────────────────────────────────
function orthogonalPath(x1, y1, x2, y2, radius) {
  const midX = (x1 + x2) / 2;
  const dy   = y2 - y1;
  if (Math.abs(dy) < 1) return `M ${x1} ${y1} H ${x2}`;
  const r = radius > 0
    ? Math.max(0, Math.min(radius, Math.abs(midX - x1) - 2, Math.abs(dy) / 2 - 2))
    : 0;
  if (r <= 0) return `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
  const sx = x2 > x1 ? 1 : -1;
  const sy = dy > 0  ? 1 : -1;
  return [
    `M ${x1} ${y1}`,
    `H ${midX - sx * r}`,
    `Q ${midX} ${y1} ${midX} ${y1 + sy * r}`,
    `V ${y2 - sy * r}`,
    `Q ${midX} ${y2} ${midX + sx * r} ${y2}`,
    `H ${x2}`,
  ].join(' ');
}

// ─── SVG builder ─────────────────────────────────────────────────────────────

function dbmlToSvg(db) {
  const tables = db.schemas.flatMap(s => s.tables ?? []);
  const refs = [
    ...(Array.isArray(db.refs) ? db.refs : []),
    ...db.schemas.flatMap(s => Array.isArray(s.refs) ? s.refs : []),
  ];

  if (!tables.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="60">` +
      `<text x="12" y="36" style="font-family:sans-serif;font-size:14px;fill:#666;">No tables found in DBML.</text>` +
      `</svg>`;
  }

  // ── FK field lookup ──────────────────────────────────────────────────────
  // Any field referenced in a Ref endpoint is treated as a key field (PK or FK).
  const fkFields = {};
  tables.forEach(t => { fkFields[t.name] = new Set(); });
  refs.forEach(ref => {
    (ref.endpoints ?? []).forEach(ep => {
      if (fkFields[ep.tableName]) {
        (ep.fieldNames ?? []).forEach(fn => fkFields[ep.tableName].add(fn));
      }
    });
  });

  /** 'pk' | 'fk' | 'regular' — used for detail-level CSS filtering only */
  const getFieldType = (tbl, field) => {
    if (field.pk) return 'pk';
    if (fkFields[tbl.name]?.has(field.name)) return 'fk';
    return 'regular';
  };

  const BADGE_W = 22, BADGE_H = 12, BADGE_GAP = 4;

  /** Ordered badge descriptors for a field: PK, FK, UN, NN. */
  function getBadges(tbl, field) {
    const isFk = fkFields[tbl.name]?.has(field.name);
    const b = [];
    if (field.pk)                    b.push({ label: 'PK', fg: C.pkFg, bg: C.pkBg });
    if (isFk)                        b.push({ label: 'FK', fg: C.fkFg, bg: C.fkBg });
    if (field.unique   && !field.pk) b.push({ label: 'UN', fg: C.unFg, bg: C.unBg });
    if (field.not_null && !field.pk) b.push({ label: 'NN', fg: C.nnFg, bg: C.nnBg });
    return b;
  }

  /** Renders badge pill rects + labels; returns svg string and field-name X position. */
  function renderBadges(badges, x, fy, indent) {
    let svg = '', bx = x + 8;
    badges.forEach(b => {
      svg += `${indent}<rect x="${bx}" y="${fy + 7}" width="${BADGE_W}" height="${BADGE_H}" rx="3" style="fill:${b.bg};pointer-events:none;"/>\n`;
      svg += `${indent}<text x="${bx + BADGE_W / 2}" y="${fy + FH / 2 + 5}" text-anchor="middle" style="font-family:sans-serif;font-size:8px;font-weight:700;fill:${b.fg};pointer-events:none;">${b.label}</text>\n`;
      bx += BADGE_W + BADGE_GAP;
    });
    return { svg, nameX: badges.length > 0 ? bx + 4 : x + 12 };
  }

  // HTML mode always renders all fields so the browser can toggle between levels.
  // Static modes (light/dark/pdf) render only the requested subset.
  const isHtml = (themeFlag === 'html');

  const renderFieldsFor = (tbl) => {
    if (isHtml) return tbl.fields;
    if (levelFlag === 'names') return [];
    if (levelFlag === 'keys')  return tbl.fields.filter(f => getFieldType(tbl, f) !== 'regular');
    return tbl.fields;
  };

  // ── Grid layout ──────────────────────────────────────────────────────────
  const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)));

  const meta = {};
  tables.forEach((t, i) => {
    const rf    = renderFieldsFor(t);
    const nKeys = t.fields.filter(f => getFieldType(t, f) !== 'regular').length;
    meta[t.name] = {
      col:    i % cols,
      row:    Math.floor(i / cols),
      h:      TH + rf.length * FH,       // layout height (= hFull for HTML)
      hFull:  TH + t.fields.length * FH,
      hKeys:  TH + nKeys * FH,
      hNames: TH,
    };
  });

  const rowMaxH = {};
  Object.values(meta).forEach(({ row, h }) => {
    rowMaxH[row] = Math.max(rowMaxH[row] ?? 0, h);
  });

  const rowY = {};
  let curY = PAD;
  const numRows = Math.max(...Object.values(meta).map(m => m.row)) + 1;
  for (let r = 0; r < numRows; r++) {
    rowY[r] = curY;
    curY += (rowMaxH[r] ?? 0) + GAPY;
  }

  const pos = {};
  tables.forEach(t => {
    const { col, row, h } = meta[t.name];
    pos[t.name] = { x: PAD + col * (TW + GAPX), y: rowY[row], w: TW, h };
  });

  const svgW = PAD + cols * (TW + GAPX) - GAPX + PAD;
  const svgH = curY - GAPY + PAD;

  // ── Unique ID prefix for clip paths ─────────────────────────────────────
  const svgUid = Math.random().toString(36).slice(2, 8);

  // ── <defs>: clip paths for table cards (HTML mode only) ──────────────────
  // Each clip path rounds the bottom corners of the fields group.
  // JS updates the rect height when the detail level changes.
  let defsSvg = '';
  if (isHtml) {
    defsSvg += '  <defs>\n';
    tables.forEach((tbl, i) => {
      const { x, y } = pos[tbl.name];
      const { hFull } = meta[tbl.name];
      defsSvg += `    <clipPath id="dbml-cp-${svgUid}-${i}" clipPathUnits="userSpaceOnUse">\n`;
      defsSvg += `      <rect x="${x}" y="${y + TH}" width="${TW}" height="${hFull - TH}" rx="6" ry="6"/>\n`;
      defsSvg += `    </clipPath>\n`;
    });
    defsSvg += '  </defs>\n';
  }

  // ── Relationship edges ────────────────────────────────────────────────────
  let edgesSvg = '';
  refs.forEach(ref => {
    if (!ref.endpoints || ref.endpoints.length < 2) return;
    const [e1, e2] = ref.endpoints;
    const p1 = pos[e1.tableName];
    const p2 = pos[e2.tableName];
    if (!p1 || !p2) return;

    const t1  = tables.find(t => t.name === e1.tableName);
    const t2  = tables.find(t => t.name === e2.tableName);
    const fi1 = t1 ? t1.fields.findIndex(f => f.name === (e1.fieldNames?.[0] ?? '')) : -1;
    const fi2 = t2 ? t2.fields.findIndex(f => f.name === (e2.fieldNames?.[0] ?? '')) : -1;

    // HTML: anchor at original (full-mode) field row positions.
    // Static: anchor at the visible field's position, falling back to header mid.
    let ey1, ey2;
    if (isHtml) {
      ey1 = p1.y + TH + Math.max(0, fi1) * FH + FH / 2;
      ey2 = p2.y + TH + Math.max(0, fi2) * FH + FH / 2;
    } else {
      const vis1 = renderFieldsFor(t1 ?? { fields: [], name: e1.tableName });
      const vis2 = renderFieldsFor(t2 ?? { fields: [], name: e2.tableName });
      const vfi1 = fi1 >= 0 ? vis1.findIndex(f => f.name === (e1.fieldNames?.[0] ?? '')) : -1;
      const vfi2 = fi2 >= 0 ? vis2.findIndex(f => f.name === (e2.fieldNames?.[0] ?? '')) : -1;
      ey1 = vfi1 >= 0 ? p1.y + TH + vfi1 * FH + FH / 2 : p1.y + TH / 2;
      ey2 = vfi2 >= 0 ? p2.y + TH + vfi2 * FH + FH / 2 : p2.y + TH / 2;
    }

    // Mandatory = the FK (many-side) field has NOT NULL or is itself a PK.
    // For one-to-one refs we use e1's field. PK implies NOT NULL.
    const fkEp    = (e1.relation === '*') ? e1 : (e2.relation === '*') ? e2 : e1;
    const fkTbl   = tables.find(t => t.name === fkEp.tableName);
    const fkField = fkTbl?.fields.find(f => f.name === (fkEp.fieldNames?.[0] ?? ''));
    const mandatory = !!(fkField?.not_null || fkField?.pk);

    const goRight = p1.x <= p2.x;
    const ex1 = goRight ? p1.x + TW : p1.x;
    const ex2 = goRight ? p2.x      : p2.x + TW;
    const cp  = Math.max(40, Math.abs(ex2 - ex1) * 0.4);

    let d;
    if (routingFlag === 'orthogonal') {
      d = orthogonalPath(ex1, ey1, ex2, ey2, 0);
    } else if (routingFlag === 'rounded') {
      d = orthogonalPath(ex1, ey1, ex2, ey2, 10);
    } else {
      d = `M ${ex1} ${ey1} C ${ex1+(goRight?cp:-cp)} ${ey1} ${ex2+(goRight?-cp:cp)} ${ey2} ${ex2} ${ey2}`;
    }

    const flowDir = (e1.relation === '*' && e2.relation === '1') ? 'reverse' : 'forward';

    // Data attrs for JS-driven edge recalculation when level changes (HTML only)
    let edgeDataAttrs = '';
    if (isHtml) {
      edgeDataAttrs =
        ` data-ex1="${ex1}" data-ey1="${ey1}" data-ex2="${ex2}" data-ey2="${ey2}"` +
        ` data-t1="${esc(e1.tableName)}" data-t2="${esc(e2.tableName)}"` +
        ` data-fi1="${fi1}" data-fi2="${fi2}"` +
        ` data-routing="${routingFlag}" data-go-right="${goRight ? 1 : 0}"` +
        ` data-e1-rel="${esc(e1.relation ?? '')}" data-e2-rel="${esc(e2.relation ?? '')}"` +
        ` data-notation="${notationFlag}"` +
        ` data-mandatory="${mandatory ? 1 : 0}"`;
    }

    edgesSvg += `  <g class="dbml-edge-group" data-flow-dir="${flowDir}"${edgeDataAttrs}>\n`;
    edgesSvg += `    <path class="dbml-edge-path" d="${d}" stroke-width="1.5" fill="none" opacity="0.85" style="stroke:${C.edge};"/>\n`;
    edgesSvg += `    <path class="dbml-edge-flow" d="${d}" stroke-width="2" fill="none" stroke-dasharray="8 6" opacity="0" pointer-events="none" style="stroke:${C.edgeActive};"/>\n`;
    edgesSvg += `    <path class="dbml-edge-hit" d="${d}" stroke-width="12" fill="none" stroke="transparent"/>\n`;

    const g1 = goRight ? 1 : -1;
    const g2 = goRight ? -1 : 1;

    // Each end's markers are wrapped in a <g> so JS can translate them as a unit
    // when edge endpoints move during level switching.
    edgesSvg += `    <g class="dbml-marker-end-1">\n`;
    if (notationFlag === 'crowsfoot') {
      edgesSvg += '      ' + crowsFootMarker(ex1, ey1, e1.relation, g1, mandatory, C.edge) + '\n';
    } else if (notationFlag === 'arrows') {
      edgesSvg += '      ' + arrowMarker(ex1, ey1, e1.relation, g1, C.edge) + '\n';
    } else if (notationFlag === 'uml') {
      const lbl = r => r === '*' ? '*' : '1';
      const lx1 = ex1 + (goRight ? 8 : -8);
      edgesSvg += `      <text x="${lx1}" y="${ey1-5}" text-anchor="${goRight?'start':'end'}" style="font-family:sans-serif;font-size:11px;font-weight:600;fill:${C.edge};">${lbl(e1.relation)}</text>\n`;
    } else {
      const lbl = r => r === '*' ? 'N' : '1';
      const lx1 = ex1 + (goRight ? 8 : -8);
      edgesSvg += `      <text x="${lx1}" y="${ey1-5}" text-anchor="${goRight?'start':'end'}" style="font-family:sans-serif;font-size:10px;font-weight:600;fill:${C.edge};">${lbl(e1.relation)}</text>\n`;
    }
    edgesSvg += `    </g>\n`;

    edgesSvg += `    <g class="dbml-marker-end-2">\n`;
    if (notationFlag === 'crowsfoot') {
      edgesSvg += '      ' + crowsFootMarker(ex2, ey2, e2.relation, g2, mandatory, C.edge) + '\n';
    } else if (notationFlag === 'arrows') {
      edgesSvg += '      ' + arrowMarker(ex2, ey2, e2.relation, g2, C.edge) + '\n';
    } else if (notationFlag === 'uml') {
      const lbl = r => r === '*' ? '*' : '1';
      const lx2 = ex2 + (goRight ? -12 : 8);
      edgesSvg += `      <text x="${lx2}" y="${ey2-5}" text-anchor="${goRight?'end':'start'}" style="font-family:sans-serif;font-size:11px;font-weight:600;fill:${C.edge};">${lbl(e2.relation)}</text>\n`;
    } else {
      const lbl = r => r === '*' ? 'N' : '1';
      const lx2 = ex2 + (goRight ? -12 : 8);
      edgesSvg += `      <text x="${lx2}" y="${ey2-5}" text-anchor="${goRight?'end':'start'}" style="font-family:sans-serif;font-size:10px;font-weight:600;fill:${C.edge};">${lbl(e2.relation)}</text>\n`;
    }
    edgesSvg += `    </g>\n`;

    edgesSvg += `  </g>\n`;
  });

  // ── Table cards ───────────────────────────────────────────────────────────
  let tablesSvg = '';
  tables.forEach((tbl, i) => {
    const { x, y, w, h } = pos[tbl.name];
    const { hFull, hKeys, hNames } = meta[tbl.name];

    if (isHtml) {
      // ── HTML: wrap in <g> with data attrs; render all fields inside a
      //    clip path group so JS can reposition rows and shrink the card.
      const cpId = `dbml-cp-${svgUid}-${i}`;

      tablesSvg +=
        `  <g class="dbml-table"` +
        ` data-table-name="${esc(tbl.name)}"` +
        ` data-x="${x}" data-y="${y}"` +
        ` data-base-y="${y + TH}"` +
        ` data-header-y="${y + TH / 2}"` +
        ` data-h-full="${hFull}"` +
        ` data-h-keys="${hKeys}"` +
        ` data-h-names="${hNames}"` +
        ` data-clip-id="${cpId}">\n`;

      // Shadow and card body — JS updates their height attribute on level change
      tablesSvg += `    <rect class="dbml-card-shadow" x="${x+3}" y="${y+3}" width="${w}" height="${h}" rx="6" style="fill:${C.shadow};"/>\n`;
      tablesSvg += `    <rect class="dbml-card-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="6" style="fill:${C.cardBg};stroke:${C.border};stroke-width:1;"/>\n`;

      // Header (rounded top, square bottom patch)
      tablesSvg += `    <rect x="${x}" y="${y}" width="${w}" height="${TH}" rx="6" style="fill:${C.hdrBg};"/>\n`;
      tablesSvg += `    <rect x="${x}" y="${y+TH-6}" width="${w}" height="6" style="fill:${C.hdrBg};"/>\n`;
      tablesSvg +=
        `    <text x="${x+w/2}" y="${y+TH/2+6}" text-anchor="middle" ` +
        `style="font-family:${FONT};font-size:13px;font-weight:600;fill:${C.hdrFg};pointer-events:none;">${esc(tbl.name)}</text>\n`;

      // Fields — all rows, clipped to rounded card boundary
      tablesSvg += `    <g clip-path="url(#${cpId})">\n`;
      tbl.fields.forEach((field, fi) => {
        const fy       = y + TH + fi * FH;
        const bg       = fi % 2 === 0 ? C.rowOdd : C.rowEven;
        const ft       = getFieldType(tbl, field);
        const isPk     = field.pk;
        const typeName = field.type?.type_name ?? '';
        const badges   = getBadges(tbl, field);

        tablesSvg += `      <g class="dbml-field-row" data-field-type="${ft}" data-orig-index="${fi}">\n`;
        tablesSvg += `        <rect x="${x}" y="${fy}" width="${w}" height="${FH}" style="fill:${bg};"/>\n`;
        const { svg: bSvg, nameX } = renderBadges(badges, x, fy, '        ');
        tablesSvg += bSvg;
        tablesSvg +=
          `        <text x="${nameX}" y="${fy+FH/2+5}" ` +
          `style="font-family:${FONT};font-size:12px;font-weight:${isPk?'600':'400'};fill:${isPk?C.pkFg:C.fieldFg};pointer-events:none;">${esc(field.name)}</text>\n`;

        if (typeName) {
          tablesSvg +=
            `        <text x="${x+w-10}" y="${fy+FH/2+5}" text-anchor="end" ` +
            `style="font-family:${FONT};font-size:11px;fill:${C.typeFg};pointer-events:none;">${esc(typeName)}</text>\n`;
        }

        tablesSvg += `        <rect x="${x}" y="${fy}" width="${w}" height="${FH}" style="fill:transparent;"/>\n`;
        tablesSvg += `      </g>\n`;
      });
      tablesSvg += `    </g>\n`;  // close clip group
      tablesSvg += `  </g>\n`;   // close table group

    } else {
      // ── Static (PDF / forced light|dark): render only the level-filtered fields.
      const fieldsToRender = renderFieldsFor(tbl);

      tablesSvg += `  <rect x="${x+3}" y="${y+3}" width="${w}" height="${h}" rx="6" style="fill:${C.shadow};"/>\n`;
      tablesSvg += `  <rect class="dbml-card" x="${x}" y="${y}" width="${w}" height="${h}" rx="6" style="fill:${C.cardBg};stroke:${C.border};stroke-width:1;"/>\n`;
      tablesSvg += `  <rect x="${x}" y="${y}" width="${w}" height="${TH}" rx="6" style="fill:${C.hdrBg};"/>\n`;
      tablesSvg += `  <rect x="${x}" y="${y+TH-6}" width="${w}" height="6" style="fill:${C.hdrBg};"/>\n`;
      tablesSvg +=
        `  <text x="${x+w/2}" y="${y+TH/2+6}" text-anchor="middle" ` +
        `style="font-family:${FONT};font-size:13px;font-weight:600;fill:${C.hdrFg};pointer-events:none;">${esc(tbl.name)}</text>\n`;

      fieldsToRender.forEach((field, fi) => {
        const fy       = y + TH + fi * FH;
        const isLast   = fi === fieldsToRender.length - 1;
        const bg       = fi % 2 === 0 ? C.rowOdd : C.rowEven;
        const ft       = getFieldType(tbl, field);
        const isPk     = field.pk;
        const typeName = field.type?.type_name ?? '';
        const badges   = getBadges(tbl, field);

        tablesSvg += `  <g class="dbml-field-row">\n`;

        if (isLast) {
          tablesSvg +=
            `    <path d="M ${x} ${fy} L ${x} ${fy+FH-6} Q ${x} ${fy+FH} ${x+6} ${fy+FH} ` +
            `L ${x+w-6} ${fy+FH} Q ${x+w} ${fy+FH} ${x+w} ${fy+FH-6} L ${x+w} ${fy} Z" style="fill:${bg};"/>\n`;
        } else {
          tablesSvg += `    <rect x="${x}" y="${fy}" width="${w}" height="${FH}" style="fill:${bg};"/>\n`;
        }

        const { svg: bSvg, nameX } = renderBadges(badges, x, fy, '    ');
        tablesSvg += bSvg;
        tablesSvg +=
          `    <text x="${nameX}" y="${fy+FH/2+5}" ` +
          `style="font-family:${FONT};font-size:12px;font-weight:${isPk?'600':'400'};fill:${isPk?C.pkFg:C.fieldFg};pointer-events:none;">${esc(field.name)}</text>\n`;

        if (typeName) {
          tablesSvg +=
            `    <text x="${x+w-10}" y="${fy+FH/2+5}" text-anchor="end" ` +
            `style="font-family:${FONT};font-size:11px;fill:${C.typeFg};pointer-events:none;">${esc(typeName)}</text>\n`;
        }

        tablesSvg += `    <rect x="${x}" y="${fy}" width="${w}" height="${FH}" style="fill:transparent;"/>\n`;
        tablesSvg += `  </g>\n`;
      });
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
  <rect class="dbml-bg" width="${svgW}" height="${svgH}" style="fill:${C.bg};"/>
${defsSvg}  <g class="dbml-edges">
${edgesSvg}  </g>
  <g class="dbml-tables">
${tablesSvg}  </g>
</svg>`;
}
