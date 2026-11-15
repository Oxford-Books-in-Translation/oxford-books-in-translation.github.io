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

  /** The name we show for a shape, ours where we have it. */
  const nameOf = (f) =>
    (f.code && countries[f.code] && countries[f.code].name) || f.properties.name || 'Unnamed';

  const countText = (n) => `${n} ${n === 1 ? 'book' : 'books'}`;

  /**
   * What to say about whatever is under the pointer. Every country answers,
   * including the ones we haven't read — "what is that grey one?" is a fair
   * question to ask a map, and leaving it unanswered made the shading look
   * like the only thing on it.
   */
  function describe(d) {
    const entry = entryOf(d);
    const name = escapeHtml(entry ? entry.name : nameOf(d));
    return entry
      ? `<b>${name}</b><br>${countText(entry.count)}`
      : `<b>${name}</b><br>Not read yet`;
  }

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
    // Only the countries with books are in the tab order. Putting all 176 in
    // it would bury the rest of the page, and the country index below the map
    // is the equivalent control for reaching one without a pointer.
    .attr('tabindex', (f) => (f.code && byCountry.has(f.code) ? 0 : null))
    .attr('role', (f) => (f.code && byCountry.has(f.code) ? 'button' : null))
    .attr('aria-label', (f) => {
      const entry = f.code ? byCountry.get(f.code) : null;
      return entry ? `${entry.name}, ${countText(entry.count)}` : nameOf(f);
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
    .attr('aria-label', (d) => `${d.entry.name}, ${countText(d.entry.count)}`);

  /* ---- the journey ----
     The group's reading drawn as a route: Oxford, then each book's country in
     the order we read them. Above the countries so nothing paints over it,
     below the emphasis so a picked-out country still outlines on top, and
     never a target — it describes the map, it isn't a control on it.

     Each hop is a gentle arc rather than a great circle. On this projection a
     great circle from Japan to Austria swings up over Siberia and reads as a
     detour; an arc reads as "and then we went to", which is the point. */
  const routeLayer = root.append('g')
    .attr('class', 'route')
    .attr('aria-hidden', 'true')
    .attr('display', 'none');
  let routeRun = 0;

  /** A curve from a to b that always bows upward, like a flight path. */
  function arc(p0, p2) {
    const [x1, y1] = p0;
    const [x2, y2] = p2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length < 0.5) return null; // the same country twice: no hop to draw
    let nx = -dy / length;
    let ny = dx / length;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const bend = Math.min(length * 0.2, 70);
    const p1 = [(x1 + x2) / 2 + nx * bend, (y1 + y2) / 2 + ny * bend];
    return { p0, p1, p2, length };
  }

  /**
   * The first part of a hop, from its start to fraction t of the way along.
   * The line is drawn by growing the curve itself rather than by animating a
   * dash: every line on this map keeps the same width at any zoom
   * (non-scaling-stroke), and that puts dash lengths in screen pixels while
   * the path's own length is in map units, so a dash reveal would finish
   * early or late depending on the size of the screen.
   */
  function arcPath({ p0, p1, p2 }, t = 1) {
    const lerp = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const q0 = lerp(p0, p1);
    const end = lerp(q0, lerp(p1, p2));
    return `M${p0}Q${q0} ${end}`;
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* ---- emphasis ----
     Picking out a country is drawn here, in its own layer above every shape,
     rather than by thickening that shape's own stroke.

     An SVG stroke straddles its path, half inside and half out. A country
     drawn low in the stack therefore loses the outer half of its outline
     wherever a neighbour drawn later sits against it — so the same 1.75px
     line came out full width along Sudan's Red Sea coast and half width on
     every inland border. Uneven, and not fixable by choosing a better width.

     Up here nothing paints over it, so the line is one weight the whole way
     round. It is drawn as a fine ink line over a paper casing, the way a
     printed map lifts a boundary off the sheet, which also keeps it legible
     against both a dark green fill and bare paper.

     The fill is deliberately left alone: on this map a darker shade means
     more books, so darkening the country you are pointing at would say
     something false about it. */
  const emphasis = root.append('g').attr('class', 'emphasis').attr('aria-hidden', 'true');
  const softLayer = emphasis.append('g').attr('class', 'emphasis-soft');
  const strongLayer = emphasis.append('g').attr('class', 'emphasis-strong');
  for (const layer of [softLayer, strongLayer]) {
    layer.append('path').attr('class', 'emphasis-casing');
    layer.append('path').attr('class', 'emphasis-line');
  }

  // The rendered shape already holds the geometry, so emphasis reuses its `d`
  // rather than re-projecting the country every time the pointer moves.
  const shapeByCode = new Map();
  shapes.each(function (f) {
    if (f.code) shapeByCode.set(f.code, this);
  });

  function paint(layer, code) {
    const node = code ? shapeByCode.get(code) : null;
    const d = node ? node.getAttribute('d') : null;
    layer.selectAll('path').attr('d', d);
    layer.attr('display', d ? null : 'none');
  }

  // What is picked out softly: whatever the pointer is on, or failing that
  // the country whose name is pinned to the map.
  let namedCode = null;
  let transientCode = null;
  let selectedCode = null;
  const paintSoft = () => paint(softLayer, transientCode || namedCode);

  // Start both layers empty and explicitly hidden, rather than relying on a
  // path with no `d` happening to draw nothing.
  paint(softLayer, null);
  paint(strongLayer, null);

  /* ---- interaction ---- */

  const entryOf = (d) => (d.entry ? d.entry : d.code ? byCountry.get(d.code) : null);

  /* ---- naming a country ----
     Separate from selecting one. Selecting means "filter the list to this
     country" and only countries with books can do it; naming just answers
     "what is that?", which every country can. The label is pinned over the
     map rather than floating by the cursor, so it survives a finger lifting
     off and reads as an answer about a place rather than a passing tooltip. */
  const frame = svgEl.closest('.map-frame');
  const labelEl = frame.querySelector('.map-label');

  function clearName() {
    labelEl.hidden = true;
    namedCode = null;
    dots.classed('is-named', false);
    paintSoft();
  }

  function nameCountry(node, d) {
    const entry = entryOf(d);
    const text = entry
      ? `${entry.name} · ${countText(entry.count)}`
      : `${nameOf(d)} · not read yet`;

    // A dot has no outline to trace, so it keeps a class of its own.
    namedCode = d.code || (entry && entry.code) || null;
    dots.classed('is-named', (dot) => dot.entry.code === namedCode);
    paintSoft();

    labelEl.textContent = text;
    labelEl.hidden = false;

    // Measured after it is shown and filled, or the width is stale and the
    // label sits off-centre.
    const frameBox = frame.getBoundingClientRect();
    const svgBox = svgEl.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    const own = labelEl.getBoundingClientRect();
    const pad = 4;

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
    const x = clamp(
      box.left + box.width / 2 - frameBox.left - own.width / 2,
      pad,
      Math.max(pad, frameBox.width - own.width - pad),
    );
    // Above the country where there is room, below it otherwise, and never
    // outside the map — the frame also holds the zoom buttons on a phone.
    const above = box.top - frameBox.top - own.height - 6;
    const below = box.bottom - frameBox.top + 6;
    const top = svgBox.top - frameBox.top + pad;
    const bottom = svgBox.bottom - frameBox.top - own.height - pad;
    const y = clamp(above >= top ? above : below, top, Math.max(top, bottom));

    labelEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function activate(node, d) {
    nameCountry(node, d);
    const entry = entryOf(d);
    // Only a country we've actually read has a list to filter to.
    if (entry) onSelect(entry.code);
  }

  // A finger fires pointerenter too, which would put a tooltip under the
  // fingertip saying exactly what the map label already says. Touch gets the
  // label; a pointer that can hover gets the tooltip. Tested per event rather
  // than per device, so a laptop with both a mouse and a touchscreen behaves
  // correctly for whichever one is being used.
  const hovering = (event) => event.pointerType !== 'touch';

  /** Pick out whatever the pointer or keyboard is currently on. */
  function touch(d) {
    transientCode = (d && (d.code || (d.entry && d.entry.code))) || null;
    dots.classed('is-spotlit', (dot) => dot.entry.code === transientCode);
    paintSoft();
  }
  const untouch = () => touch(null);

  function bindHandlers(selection) {
    selection
      .on('pointerenter', (event, d) => {
        touch(d);
        if (hovering(event)) tooltip.show(describe(d), event);
      })
      .on('pointermove', (event) => { if (hovering(event)) tooltip.move(event); })
      .on('pointerleave', () => { untouch(); tooltip.hide(); })
      .on('focus', (event, d) => { touch(d); tooltip.showAt(describe(d), event.currentTarget); })
      .on('blur', () => { untouch(); tooltip.hide(); })
      .on('click', (event, d) => activate(event.currentTarget, d))
      .on('keydown', (event, d) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate(event.currentTarget, d);
      });
  }

  // Every country, not just the ones we've read.
  bindHandlers(shapes);
  bindHandlers(dots);

  /* ---- forgiving taps ----
     At phone width the whole world is about 340px across, so most countries
     are a few pixels wide — the Netherlands is 5px and Korea 3px, against a
     finger pad of forty-odd. An accurate tap is not something a hand can do
     at that size, and a tap that misses by 4px doing nothing reads as the map
     being broken rather than as a near miss.

     Now that every country answers to a tap, a tap that lands on land is
     always answered by the country it hit — honestly, even if that is the
     neighbour of the one you were aiming for. This handler is for taps that
     land in the sea: it reaches up to 32px for a country we've read, so the
     coast of a small read country is forgiving rather than dead.

     The search samples rings of real points outward from the tap and asks the
     browser what is under each one, which is exact: it can't be fooled the
     way a bounding box can, where a tap in the Atlantic falls "inside" Russia
     because Russia's box spans the map. A tap with nothing within 32px
     dismisses the label, so tapping open sea clears the map. */
  const SLOP = 32; // how far from the finger we will look, in CSS pixels
  const STEP = 2; // spacing between samples, radially and around each ring

  /** Is this point within SLOP of the element's bounding box? */
  function nearBox(rect, x, y) {
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    return dx * dx + dy * dy <= SLOP * SLOP;
  }

  svgEl.addEventListener('click', (event) => {
    // A direct hit on any country has already been dealt with by its own
    // handler, so what is left is the sea.
    if (event.target.closest('.country, .dot')) return;
    if (!window.matchMedia('(pointer: coarse)').matches) {
      clearName(); // a mouse click on open sea puts the map back
      return;
    }

    // A tap with nothing anywhere near it — most of the ocean — would
    // otherwise search every ring before giving up, which is the slowest path
    // and by far the most common one. Bounding boxes reject that in
    // microseconds. A box is always a superset of its shape, so this can
    // never rule out a country that a probe would have found; it is only ever
    // used to decide whether probing is worth doing at all.
    const candidates = [...svgEl.querySelectorAll('.has-books, .dot')];
    if (!candidates.some((n) => nearBox(n.getBoundingClientRect(), event.clientX, event.clientY))) {
      clearName();
      return;
    }

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
          activate(hit, d3.select(hit).datum());
          return;
        }
      }
    }
    clearName();
  });

  /* ---- zoom ----
     Not on a phone, where the map is a picture and takes no input at all (see
     `#map` in the phone section of styles.css). Every attempt to make a
     375px-wide world map into a control failed: countries too small to hit,
     gestures that fought the page's own scrolling, zoom that confused more
     than it helped. The list of countries under it does the job properly, and
     the map reflects what you pick there. The filter below is a second lock,
     in case pointer events ever reach it.

     Above that, the wheel zooms only with a modifier held so the page still
     scrolls, and the buttons work. */
  const phone = window.matchMedia('(max-width: 719px)');
  let scale = 1;

  const zoom = d3
    .zoom()
    .scaleExtent([1, 12])
    .filter((event) => {
      if (phone.matches) return false;
      if (event.type === 'wheel') return event.ctrlKey || event.metaKey;
      // Always two fingers, zoomed or not. One finger is the page's, and
      // sharing it with the map meant a drag scrolled and panned at once.
      if (event.type === 'touchstart') return event.touches.length > 1;
      return !event.button;
    })
    .on('zoom', (event) => {
      scale = event.transform.k;
      root.attr('transform', event.transform);
      dots.attr('r', 5 / scale);
      routeLayer.selectAll('circle').attr('r', (d) => d.r / scale);
      svgEl.classList.toggle('is-zoomed', scale > 1);
      // The label is placed in screen coordinates, so panning would leave it
      // pointing at open sea. Take it away rather than let it lie.
      clearName();
    });

  svg.call(zoom).on('dblclick.zoom', null);

  // Turning a tablet to portrait can cross into phone width while zoomed in,
  // which would strand the map with no controls left to get back. Put it
  // back to the whole world instead.
  phone.addEventListener('change', (event) => {
    if (event.matches && scale !== 1) svg.call(zoom.transform, d3.zoomIdentity);
  });

  // A transition is driven by requestAnimationFrame, which a hidden tab never
  // fires — so fall back to jumping straight there rather than doing nothing.
  const ease = (selection) =>
    prefersReducedMotion() || document.hidden
      ? selection
      : selection.transition().duration(250);

  return {
    /**
     * Outline the selected country (or clear it when code is null), and pin
     * its name to the map.
     *
     * The label matters most on a phone, where the map can't be tapped and a
     * country is chosen from the list below instead: outlining a six-pixel
     * Hungary and saying nothing would leave you hunting for what changed.
     * Named here, the map answers wherever the choice was made.
     */
    highlight(code) {
      const previous = selectedCode;
      selectedCode = code || null;
      paint(strongLayer, selectedCode);
      dots.classed('is-selected', (d) => d.entry.code === code);

      // Called on every filter change, so act only when the country itself
      // changed — otherwise typing in the search box would keep dragging the
      // label back from whatever you had pointed at on the map.
      if (selectedCode === previous) return;
      if (selectedCode) {
        const node = shapeByCode.get(selectedCode)
          || dots.filter((d) => d.entry.code === selectedCode).node();
        if (node) nameCountry(node, d3.select(node).datum());
      } else if (namedCode === previous) {
        clearName();
      }
    },
    /** Momentarily pick out a country — used when pointing at it in the list. */
    spotlight(code) {
      touch(code ? { code } : null);
    },
    /**
     * Zoom in on the country you are actually interested in, not the middle
     * of the Sahara. Pressing + after tapping a country is how you get a
     * three-pixel country big enough to tap accurately — zooming about the
     * centre of the map would just push it off the edge.
     */
    zoomIn() {
      const code = namedCode || selectedCode;
      const node = code ? shapeByCode.get(code) : null;
      if (!node) {
        ease(svg).call(zoom.scaleBy, 1.6);
        return;
      }
      const box = node.getBBox();
      ease(svg).call(zoom.scaleBy, 1.6, [box.x + box.width / 2, box.y + box.height / 2]);
    },
    zoomOut() { ease(svg).call(zoom.scaleBy, 1 / 1.6); },
    reset() { ease(svg).call(zoom.transform, d3.zoomIdentity); },
    /**
     * Draw the route through `stops` (each { lonLat }), the first being home.
     * `next`, if given, is where the next book takes us: a dashed leg, since
     * we haven't been yet. Animated hop by hop unless `animate` is false or
     * motion is unwelcome; `onStep(i, done)` is called as each stop is
     * reached, so the page can say where we are. Resolves true when the route
     * is complete, false if it was hidden or restarted part-way.
     */
    async showRoute({ stops, next = null, animate = true, onStep = () => {} }) {
      const run = ++routeRun;
      routeLayer.selectAll('*').interrupt().remove();
      routeLayer.attr('display', null);
      if (!stops.length) return true;

      const at = (stop) => projection(stop.lonLat);
      const legs = routeLayer.append('g');
      const marks = routeLayer.append('g');

      const addLeg = (hop, className) => {
        if (!hop) return null;
        const g = legs.append('g').attr('class', className);
        g.append('path').attr('class', 'route-casing').attr('d', arcPath(hop));
        g.append('path').attr('class', 'route-line').attr('d', arcPath(hop));
        return { g, hop };
      };
      const addStop = (stop, className, r) => marks.append('circle')
        .datum({ r })
        .attr('class', className)
        .attr('cx', at(stop)[0])
        .attr('cy', at(stop)[1])
        .attr('r', r / scale);

      const hops = stops.slice(1).map((stop, i) => addLeg(arc(at(stops[i]), at(stop)), 'route-leg'));
      const last = stops[stops.length - 1];
      const nextLeg = next ? addLeg(arc(at(last), at(next)), 'route-leg is-next') : null;
      const nextStop = next ? addStop(next, 'route-stop is-next', 4) : null;
      const stopNodes = stops.map((stop, i) =>
        addStop(stop, i === 0 ? 'route-stop is-home' : 'route-stop', i === 0 ? 5.5 : 4));
      // Home on top, so the start is never hidden under a later stop.
      stopNodes[0].raise();

      // Frame the route. So far it all happens between Spain and Japan, a
      // third of the map's width, and at world scale the European hops are a
      // tangle of lines a few pixels long — on a phone, barely visible at all.
      // The box takes in the top of each arc, not just its ends, so no curve
      // leaves the frame.
      const xs = [];
      const ys = [];
      for (const leg of [...hops, nextLeg]) {
        if (!leg) continue;
        const { p0, p1, p2 } = leg.hop;
        for (const [x, y] of [p0, p2, [(p0[0] + 2 * p1[0] + p2[0]) / 4, (p0[1] + 2 * p1[1] + p2[1]) / 4]]) {
          xs.push(x);
          ys.push(y);
        }
      }
      const pad = 24;
      const [left, right] = d3.extent(xs);
      const [top, bottom] = d3.extent(ys);
      const k = Math.max(1, Math.min(4,
        width / (right - left + 2 * pad),
        height / (bottom - top + 2 * pad)));
      const framed = d3.zoomIdentity
        .translate(width / 2 - (k * (left + right)) / 2, height / 2 - (k * (top + bottom)) / 2)
        .scale(k);

      if (!animate || prefersReducedMotion() || document.hidden) {
        svg.interrupt().call(zoom.transform, framed);
        onStep(stops.length - 1, true);
        return true;
      }

      // Everything starts hidden and appears in order.
      for (const leg of [...hops, nextLeg]) if (leg) leg.g.attr('opacity', 0);
      for (const node of [...stopNodes.slice(1), nextStop]) if (node) node.attr('opacity', 0);

      const grow = async (leg) => {
        leg.g.attr('opacity', null);
        const duration = Math.max(350, Math.min(900, 250 + leg.hop.length * 1.4));
        try {
          await leg.g.selectAll('path')
            .transition()
            .duration(duration)
            .ease(d3.easeCubicInOut)
            .attrTween('d', () => (t) => arcPath(leg.hop, t))
            .end();
        } catch {
          return false; // interrupted: hidden or restarted
        }
        return run === routeRun;
      };

      onStep(0, false);
      try {
        await svg.interrupt().transition().duration(700).ease(d3.easeCubicInOut)
          .call(zoom.transform, framed).end();
      } catch {
        // Interrupted: either the route was hidden (caught just below) or
        // someone zoomed the map themselves, in which case their view wins and
        // the route carries on drawing in it.
      }
      if (run !== routeRun) return false;
      await wait(200);
      for (let i = 1; i < stops.length; i++) {
        if (run !== routeRun) return false;
        if (hops[i - 1] && !(await grow(hops[i - 1]))) return false;
        if (run !== routeRun) return false;
        stopNodes[i].attr('opacity', null);
        onStep(i, false);
        await wait(300);
      }
      if (nextLeg && !(await grow(nextLeg))) return false;
      if (run !== routeRun) return false;
      if (nextStop) nextStop.attr('opacity', null);
      onStep(stops.length - 1, true);
      return true;
    },
    hideRoute() {
      routeRun++;
      routeLayer.selectAll('*').interrupt().remove();
      routeLayer.attr('display', 'none');
      // Back out to the whole world, which the route had zoomed in from.
      if (scale !== 1) ease(svg.interrupt()).call(zoom.transform, d3.zoomIdentity);
    },
    /** Codes we have books for but could only draw as a point. */
    pointOnlyCodes: points.map((p) => p.entry.code),
  };
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
