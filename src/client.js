import svgPanZoom from 'svg-pan-zoom';

/** Initialise pan/zoom on a single .dbml-diagram wrapper. */
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
}

function init() {
  document.querySelectorAll('.dbml-diagram').forEach(initDiagram);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
