import svgPanZoom from 'svg-pan-zoom';

// ─── Constants (must match src/index.js) ─────────────────────────────────────
const TW_C   = 240;
const TH_C   = 38;
const FH_C   = 26;
const GAPX_C = 80;
const GAPY_C = 60;
const PAD_C  = 40;

// ─── Icons ────────────────────────────────────────────────────────────────────
const TOGGLE_ICON = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="3" cy="7" r="2.5" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="11" cy="7" r="2.5" stroke="currentColor" stroke-width="1.5"/>
  <line x1="5.5" y1="7" x2="8.5" y2="7" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

// ─── Detail level config ──────────────────────────────────────────────────────
const DETAIL_LEVELS = ['full', 'keys', 'names'];
const DETAIL_LABELS = { full: 'All', keys: 'Key', names: 'Hdr' };
const DETAIL_TITLES = {
  full:  'Show all columns',
  keys:  'Show key columns only (PK + FK)',
  names: 'Show table names only',
};

// ─── Layout config ────────────────────────────────────────────────────────────
const LAYOUT_MODES  = ['grid', 'lr', 'tb', 'radial'];
const LAYOUT_LABELS = { grid: 'Grd', lr: 'LR', tb: 'TB', radial: 'Ctr' };
const LAYOUT_TITLES = {
  grid:   'Grid layout',
  lr:     'Left-right hierarchical layout',
  tb:     'Top-bottom hierarchical layout',
  radial: 'Radial layout (most-connected table at center)',
};

// ─── Path helpers ─────────────────────────────────────────────────────────────
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

function computeEdgePath(ex1, ey1, ex2, ey2, goRight, routing) {
  if (routing === 'orthogonal') return orthogonalPath(ex1, ey1, ex2, ey2, 0);
  if (routing === 'rounded')    return orthogonalPath(ex1, ey1, ex2, ey2, 10);
  const cp = Math.max(40, Math.abs(ex2 - ex1) * 0.4);
  return `M ${ex1} ${ey1} C ${ex1+(goRight?cp:-cp)} ${ey1} ${ex2+(goRight?-cp:cp)} ${ey2} ${ex2} ${ey2}`;
}

// ─── Graph building ───────────────────────────────────────────────────────────
function buildGraph(svg) {
  const tables    = [];
  const tableData = {};

  svg.querySelectorAll('.dbml-table').forEach(g => {
    const name = g.dataset.tableName;
    if (!name) return;
    tables.push(name);
    tableData[name] = {
      origX:  +g.dataset.x,
      origY:  +g.dataset.y,
      hFull:  +g.dataset.hFull,
      hKeys:  +g.dataset.hKeys,
      hNames: +g.dataset.hNames,
    };
  });

  // deps[A] = tables A has an FK pointing to  (A depends on B means A → B)
  // rdeps[B] = tables with FKs pointing to B  (B is depended on by A)
  // neighbors = undirected connections
  const deps = {}, rdeps = {}, neighbors = {};
  tables.forEach(t => { deps[t] = new Set(); rdeps[t] = new Set(); neighbors[t] = new Set(); });

  svg.querySelectorAll('.dbml-edge-group').forEach(g => {
    if (!g.dataset.t1) return;
    const { t1, t2 } = g.dataset;
    const e1rel = g.dataset.e1Rel;
    const [fk, pk] = e1rel === '*' ? [t1, t2] : [t2, t1];
    if (deps[fk] && rdeps[pk]) {
      deps[fk].add(pk);
      rdeps[pk].add(fk);
    }
    if (neighbors[t1] && neighbors[t2]) {
      neighbors[t1].add(t2);
      neighbors[t2].add(t1);
    }
  });

  return { tables, tableData, deps, rdeps, neighbors };
}

// ─── Layout algorithms ────────────────────────────────────────────────────────

/**
 * Topological level assignment.
 * Level 0 = tables with no FK dependencies (pure dimension / root tables).
 * Level n = deepest fact / bridge tables.
 */
