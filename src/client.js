import svgPanZoom from 'svg-pan-zoom';

// ─── Layout constants (must match index.js) ───────────────────────────────────
const TH_C = 38;
const FH_C = 26;

// ─── SVG icon: two circles connected by a line ───────────────────────────────
const TOGGLE_ICON = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="3" cy="7" r="2.5" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="11" cy="7" r="2.5" stroke="currentColor" stroke-width="1.5"/>
  <line x1="5.5" y1="7" x2="8.5" y2="7" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

// ─── Detail level cycling ─────────────────────────────────────────────────────
const DETAIL_LEVELS  = ['full', 'keys', 'names'];
const DETAIL_LABELS  = { full: 'All', keys: 'Key', names: 'Hdr' };
const DETAIL_TITLES  = {
  full:  'Show all columns',
  keys:  'Show key columns only (PK + FK)',
  names: 'Show table names only',
};

// ─── Orthogonal path (duplicated from index.js for browser use) ───────────────
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

// ─── Find a .dbml-table <g> by table name ─────────────────────────────────────
function findTableGroup(svg, name) {
  for (const g of svg.querySelectorAll('.dbml-table')) {
    if (g.dataset.tableName === name) return g;
  }
  return null;
}

// ─── Update all diagrams to a new detail level ────────────────────────────────
function updateDetailLevel(wrapper, level) {
  const svg = wrapper.querySelector('svg');
  if (!svg) return;

  // Track the new center-Y for each table's field rows after repositioning.
  // Used for edge endpoint recalculation.
  const tableFieldCenterY = {};  // tableName → { origIndex: newCenterY }

  // ── Resize and reposition table cards ─────────────────────────────────────
  svg.querySelectorAll('.dbml-table').forEach(tableGroup => {
    const tableName = tableGroup.dataset.tableName;
    const baseY     = +tableGroup.dataset.baseY;    // y + TH (top of first field row)
    const headerY   = +tableGroup.dataset.headerY;  // midpoint of header band
    const hFull     = +tableGroup.dataset.hFull;
    const hKeys     = +tableGroup.dataset.hKeys;
    const hNames    = +tableGroup.dataset.hNames;

    const newH = level === 'keys' ? hKeys : level === 'names' ? hNames : hFull;

    // Resize card shadow and body
    tableGroup.querySelector('.dbml-card-shadow')?.setAttribute('height', newH);
    tableGroup.querySelector('.dbml-card-body')?.setAttribute('height', newH);

    // Resize clipPath rect (height = card height minus header)
    const cpId   = tableGroup.dataset.clipId;
    const cpRect = document.getElementById(cpId)?.querySelector('rect');
    if (cpRect) cpRect.setAttribute('height', newH - TH_C);

    // Reposition field rows
    const rows = Array.from(tableGroup.querySelectorAll('.dbml-field-row'));
    tableFieldCenterY[tableName] = {};

    let slot = 0;
    rows.forEach(row => {
      const ft        = row.dataset.fieldType;
      const origIndex = +row.dataset.origIndex;
      const isVisible =
        level === 'full' ||
        (level === 'keys' && (ft === 'pk' || ft === 'fk'));
      // level === 'names': all rows hidden

      if (!isVisible) {
        row.style.display = 'none';
        row.setAttribute('transform', '');
        tableFieldCenterY[tableName][origIndex] = headerY;
      } else {
        row.style.display = '';
        const origY      = baseY + origIndex * FH_C;
        const newSlotY   = baseY + slot * FH_C;
        const translateY = newSlotY - origY;
        row.setAttribute('transform', translateY !== 0 ? `translate(0,${translateY})` : '');
        tableFieldCenterY[tableName][origIndex] = newSlotY + FH_C / 2;
        slot++;
      }
    });
  });

  // ── Recalculate edge paths ─────────────────────────────────────────────────
  svg.querySelectorAll('.dbml-edge-group').forEach(group => {
    const t1      = group.dataset.t1;
    const t2      = group.dataset.t2;
    const fi1     = +group.dataset.fi1;
    const fi2     = +group.dataset.fi2;
    const ex1     = +group.dataset.ex1;
    const ex2     = +group.dataset.ex2;
    const goRight = group.dataset.goRight === '1';
    const routing = group.dataset.routing;

    // Fall back to header midpoint if field not found in lookup
    const tg1      = findTableGroup(svg, t1);
    const tg2      = findTableGroup(svg, t2);
    const hdrY1    = tg1 ? +tg1.dataset.headerY : +group.dataset.ey1;
    const hdrY2    = tg2 ? +tg2.dataset.headerY : +group.dataset.ey2;

    const ey1 = level === 'names'
      ? hdrY1
      : (tableFieldCenterY[t1]?.[fi1] ?? hdrY1);
    const ey2 = level === 'names'
      ? hdrY2
      : (tableFieldCenterY[t2]?.[fi2] ?? hdrY2);

    const d = computeEdgePath(ex1, ey1, ex2, ey2, goRight, routing);

    // Update the three path elements (base, flow, hit)
    group.querySelectorAll('path').forEach(p => p.setAttribute('d', d));

    // Translate each marker end group by its Y delta
    const origEy1 = +group.dataset.ey1;
    const origEy2 = +group.dataset.ey2;
    const dy1 = ey1 - origEy1;
    const dy2 = ey2 - origEy2;

    const m1 = group.querySelector('.dbml-marker-end-1');
    const m2 = group.querySelector('.dbml-marker-end-2');
    if (m1) m1.setAttribute('transform', dy1 !== 0 ? `translate(0,${dy1})` : '');
    if (m2) m2.setAttribute('transform', dy2 !== 0 ? `translate(0,${dy2})` : '');
  });
}

