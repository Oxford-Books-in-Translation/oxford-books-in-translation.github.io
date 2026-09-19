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

/**
 * Overseas pieces drawn as part of the administering country, which on a
 * choropleth only ever read as a mistake: shading France puts a green blob in
 * South America, and nobody looking at it thinks "ah, French Guiana".
 *
 * This is a named list on purpose. The tempting version — "drop any piece far
 * from the country's centre" — would also throw away Hawaii and Alaska from
 * the United States, Kaliningrad from Russia, Tasmania from Australia,
 * Svalbard from Norway and Newfoundland from Canada, all of which belong.
 * Bounds are [west, south, east, north].
 */
const DETACHED = [
  { code: 'FRA', name: 'French Guiana', bounds: [-56, 1, -51, 7] },
];

/** Drops the detached pieces above from a country's geometry. */
function trimDetached(feature) {
  const rules = DETACHED.filter((d) => d.code === feature.code);
  if (!rules.length || feature.geometry.type !== 'MultiPolygon') return;

  const inside = ([lon, lat], [w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n;
  const centre = (ring) => {
    let x = 0, y = 0;
    for (const [lon, lat] of ring) { x += lon; y += lat; }
    return [x / ring.length, y / ring.length];
  };

  const kept = feature.geometry.coordinates.filter(
    (polygon) => !rules.some((rule) => inside(centre(polygon[0]), rule.bounds)),
  );
  // Never let a rule empty a country out entirely.
  if (kept.length) feature.geometry.coordinates = kept;
}

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
    trimDetached(feature);
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

  /* ---- forgiving taps ----
     At phone width the whole world is about 340px across, so most countries
     are a few pixels wide — the Netherlands is 5px and Korea 3px, against a
     finger pad of forty-odd. An accurate tap is not something a hand can do
     at that size, and a tap that misses by 4px doing nothing reads as the map
     being broken rather than as a near miss.

     So on a touch screen, a tap that lands near a country we've read selects
     it. The search samples rings of real points outward from the tap and asks
     the browser what is under each one, which is exact: it can't be fooled
     the way a bounding box can, where a tap in the Atlantic falls "inside"
     Russia because Russia's box spans the map. A tap with nothing within
     32px still does nothing, so the ocean stays empty. */
  const SLOP = 32; // how far from the finger we will look, in CSS pixels
  const STEP = 2; // spacing between samples, radially and around each ring

  /** Is this point within SLOP of the element's bounding box? */
  function nearBox(rect, x, y) {
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    return dx * dx + dy * dy <= SLOP * SLOP;
  }

  svgEl.addEventListener('click', (event) => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    // A direct hit has already been dealt with by the country's own handler.
    if (event.target.closest('.has-books, .dot')) return;

    // A tap with nothing anywhere near it — most of the ocean — would
    // otherwise search every ring before giving up, which is the slowest path
    // and by far the most common one. Bounding boxes reject that in
    // microseconds. A box is always a superset of its shape, so this can
    // never rule out a country that a probe would have found; it is only ever
    // used to decide whether probing is worth doing at all.
    const candidates = [...svgEl.querySelectorAll('.has-books, .dot')];
    if (!candidates.some((n) => nearBox(n.getBoundingClientRect(), event.clientX, event.clientY))) return;

    // Rings outward from the tap, nearest first, so the answer is the closest
    // country rather than merely a close one. The sampling has to be finer
    // than the countries are small: Ukraine is six pixels tall here, and a
    // ring spaced any wider steps clean over it and finds Algeria across the
    // Mediterranean instead.
    for (let radius = STEP; radius <= SLOP; radius += STEP) {
      const samples = Math.max(8, Math.round((2 * Math.PI * radius) / STEP));
      for (let i = 0; i < samples; i++) {
        const angle = (i / samples) * Math.PI * 2;
        const x = event.clientX + Math.cos(angle) * radius;
        const y = event.clientY + Math.sin(angle) * radius;
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;

        const node = document.elementFromPoint(x, y);
        const hit = node && node.closest && node.closest('.has-books, .dot');
        if (!hit || !svgEl.contains(hit)) continue;

        const entry = entryOf(d3.select(hit).datum());
        if (entry) {
          onSelect(entry.code);
          return;
        }
      }
    }
  });

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
    /** Momentarily pick out a country — used when pointing at it in the list. */
    spotlight(code) {
      shapes.classed('is-spotlit', (f) => Boolean(code) && f.code === code);
      dots.classed('is-spotlit', (d) => Boolean(code) && d.entry.code === code);
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
