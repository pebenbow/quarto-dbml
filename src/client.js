import svgPanZoom from 'svg-pan-zoom';

// SVG icon: two circles connected by a line (represents a relationship).
const TOGGLE_ICON = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="3" cy="7" r="2.5" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="11" cy="7" r="2.5" stroke="currentColor" stroke-width="1.5"/>
  <line x1="5.5" y1="7" x2="8.5" y2="7" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

/** Initialise pan/zoom and relationship interactions on a single .dbml-diagram. */
function initDiagram(wrapper) {
  const svg = wrapper.querySelector('svg');
  if (!svg || svg.dataset.dbmlInit) return;
  svg.dataset.dbmlInit = '1';

  // Ensure the SVG has an ID (required by svg-pan-zoom)
  if (!svg.id) {
    svg.id = 'dbml-svg-' + Math.random().toString(36).slice(2, 9);
  }

  // Size the container to the SVG's natural height, capped at 520px.
  // Users can pan/zoom to explore larger diagrams.
  const naturalH = parseInt(svg.getAttribute('height') || '400', 10);
  const containerH = Math.min(naturalH + 16, 520);
  wrapper.style.height = containerH + 'px';

  // Make the SVG fill its container so svg-pan-zoom can manage the viewport.
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
    // Keep control icons inside the visible area
    customEventsHandler: {
      haltEventListeners: [],
      init() {},
      destroy() {},
    },
  });

  // ── Toggle button (highlight all relationships) ───────────────────────────
  const btn = document.createElement('button');
  btn.className = 'dbml-toggle-btn';
  btn.title = 'Highlight all relationships';
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = TOGGLE_ICON;
  wrapper.appendChild(btn);

  btn.addEventListener('click', () => {
    const active = wrapper.classList.toggle('dbml-highlight-all');
    btn.setAttribute('aria-pressed', String(active));
  });

  // ── Edge group interactions ───────────────────────────────────────────────

  const edgeGroups = Array.from(svg.querySelectorAll('.dbml-edge-group'));

  // Click an edge group to lock its highlight; click again to release.
  // stopPropagation prevents the SVG background click from immediately
  // clearing the selection we just made.
  edgeGroups.forEach(group => {
    group.addEventListener('click', e => {
      e.stopPropagation();
      group.classList.toggle('dbml-edge-selected');
    });
  });

  // Clicking anywhere on the SVG background (not an edge) clears all locks.
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
