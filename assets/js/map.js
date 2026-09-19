/**
 * The choropleth.
 *
 * Countries are shaded by how many books we've read by authors of that
 * nationality, on a five-step single-hue ramp (see styles.css). Countries the
 * 110m boundary file has no polygon for — Malta, Singapore, Martinique and
 * about seventy others — get a point marker instead, so a book from a small
 * country is never invisible.
 */

const ANTARCTICA = '010';
const MAX_BIN = 5;

/** Geometries the boundary file gives no ISO id for, matched by name instead. */
const BY_NAME = { Kosovo: 'UNK' };

export const BIN_LABELS = ['1', '2', '3', '4', '5+'];

/** Books-in-country -> ramp step class. */
export function binClass(count) {
  if (!count) return '';
  return `q${Math.min(count, MAX_BIN)}`;
}

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createMap({ svgEl, topology, countries, byCountry, onSelect, tooltip }) {
  const d3 = window.d3;
  const svg = d3.select(svgEl);
  svg.selectAll('*:not(desc)').remove();

  const numericToCode = new Map();
  for (const [code, meta] of Object.entries(countries)) {
    if (meta.numeric) numericToCode.set(meta.numeric, code);
  }

  const all = window.topojson.feature(topology, topology.objects.countries).features;
  // Antarctica is a third of the map's height and no one's nationality here.
  const features = all.filter((f) => String(f.id) !== ANTARCTICA);
  for (const feature of features) {
    feature.code = numericToCode.get(String(feature.id)) || BY_NAME[feature.properties.name] || null;
  }

  const drawn = new Set(features.map((f) => f.code).filter(Boolean));

  // Countries we've read but can't shade: place a marker at their centroid.
  const points = [...byCountry.values()]
    .filter((entry) => !drawn.has(entry.code) && entry.meta.latlng)
    .map((entry) => ({ entry, lonLat: [entry.meta.latlng[1], entry.meta.latlng[0]] }));

  const projection = d3.geoNaturalEarth1();
  const collection = { type: 'FeatureCollection', features };
  const width = 960;
  projection.fitWidth(width, collection);
  const path = d3.geoPath(projection);
  const [[, y0], [, y1]] = path.bounds(collection);
  const height = Math.ceil(y1 - y0) + 2;
  projection.translate([projection.translate()[0], projection.translate()[1] - y0 + 1]);

  svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const root = svg.append('g');
  root.append('path').attr('class', 'sphere').attr('d', path({ type: 'Sphere' }));

  const describe = (entry) =>
    `<b>${escapeHtml(entry.name)}</b><br>${entry.count} ${entry.count === 1 ? 'book' : 'books'}`;

  const shapes = root
    .append('g')
    .selectAll('path')
    .data(features)
    .join('path')
    .attr('class', (f) => {
      const entry = f.code ? byCountry.get(f.code) : null;
      return ['country', entry ? 'has-books' : '', entry ? binClass(entry.count) : '']
        .filter(Boolean)
        .join(' ');
    })
    .attr('d', path)
    .attr('tabindex', (f) => (f.code && byCountry.has(f.code) ? 0 : null))
    .attr('role', (f) => (f.code && byCountry.has(f.code) ? 'button' : null))
    .attr('aria-label', (f) => {
      const entry = f.code ? byCountry.get(f.code) : null;
      return entry ? `${entry.name}, ${entry.count} ${entry.count === 1 ? 'book' : 'books'}` : null;
    });

  shapes.append('title').text((f) => {
    const entry = f.code ? byCountry.get(f.code) : null;
    return entry ? `${entry.name} — ${entry.count} ${entry.count === 1 ? 'book' : 'books'}` : f.properties.name;
  });

  const dots = root
    .append('g')
    .selectAll('circle')
    .data(points)
    .join('circle')
    .attr('class', (d) => `dot ${binClass(d.entry.count)}`)
    .attr('r', 5)
    .attr('cx', (d) => projection(d.lonLat)[0])
    .attr('cy', (d) => projection(d.lonLat)[1])
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', (d) => `${d.entry.name}, ${d.entry.count} ${d.entry.count === 1 ? 'book' : 'books'}`);

  dots.append('title').text((d) => `${d.entry.name} — ${d.entry.count} ${d.entry.count === 1 ? 'book' : 'books'}`);

  /* ---- interaction ---- */

  const entryOf = (d) => (d.entry ? d.entry : d.code ? byCountry.get(d.code) : null);

  function bindHandlers(selection) {
    selection
      .on('pointerenter', (event, d) => {
        const entry = entryOf(d);
        if (entry) tooltip.show(describe(entry), event);
      })
      .on('pointermove', (event, d) => {
        const entry = entryOf(d);
        if (entry) tooltip.move(event);
      })
      .on('pointerleave', () => tooltip.hide())
      .on('focus', (event, d) => {
        const entry = entryOf(d);
        if (entry) tooltip.showAt(describe(entry), event.currentTarget);
      })
      .on('blur', () => tooltip.hide())
      .on('click', (event, d) => {
        const entry = entryOf(d);
        if (entry) onSelect(entry.code);
      })
      .on('keydown', (event, d) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        const entry = entryOf(d);
        if (entry) onSelect(entry.code);
      });
  }

  bindHandlers(shapes.filter((f) => f.code && byCountry.has(f.code)));
  bindHandlers(dots);

  /* ---- zoom ----
     One finger scrolls the page and two fingers pan the map, so the map never
     traps a phone scroll; the wheel zooms only with a modifier held, for the
     same reason. The buttons work everywhere. */
  let scale = 1;

  const zoom = d3
    .zoom()
    .scaleExtent([1, 12])
    .filter((event) => {
      if (event.type === 'wheel') return event.ctrlKey || event.metaKey;
      // At the default view a single finger belongs to the page, not the map;
      // once zoomed in there is somewhere to pan to, so the map takes it.
      if (event.type === 'touchstart') return event.touches.length > 1 || scale > 1;
      return !event.button;
    })
    .on('zoom', (event) => {
      scale = event.transform.k;
      root.attr('transform', event.transform);
      dots.attr('r', 5 / scale);
      svgEl.classList.toggle('is-zoomed', scale > 1);
    });

  svg.call(zoom).on('dblclick.zoom', null);

  // A transition is driven by requestAnimationFrame, which a hidden tab never
  // fires — so fall back to jumping straight there rather than doing nothing.
  const ease = (selection) =>
    prefersReducedMotion() || document.hidden
      ? selection
      : selection.transition().duration(250);

  return {
    /** Outline the selected country (or clear it when code is null). */
    highlight(code) {
      shapes.classed('is-selected', (f) => Boolean(code) && f.code === code);
      dots.classed('is-selected', (d) => d.entry.code === code);
    },
    zoomIn() { ease(svg).call(zoom.scaleBy, 1.6); },
    zoomOut() { ease(svg).call(zoom.scaleBy, 1 / 1.6); },
    reset() { ease(svg).call(zoom.transform, d3.zoomIdentity); },
    /** Codes we have books for but could only draw as a point. */
    pointOnlyCodes: points.map((p) => p.entry.code),
  };
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