function computeLevels(tables, deps, rdeps) {
  const level    = {};
  const inCount  = {};
  tables.forEach(t => { inCount[t] = deps[t].size; });

  // Seed: tables with no outgoing FK dependencies start at level 0
  const queue = [];
  tables.forEach(t => {
    if (inCount[t] === 0) { level[t] = 0; queue.push(t); }
  });

  const visited = new Set();
  while (queue.length > 0) {
    const t = queue.shift();
    if (visited.has(t)) continue;
    visited.add(t);
    rdeps[t].forEach(dep => {
      level[dep] = Math.max(level[dep] ?? 0, (level[t] ?? 0) + 1);
      if (--inCount[dep] <= 0) queue.push(dep);
    });
  }

  // Cycles or islands: place after the deepest assigned level
  const maxLevel = Math.max(0, ...Object.values(level), -Infinity);
  tables.forEach(t => { if (!(t in level)) level[t] = maxLevel + 1; });

  return level;
}

/** Grid: preserve the original renderer positions. */
function computeGridPositions(tables, tableData) {
  const positions = {};
  tables.forEach(t => { positions[t] = { x: tableData[t].origX, y: tableData[t].origY }; });
  return positions;
}

/** Left-right: dimension tables on the left, fact tables on the right. */
function computeLRPositions(tables, tableData, deps, rdeps) {
  const level = computeLevels(tables, deps, rdeps);

  const levelGroups = {};
  tables.forEach(t => {
    const l = level[t];
    if (!levelGroups[l]) levelGroups[l] = [];
    levelGroups[l].push(t);
  });

  const positions = {};
  Object.keys(levelGroups).map(Number).sort((a, b) => a - b).forEach(l => {
    const x = PAD_C + l * (TW_C + GAPX_C);
    let y = PAD_C;
    levelGroups[l].forEach(t => {
      positions[t] = { x, y };
      y += tableData[t].hFull + GAPY_C;
    });
  });
  return positions;
}

/** Top-bottom: dimension tables on top, fact tables below. */
function computeTBPositions(tables, tableData, deps, rdeps) {
  const level = computeLevels(tables, deps, rdeps);

  const levelGroups = {};
  tables.forEach(t => {
    const l = level[t];
    if (!levelGroups[l]) levelGroups[l] = [];
    levelGroups[l].push(t);
  });

  const positions = {};
  let curY = PAD_C;
  Object.keys(levelGroups).map(Number).sort((a, b) => a - b).forEach(l => {
    const levelTables = levelGroups[l];
    let curX = PAD_C;
    levelTables.forEach(t => {
      positions[t] = { x: curX, y: curY };
      curX += TW_C + GAPX_C;
    });
    const rowH = Math.max(0, ...levelTables.map(t => tableData[t].hFull));
    curY += rowH + GAPY_C;
  });
  return positions;
}

/**
 * Radial: most-connected table at center; other tables in concentric rings
 * ordered by BFS distance from the central node.
 * Works for star schemas (one ring), snowflake schemas (multiple rings),
 * and mixed schemas with outrigger / bridge tables.
 */
function computeRadialPositions(tables, tableData, neighbors) {
  if (tables.length === 0) return {};
  if (tables.length === 1) return { [tables[0]]: { x: PAD_C, y: PAD_C } };

  // Central table = highest degree; break ties alphabetically for stability
  const central = tables.reduce((best, t) =>
    neighbors[t].size > neighbors[best].size ||
    (neighbors[t].size === neighbors[best].size && t < best)
      ? t : best,
    tables[0]
  );

  // BFS distances from central
  const dist = { [central]: 0 };
  const bfsQ = [central];
  while (bfsQ.length > 0) {
    const t = bfsQ.shift();
    neighbors[t].forEach(n => {
      if (!(n in dist)) { dist[n] = dist[t] + 1; bfsQ.push(n); }
    });
  }
  // Disconnected tables get the next ring after the farthest connected node
  const maxDist = Math.max(0, ...Object.values(dist));
  tables.forEach(t => { if (!(t in dist)) dist[t] = maxDist + 1; });

  // Group by ring
  const rings = {};
  tables.forEach(t => {
    if (!rings[dist[t]]) rings[dist[t]] = [];
    rings[dist[t]].push(t);
  });

  // Ring radius: large enough that tables in the largest ring don't overlap
  const maxRingSize = Math.max(...Object.values(rings).map(r => r.length));
  const baseRadius  = Math.max(
    TW_C + GAPX_C * 2,
    (maxRingSize * (TW_C + GAPX_C)) / (2 * Math.PI)
  );

  const cx = baseRadius * 1.5 + TW_C / 2;
  const cy = baseRadius * 1.5 + tableData[central].hFull / 2;

  const positions = {};
  positions[central] = { x: cx - TW_C / 2, y: cy - tableData[central].hFull / 2 };

  Object.keys(rings).map(Number).filter(d => d > 0).sort((a, b) => a - b).forEach(d => {
    const ringTables = rings[d];
    const radius     = d * baseRadius;
    ringTables.forEach((t, i) => {
      const angle = (2 * Math.PI * i / ringTables.length) - Math.PI / 2;
      positions[t] = {
        x: cx + radius * Math.cos(angle) - TW_C / 2,
        y: cy + radius * Math.sin(angle) - tableData[t].hFull / 2,
      };
    });
  });

  return positions;
}