// ─── Initialise a single .dbml-diagram ────────────────────────────────────────
function initDiagram(wrapper) {
  const svg = wrapper.querySelector('svg');
  if (!svg || svg.dataset.dbmlInit) return;
  svg.dataset.dbmlInit = '1';

  if (!svg.id) {
    svg.id = 'dbml-svg-' + Math.random().toString(36).slice(2, 9);
  }

  const naturalH   = parseInt(svg.getAttribute('height') || '400', 10);
  const containerH = Math.min(naturalH + 16, 520);
  wrapper.style.height = containerH + 'px';

  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');

  svgPanZoom(svg, {
    zoomEnabled: true,
    controlIconsEnabled: true,
    fit: true,
    center: true,
    minZoom: 0.1,
    maxZoom: 12,
    zoomScaleSensitivity: 0.25,
    customEventsHandler: { haltEventListeners: [], init() {}, destroy() {} },
  });

  // ── Detect initial detail level from wrapper CSS class ──────────────────
  let currentLevel = 'full';
  for (const cls of wrapper.classList) {
    if (cls.startsWith('dbml-level-')) {
      const lv = cls.slice('dbml-level-'.length);
      if (DETAIL_LEVELS.includes(lv)) {
        currentLevel = lv;
        break;
      }
    }
  }

  // Apply initial level layout (handles non-full starting levels)
  if (currentLevel !== 'full') {
    updateDetailLevel(wrapper, currentLevel);
  }

  // ── Toggle button (highlight all relationships) ─────────────────────────
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
  detailBtn.className = 'dbml-detail-btn' + (currentLevel !== 'full' ? ' dbml-detail-active' : '');
  detailBtn.title = DETAIL_TITLES[currentLevel];
  detailBtn.textContent = DETAIL_LABELS[currentLevel];
  wrapper.appendChild(detailBtn);

  detailBtn.addEventListener('click', () => {
    const nextIndex  = (DETAIL_LEVELS.indexOf(currentLevel) + 1) % DETAIL_LEVELS.length;
    currentLevel     = DETAIL_LEVELS[nextIndex];

    detailBtn.textContent = DETAIL_LABELS[currentLevel];
    detailBtn.title       = DETAIL_TITLES[currentLevel];
    detailBtn.classList.toggle('dbml-detail-active', currentLevel !== 'full');

    updateDetailLevel(wrapper, currentLevel);
  });

  // ── Edge group interactions ──────────────────────────────────────────────
  const edgeGroups = Array.from(svg.querySelectorAll('.dbml-edge-group'));

  edgeGroups.forEach(group => {
    group.addEventListener('click', e => {
      e.stopPropagation();
      group.classList.toggle('dbml-edge-selected');
    });
  });

  svg.addEventListener('click', () => {
    edgeGroups.forEach(g => g.classList.remove('dbml-edge-selected'));
  });
}

function init() {
  document.querySelectorAll('.dbml-diagram').forEach(initDiagram);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