/** Shift all positions so the top-left corner starts at (PAD_C, PAD_C). */
function normalizePositions(positions) {
  const xs   = Object.values(positions).map(p => p.x);
  const ys   = Object.values(positions).map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const shiftX = PAD_C - minX;
  const shiftY = PAD_C - minY;

  const out = {};
  Object.entries(positions).forEach(([t, p]) => {
    out[t] = { x: p.x + shiftX, y: p.y + shiftY };
  });
  return out;
}

function computePositions(layout, tables, tableData, deps, rdeps, neighbors) {
  let raw;
  if      (layout === 'lr')     raw = computeLRPositions(tables, tableData, deps, rdeps);
  else if (layout === 'tb')     raw = computeTBPositions(tables, tableData, deps, rdeps);
  else if (layout === 'radial') raw = computeRadialPositions(tables, tableData, neighbors);
  else                          raw = computeGridPositions(tables, tableData);

  return normalizePositions(raw);
}

// ─── State ────────────────────────────────────────────────────────────────────

function buildState(svg, initLevel, initLayout) {
  const { tables, tableData, deps, rdeps, neighbors } = buildGraph(svg);

  // Original (renderer) positions
  const tableOrigPositions = {};
  tables.forEach(t => {
    tableOrigPositions[t] = { x: tableData[t].origX, y: tableData[t].origY };
  });

  // Field slot positions: full mode → slot = original index
  const tableFieldSlot = {};
  tables.forEach(t => {
    tableFieldSlot[t] = {};
    const tg = svg.querySelector(`.dbml-table[data-table-name]`);
    // find by iterating (avoids CSS.escape dependency)
    for (const g of svg.querySelectorAll('.dbml-table')) {
      if (g.dataset.tableName !== t) continue;
      g.querySelectorAll('.dbml-field-row').forEach(row => {
        const i = +row.dataset.origIndex;
        tableFieldSlot[t][i] = i;
      });
      break;
    }
  });

  return {
    level:              initLevel,
    layout:             initLayout,
    tablePositions:     { ...tableOrigPositions },
    tableOrigPositions,
    tableFieldSlot,
    tableData,
    tables,
    deps,
    rdeps,
    neighbors,
  };
}

// ─── Edge routing ─────────────────────────────────────────────────────────────

function rerouteEdges(svg, state) {
  svg.querySelectorAll('.dbml-edge-group').forEach(group => {
    if (!group.dataset.ex1) return;

    const t1 = group.dataset.t1, t2 = group.dataset.t2;
    const fi1 = +group.dataset.fi1, fi2 = +group.dataset.fi2;
    const routing = group.dataset.routing;

    const pos1 = state.tablePositions[t1];
    const pos2 = state.tablePositions[t2];
    if (!pos1 || !pos2) return;

    // Exit side is determined by current table positions
    const goRight = pos1.x <= pos2.x;
    const ex1 = goRight ? pos1.x + TW_C : pos1.x;
    const ex2 = goRight ? pos2.x         : pos2.x + TW_C;

    // Field center Y: use slot index in the current detail level
    const slot1 = state.tableFieldSlot[t1]?.[fi1] ?? -1;
    const slot2 = state.tableFieldSlot[t2]?.[fi2] ?? -1;
    const ey1   = slot1 >= 0 ? pos1.y + TH_C + slot1 * FH_C + FH_C / 2 : pos1.y + TH_C / 2;
    const ey2   = slot2 >= 0 ? pos2.y + TH_C + slot2 * FH_C + FH_C / 2 : pos2.y + TH_C / 2;

    const d = computeEdgePath(ex1, ey1, ex2, ey2, goRight, routing);
    group.querySelectorAll('path').forEach(p => p.setAttribute('d', d));

    // Translate marker groups by their Y delta from the original render position
    const origEy1 = +group.dataset.ey1, origEy2 = +group.dataset.ey2;
    const dy1 = ey1 - origEy1, dy2 = ey2 - origEy2;
    const m1 = group.querySelector('.dbml-marker-end-1');
    const m2 = group.querySelector('.dbml-marker-end-2');
    if (m1) m1.setAttribute('transform', dy1 !== 0 ? `translate(0,${dy1})` : '');
    if (m2) m2.setAttribute('transform', dy2 !== 0 ? `translate(0,${dy2})` : '');
  });
}

// ─── Detail level ─────────────────────────────────────────────────────────────

function setLevel(state, wrapper, svg, level) {
  state.level = level;

  // Sync wrapper class so CSS hiding rules don't conflict with JS display resets
  DETAIL_LEVELS.forEach(l => wrapper.classList.remove('dbml-level-' + l));
  wrapper.classList.add('dbml-level-' + level);

  svg.querySelectorAll('.dbml-table').forEach(tableGroup => {
    const tableName = tableGroup.dataset.tableName;
    if (!tableName) return;

    const hFull  = +tableGroup.dataset.hFull;
    const hKeys  = +tableGroup.dataset.hKeys;
    const hNames = +tableGroup.dataset.hNames;
    const newH   = level === 'keys' ? hKeys : level === 'names' ? hNames : hFull;

    tableGroup.querySelector('.dbml-card-shadow')?.setAttribute('height', newH);
    tableGroup.querySelector('.dbml-card-body')?.setAttribute('height', newH);

    const cpRect = document.getElementById(tableGroup.dataset.clipId)?.querySelector('rect');
    if (cpRect) cpRect.setAttribute('height', newH - TH_C);

    const rows = Array.from(tableGroup.querySelectorAll('.dbml-field-row'));
    if (!state.tableFieldSlot[tableName]) state.tableFieldSlot[tableName] = {};

    let slot = 0;
    rows.forEach(row => {
      const ft        = row.dataset.fieldType;
      const origIndex = +row.dataset.origIndex;
      const visible   = level === 'full' || (level === 'keys' && (ft === 'pk' || ft === 'fk'));

      if (!visible) {
        row.style.display = 'none';
        row.setAttribute('transform', '');
        state.tableFieldSlot[tableName][origIndex] = -1;
      } else {
        row.style.display = '';
        const dy = (slot - origIndex) * FH_C;
        row.setAttribute('transform', dy !== 0 ? `translate(0,${dy})` : '');
        state.tableFieldSlot[tableName][origIndex] = slot;
        slot++;
      }
    });
  });

  rerouteEdges(svg, state);
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function setLayout(state, wrapper, svg, panZoom, layout) {
  state.layout = layout;

  const positions = computePositions(
    layout, state.tables, state.tableData,
    state.deps, state.rdeps, state.neighbors
  );
  state.tablePositions = positions;

  // Apply transform to each table group
  svg.querySelectorAll('.dbml-table').forEach(g => {
    const name = g.dataset.tableName;
    if (!name || !positions[name]) return;
    const { origX, origY } = state.tableData[name];
    const dx = positions[name].x - origX;
    const dy = positions[name].y - origY;
    g.setAttribute('transform', (dx || dy) ? `translate(${dx},${dy})` : '');
  });

  rerouteEdges(svg, state);

  // Expand SVG viewBox to fit the new layout extents
  let maxX = 0, maxY = 0;
  Object.entries(positions).forEach(([t, p]) => {
    maxX = Math.max(maxX, p.x + TW_C);
    maxY = Math.max(maxY, p.y + (state.tableData[t]?.hFull ?? 100));
  });
  svg.setAttribute('viewBox', `0 0 ${maxX + PAD_C} ${maxY + PAD_C}`);

  if (panZoom) {
    panZoom.resize();
    panZoom.fit();
    panZoom.center();
  }
}

// ─── Diagram initialisation ───────────────────────────────────────────────────

function initDiagram(wrapper) {
  const svg = wrapper.querySelector('svg');
  if (!svg || svg.dataset.dbmlInit) return;
  svg.dataset.dbmlInit = '1';

  if (!svg.id) svg.id = 'dbml-svg-' + Math.random().toString(36).slice(2, 9);

  const naturalH = parseInt(svg.getAttribute('height') || '400', 10);
  wrapper.style.height = Math.min(naturalH + 16, 520) + 'px';
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');

  const panZoom = svgPanZoom(svg, {
    zoomEnabled: true,
    controlIconsEnabled: true,
    fit: true,
    center: true,
    minZoom: 0.1,
    maxZoom: 12,
    zoomScaleSensitivity: 0.25,
    customEventsHandler: { haltEventListeners: [], init() {}, destroy() {} },
  });

  // ── Read initial state from wrapper attrs/classes ────────────────────────
  let initLevel = 'full';
  wrapper.classList.forEach(cls => {
    if (cls.startsWith('dbml-level-')) {
      const lv = cls.slice('dbml-level-'.length);
      if (DETAIL_LEVELS.includes(lv)) initLevel = lv;
    }
  });
  const layoutAttr = wrapper.dataset.layout ?? 'grid';
  const initLayout = LAYOUT_MODES.includes(layoutAttr) ? layoutAttr : 'grid';

  // ── Build persistent state ───────────────────────────────────────────────
  const state = buildState(svg, initLevel, initLayout);

  // Apply non-default initial states (both may call rerouteEdges internally)
  if (initLevel  !== 'full') setLevel(state, wrapper, svg, initLevel);
  if (initLayout !== 'grid') setLayout(state, wrapper, svg, panZoom, initLayout);

  // ── Highlight-all toggle button ──────────────────────────────────────────
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'dbml-toggle-btn';
  toggleBtn.title = 'Highlight all relationships';
  toggleBtn.setAttribute('aria-pressed', 'false');
  toggleBtn.innerHTML = TOGGLE_ICON;
  wrapper.appendChild(toggleBtn);
  toggleBtn.addEventListener('click', () => {
    const active = wrapper.classList.toggle('dbml-highlight-all');
    toggleBtn.setAttribute('aria-pressed', String(active));
  });

  // ── Detail level button ──────────────────────────────────────────────────
  const detailBtn = document.createElement('button');
  detailBtn.className = 'dbml-detail-btn' + (initLevel !== 'full' ? ' dbml-detail-active' : '');
  detailBtn.title     = DETAIL_TITLES[initLevel];
  detailBtn.textContent = DETAIL_LABELS[initLevel];
  wrapper.appendChild(detailBtn);
  detailBtn.addEventListener('click', () => {
    const next = DETAIL_LEVELS[(DETAIL_LEVELS.indexOf(state.level) + 1) % DETAIL_LEVELS.length];
    setLevel(state, wrapper, svg, next);
    detailBtn.textContent = DETAIL_LABELS[next];
    detailBtn.title       = DETAIL_TITLES[next];
    detailBtn.classList.toggle('dbml-detail-active', next !== 'full');
  });

  // ── Layout button ────────────────────────────────────────────────────────
  const layoutBtn = document.createElement('button');
  layoutBtn.className   = 'dbml-layout-btn' + (initLayout !== 'grid' ? ' dbml-layout-active' : '');
  layoutBtn.title       = LAYOUT_TITLES[initLayout];
  layoutBtn.textContent = LAYOUT_LABELS[initLayout];
  wrapper.appendChild(layoutBtn);
  layoutBtn.addEventListener('click', () => {
    const next = LAYOUT_MODES[(LAYOUT_MODES.indexOf(state.layout) + 1) % LAYOUT_MODES.length];
    setLayout(state, wrapper, svg, panZoom, next);
    layoutBtn.textContent = LAYOUT_LABELS[next];
    layoutBtn.title       = LAYOUT_TITLES[next];
    layoutBtn.classList.toggle('dbml-layout-active', next !== 'grid');
  });

  // ── Edge click interactions ──────────────────────────────────────────────
  const edgeGroups = Array.from(svg.querySelectorAll('.dbml-edge-group'));
  edgeGroups.forEach(g => {
    g.addEventListener('click', e => {
      e.stopPropagation();
      g.classList.toggle('dbml-edge-selected');
    });
  });
  svg.addEventListener('click', () => {
    edgeGroups.forEach(g => g.classList.remove('dbml-edge-selected'));
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
function init() {
  document.querySelectorAll('.dbml-diagram').forEach(initDiagram);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
