/**
 * Page wiring: theme, headline stats, the map, the languages panel and the
 * filterable book table.
 *
 * One piece of state drives everything below the map — the selected country,
 * the selected language and the search text — so the map, the country panel
 * and the table can never disagree with each other.
 */

import { loadData, countryNames, formatDate, languageTag, isRightToLeft } from './data.js';
import { createMap, binClass, BIN_LABELS, REGION_VIEWS } from './map.js';

const $ = (id) => document.getElementById(id);

const state = { country: '', language: '', search: '', sort: 'date-desc' };
let data = null;
let map = null;

/* ------------------------------------------------------------------ utils */

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (value != null) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Smooth scrolling is driven by requestAnimationFrame, which a hidden tab
 * never fires — so the page would simply not move. Jump straight there
 * instead, the same fallback the map's zoom transitions use.
 */
function scrollPageTo(element, block = 'start') {
  element.scrollIntoView({
    behavior: reducedMotion() || document.hidden ? 'auto' : 'smooth',
    block,
  });
}

/* ------------------------------------------------------------------ theme */

const THEME_KEY = 'obit-theme';

function readStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null; // private mode, blocked storage — fall back to the OS setting
  }
}

function systemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const effective = theme || systemTheme();
  const label = effective === 'dark' ? 'Light mode' : 'Dark mode';
  $('theme-toggle-label').textContent = label;
  $('theme-toggle').setAttribute('aria-label', `Switch to ${label.toLowerCase()}`);
}

function initTheme() {
  applyTheme(readStoredTheme());
  $('theme-toggle').addEventListener('click', () => {
    const next = (readStoredTheme() || systemTheme()) === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* not persisting is survivable; the toggle still works for this visit */
    }
    applyTheme(next);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!readStoredTheme()) applyTheme(null);
  });
}

/* ---------------------------------------------------------------- tooltip */

const tooltipEl = $('tooltip');

const tooltip = {
  show(html, event) {
    tooltipEl.innerHTML = html;
    tooltipEl.hidden = false;
    this.move(event);
  },
  move(event) {
    const box = tooltipEl.getBoundingClientRect();
    const pad = 12;
    let x = event.clientX + pad;
    let y = event.clientY - box.height - pad;
    if (x + box.width > window.innerWidth - pad) x = event.clientX - box.width - pad;
    if (y < pad) y = event.clientY + pad;
    tooltipEl.style.transform = `translate(${Math.max(pad, x)}px, ${y}px)`;
  },
  showAt(html, target) {
    tooltipEl.innerHTML = html;
    tooltipEl.hidden = false;
    const rect = target.getBoundingClientRect();
    const box = tooltipEl.getBoundingClientRect();
    const x = Math.min(
      Math.max(12, rect.left + rect.width / 2 - box.width / 2),
      window.innerWidth - box.width - 12,
    );
    const y = rect.top - box.height - 10;
    tooltipEl.style.transform = `translate(${x}px, ${y < 12 ? rect.bottom + 10 : y}px)`;
  },
  hide() {
    tooltipEl.hidden = true;
  },
};

/* ------------------------------------------------------------------ stats */

function renderStats() {
  $('stat-books').textContent = data.books.length;
  $('stat-countries').textContent = data.byCountry.size;
  $('stat-languages').textContent = data.byLanguage.size;
  $('stat-translators').textContent = data.byTranslator.size;

  const pointOnly = map.pointOnlyCodes.length;
  $('stat-countries-note').textContent = pointOnly
    ? `${pointOnly} too small to shade — shown as dots`
    : '';

  const dated = data.books.filter((b) => b.dateValue != null);
  if (dated.length) {
    const latest = dated.reduce((a, b) => (b.dateValue > a.dateValue ? b : a));
    const countryCount = data.byCountry.size;
    $('footer-count').textContent =
      `${plural(data.books.length, 'book')} from ${countryCount} ` +
      `${countryCount === 1 ? 'country' : 'countries'}, most recently ${latest.title} ` +
      `on ${formatDate(latest)}. `;
  }
}

/* ----------------------------------------------------------------- legend */

/* ---------------------------------------------------------- map regions */

/**
 * Buttons that frame a continent. This is how you get close enough to read
 * individual countries on a phone, where the whole world is 375px wide and
 * gestures are not available — and it changes only what the map shows, never
 * which books are listed. Region is a place to look, not a filter; mixing it
 * into the filters below would make "Europe" mean two different things on one
 * page.
 */
let mapRegion = 'world';

function renderRegions() {
  const group = $('map-regions');
  group.replaceChildren();

  for (const view of REGION_VIEWS) {
    const button = el('button', {
      type: 'button',
      class: 'region-btn',
      'data-region': view.key,
      'aria-pressed': String(mapRegion === view.key),
      text: view.label,
    });

    button.addEventListener('click', () => {
      // Pressing the region you are already in returns to the whole world,
      // so the control can always undo itself without hunting for "Whole
      // world" at the far end of the row.
      mapRegion = mapRegion === view.key ? 'world' : view.key;
      map.showRegion(mapRegion);
      syncRegionButtons();
    });

    group.append(button);
  }
}

function syncRegionButtons() {
  for (const button of document.querySelectorAll('.region-btn')) {
    button.setAttribute('aria-pressed', String(button.dataset.region === mapRegion));
  }
}

function renderLegend() {
  const legend = $('legend');
  legend.replaceChildren();
  legend.setAttribute('role', 'group');
  legend.setAttribute('aria-label', 'Map key: number of books per country');

  const scale = el('div', { class: 'legend-scale' });
  for (let i = 0; i < BIN_LABELS.length; i++) {
    scale.append(el('div', { class: 'legend-step' }, [
      el('span', {
        class: `legend-swatch ${binClass(i + 1)}`,
        style: `background: var(--${binClass(i + 1)})`,
      }),
      el('span', { text: BIN_LABELS[i] }),
    ]));
  }

  legend.append(
    el('span', { text: 'Books' }),
    scale,
    el('span', { class: 'legend-sep' }),
    el('span', { class: 'legend-pair' }, [
      el('span', { class: 'legend-swatch', style: 'background: var(--q0)' }),
      el('span', { text: 'Not yet read' }),
    ]),
  );
}

/* ------------------------------------------------------- coverage note */

// Antarctica has no nationality to read, so it is not a gap.
const READABLE_REGIONS = ['Europe', 'Asia', 'Africa', 'Americas', 'Oceania'];
const REGION_LABEL = { Americas: 'the Americas' };
const label = (region) => REGION_LABEL[region] || region;

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'eleven', 'twelve'];
const spell = (n) => (n < WORDS.length ? WORDS[n] : String(n));

const listFormat = (type) => new Intl.ListFormat('en-GB', { style: 'long', type });

/**
 * A sentence naming what the map covers and, more to the point, what it
 * doesn't. The empty continents are the reading prompt.
 */
function renderCoverageNote() {
  const counts = new Map();
  for (const entry of data.byCountry.values()) {
    const region = entry.meta.region;
    if (!READABLE_REGIONS.includes(region)) continue;
    counts.set(region, (counts.get(region) || 0) + 1);
  }

  const covered = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const missing = READABLE_REGIONS.filter((region) => !counts.has(region));

  const parts = [];
  if (covered.length) {
    const phrases = covered.map(([region, n], i) =>
      i === 0
        ? `${spell(n)} ${n === 1 ? 'country' : 'countries'} in ${label(region)}`
        : `${spell(n)} in ${label(region)}`);
    parts.push(`${listFormat('conjunction').format(phrases)}.`);
  }
  parts.push(missing.length
    ? `Nothing yet from ${listFormat('disjunction').format(missing.map(label))}.`
    : 'Every part of the world is on the map.');

  const note = $('coverage-note');
  note.textContent = parts.join(' ');
  // Capitalise the opening of the sentence without fighting the data.
  note.textContent = note.textContent.charAt(0).toUpperCase() + note.textContent.slice(1);
}

/* --------------------------------------------------------- country index */

/**
 * The countries, in full, beneath the map. Most-read first, then alphabetical.
 * Each row carries the country's own shade from the map, which is what ties
 * the list to the picture.
 */
function renderCountryIndex() {
  const list = $('country-index');
  list.replaceChildren();

  const entries = [...data.byCountry.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  for (const entry of entries) {
    const button = el('button', {
      type: 'button',
      class: 'index-row has-swatch',
      'data-code': entry.code,
      'aria-pressed': String(state.country === entry.code),
    }, [
      el('span', { class: `country-swatch ${binClass(entry.count)}`, 'aria-hidden': 'true' }),
      el('span', { class: 'index-name', text: entry.name }),
      el('span', { class: 'index-count', text: String(entry.count) }),
    ]);

    button.addEventListener('click', () => selectCountry(entry.code));
    // Pointing at a row picks the country out on the map, so the list and the
    // picture read as one thing.
    button.addEventListener('pointerenter', () => map.spotlight(entry.code));
    button.addEventListener('focus', () => map.spotlight(entry.code));
    button.addEventListener('pointerleave', () => map.spotlight(null));
    button.addEventListener('blur', () => map.spotlight(null));

    list.append(el('li', {}, [button]));
  }
}

/* ------------------------------------------------------ translator index */

/**
 * The translators, most-translated first. Selecting one searches for their
 * name, which reuses the existing search rather than inventing another filter.
 */
function renderTranslators() {
  const list = $('translator-index');
  list.replaceChildren();

  for (const entry of data.byTranslator.values()) {
    const button = el('button', {
      type: 'button',
      class: 'index-row',
      'data-translator': entry.name,
      'aria-pressed': String(state.search === entry.name),
    }, [
      el('span', { class: 'index-name', text: entry.name }),
      el('span', { class: 'index-count', text: String(entry.count) }),
    ]);

    button.addEventListener('click', () => {
      setState({ search: state.search === entry.name ? '' : entry.name });
      scrollPageTo($('books'));
    });

    list.append(el('li', {}, [button]));
  }
}

/* -------------------------------------------------------------- languages */

function renderLanguages() {
  const list = $('languages');
  list.replaceChildren();
  const max = Math.max(...[...data.byLanguage.values()].map((l) => l.count), 1);

  for (const entry of data.byLanguage.values()) {
    const bar = el('div', {
      class: 'language-bar',
      style: `width: ${Math.max((entry.count / max) * 100, 4)}%`,
    });
    const button = el('button', {
      type: 'button',
      class: 'language-row',
      'aria-pressed': String(state.language === entry.name),
    }, [
      el('span', { class: 'language-name', text: entry.name }),
      el('span', { class: 'language-track' }, [bar]),
      el('span', { class: 'language-count', text: String(entry.count) }),
    ]);
    button.addEventListener('click', () => {
      setState({ language: state.language === entry.name ? '' : entry.name });
      scrollPageTo($('books'));
    });
    list.append(el('li', {}, [button]));
  }

  $('languages-sub').textContent =
    `${plural(data.byLanguage.size, 'language')}, by number of books. Select one to filter the list.`;
}

/* ----------------------------------------------------------------- panels */

function renderCountryPanel() {
  const panel = $('country-panel');
  const entry = state.country ? data.byCountry.get(state.country) : null;

  if (!entry) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  $('country-panel-heading').textContent = entry.name;
  $('country-panel-sub').textContent =
    `${plural(entry.count, 'book')} by ${entry.count === 1 ? 'an author' : 'authors'} of this nationality.`;

  const list = $('country-books');
  list.replaceChildren();

  const sorted = [...entry.books].sort((a, b) => (b.dateValue ?? 0) - (a.dateValue ?? 0));
  for (const book of sorted) {
    const meta = [book.author, book.language, formatDate(book) && `discussed ${formatDate(book)}`]
      .filter(Boolean)
      .join(' · ');
    list.append(el('li', { class: 'book-card' }, [
      el('div', { class: 'book-card-title', text: book.title }),
      el('p', { class: 'book-card-meta', text: meta }),
    ]));
  }
}

/* ------------------------------------------------------------ book table */

const SORTS = {
  'date-desc': (a, b) => (b.dateValue ?? -Infinity) - (a.dateValue ?? -Infinity),
  'date-asc': (a, b) => (a.dateValue ?? Infinity) - (b.dateValue ?? Infinity),
  'title-asc': (a, b) => a.title.localeCompare(b.title),
  'author-asc': (a, b) => a.author.localeCompare(b.author),
  'country-asc': (a, b) =>
    (countryNames(a, data.countries)[0] || '').localeCompare(countryNames(b, data.countries)[0] || ''),
  'language-asc': (a, b) => a.language.localeCompare(b.language),
  'year-asc': (a, b) => (a.yearValue ?? Infinity) - (b.yearValue ?? Infinity),
  'year-desc': (a, b) => (b.yearValue ?? -Infinity) - (a.yearValue ?? -Infinity),
};

function visibleBooks() {
  const needle = state.search.toLowerCase();
  return data.books
    .filter((book) => {
      if (state.country && !book.nationalities.includes(state.country)) return false;
      if (state.language && book.language !== state.language) return false;
      if (!needle) return true;
      return [book.title, book.originalTitle, book.author, book.translator]
        .some((field) => field.toLowerCase().includes(needle));
    })
    .sort(SORTS[state.sort] || SORTS['date-desc']);
}

/** A table cell that labels itself when the table stacks on a narrow screen. */
function cell(label, value, extraClass = '') {
  const node = el('td', { 'data-label': label, class: extraClass });
  if (value == null || value === '') {
    node.classList.add('is-empty');
    node.textContent = '—';
  } else if (typeof value === 'string') {
    node.textContent = value;
  } else {
    node.append(value);
  }
  return node;
}

/** Country (clickable) and original language, as one "Origin" cell. */
function originCell(book) {
  const node = el('td', { 'data-label': 'Origin' });
  const parts = [];

  book.nationalities.forEach((code) => {
    const button = el('button', {
      type: 'button',
      class: 'country-link',
      text: data.countries[code].name,
    });
    button.addEventListener('click', () => selectCountry(code));
    parts.push(button);
  });
  book.badCodes.forEach((code) => {
    // Stated in words rather than by colour: the marker is neither red nor
    // underlined, so it can't be mistaken for a link.
    parts.push(el('span', { class: 'code-bad' }, [
      document.createTextNode(code),
      el('span', { class: 'code-bad-note', text: ' (invalid code)' }),
    ]));
  });

  if (!parts.length) {
    node.classList.add('is-empty');
    node.textContent = '—';
    return node;
  }

  parts.forEach((part, index) => {
    if (index) node.append(document.createTextNode(', '));
    node.append(part);
  });
  if (book.language) {
    node.append(el('span', { class: 'book-sub', text: book.language }));
  }
  return node;
}

function renderTable() {
  const books = visibleBooks();
  const body = $('book-tbody');
  body.replaceChildren();

  for (const book of books) {
    /* The book is the subject of the row: title in the display face, with its
       original title and year as a quiet line beneath. */
    const title = el('td', { 'data-label': 'Book', class: 'cell-title' }, [
      el('span', { class: 'book-title', text: book.title }),
    ]);

    const hasOriginal = book.originalTitle && book.originalTitle !== book.title;
    if (hasOriginal || book.year) {
      const meta = el('span', { class: 'book-meta' });
      if (hasOriginal) {
        // Mark the original title up in its own language so assistive tech
        // pronounces it correctly and right-to-left scripts lay out properly.
        const tag = languageTag(book.language);
        meta.append(el('span', {
          text: book.originalTitle,
          lang: tag,
          dir: tag && isRightToLeft(tag) ? 'rtl' : null,
        }));
      }
      if (hasOriginal && book.year) meta.append(document.createTextNode(' · '));
      if (book.year) meta.append(document.createTextNode(book.year));
      title.append(meta);
    }

    if (book.notes) {
      title.append(el('span', { class: 'book-notes', text: book.notes }));
    }

    const author = el('td', { 'data-label': 'Author' }, [
      document.createTextNode(book.author || '—'),
    ]);
    if (book.translator) {
      author.append(el('span', { class: 'book-sub', text: `tr. ${book.translator}` }));
    }

    body.append(el('tr', {}, [
      title,
      author,
      originCell(book),
      cell('Discussed', formatDate(book), 'cell-when'),
    ]));
  }

  $('book-table').hidden = books.length === 0;
  $('empty-note').hidden = books.length > 0;
  updateShowAll(books.length);

  const filtersOn = state.country || state.language || state.search;
  $('result-count').textContent = filtersOn
    ? `Showing ${books.length} of ${plural(data.books.length, 'book')}${describeFilters()}.`
    : `All ${plural(data.books.length, 'book')}.`;
}

/**
 * On a phone the whole list is a punishing scroll, so it starts capped at a
 * recent handful. The cap is applied in CSS and only exists at phone widths;
 * this keeps the button's label honest and resets it whenever the list changes
 * underneath, so you never get "show all" on a list that is already showing
 * everything.
 */
const MOBILE_ROW_CAP = 6;
let showingAllBooks = false;

function updateShowAll(visibleCount) {
  const button = $('show-all-books');
  const table = $('book-table');
  const cappable = visibleCount > MOBILE_ROW_CAP;

  // A list that no longer needs capping is never left half-expanded.
  if (!cappable) showingAllBooks = false;

  button.hidden = !cappable;
  table.classList.toggle('is-capped', cappable && !showingAllBooks);

  // The label is kept truthful even while the button is hidden. Leaving a
  // stale "Show all 10 books" on a hidden button meant that the moment
  // anything caused it to render anyway, it advertised a list length that no
  // longer existed and did nothing when pressed.
  button.textContent = showingAllBooks
    ? 'Show fewer'
    : `Show all ${plural(visibleCount, 'book')}`;
  button.setAttribute('aria-expanded', String(showingAllBooks));
}

function describeFilters() {
  const bits = [];
  if (state.country) bits.push(data.countries[state.country].name);
  if (state.language) bits.push(`in ${state.language}`);
  if (state.search) bits.push(`matching “${state.search}”`);
  return bits.length ? ` — ${bits.join(', ')}` : '';
}

/* ------------------------------------------------------------------ state */

function setState(patch) {
  Object.assign(state, patch);

  $('filter-country').value = state.country;
  $('filter-language').value = state.language;
  if ($('filter-search').value !== state.search) $('filter-search').value = state.search;
  $('filter-sort').value = state.sort;

  for (const button of document.querySelectorAll('.language-row')) {
    const name = button.querySelector('.language-name').textContent;
    button.setAttribute('aria-pressed', String(name === state.language));
  }

  for (const button of document.querySelectorAll('.index-row[data-code]')) {
    button.setAttribute('aria-pressed', String(button.dataset.code === state.country));
  }

  for (const button of document.querySelectorAll('.index-row[data-translator]')) {
    button.setAttribute('aria-pressed', String(button.dataset.translator === state.search));
  }

  map.highlight(state.country);
  renderCountryPanel();
  // A new filter means a new list, so collapse it again rather than leaving
  // "Show fewer" hanging over a list that is now three rows long.
  showingAllBooks = false;
  renderTable();
  syncHash();

}

/**
 * Put the map and the answer on screen together, but only when they aren't
 * already. The panel sits under the map, and on a phone the map plus its
 * legend is most of a screen — so a tap made near the top of the page can
 * open a panel that is entirely below the fold, which looks exactly like
 * nothing happening.
 *
 * Aligning the map rather than the panel is deliberate: scrolling the panel
 * itself into view would push the map off the top, which is the disorienting
 * jump this layout exists to avoid. Landing on the map keeps "I tapped there,
 * the answer appeared underneath" intact.
 */
function revealCountryPanel() {
  const panel = $('country-panel');
  if (panel.hidden) return;

  const box = panel.getBoundingClientRect();
  if (box.top >= 0 && box.bottom <= window.innerHeight) return;

  scrollPageTo(document.querySelector('.map-figure'));
}

function selectCountry(code) {
  // Tapping the selected country again clears it, which is what a map invites.
  setState({ country: state.country === code ? '' : code });
  revealCountryPanel();
}

/* --------------------------------------------------- shareable URL state */

function syncHash() {
  const params = new URLSearchParams();
  if (state.country) params.set('country', state.country);
  if (state.language) params.set('language', state.language);
  const hash = params.toString();
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
}

function readHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const country = (params.get('country') || '').toUpperCase();
  const language = params.get('language') || '';
  return {
    country: data.byCountry.has(country) ? country : '',
    language: data.byLanguage.has(language) ? language : '',
  };
}

/* --------------------------------------------------------------- warnings */

function renderWarnings(warnings) {
  if (!warnings.length) return;
  $('warning-slot').hidden = false;
  $('warning-title').textContent =
    `${plural(warnings.length, 'thing')} to check in data/books.csv`;
  const list = $('warning-list');
  list.replaceChildren();
  for (const warning of warnings.slice(0, 20)) {
    list.append(el('li', { text: warning }));
  }
  if (warnings.length > 20) {
    list.append(el('li', { text: `…and ${warnings.length - 20} more.` }));
  }
}

function showError(error) {
  $('error-slot').hidden = false;
  $('error-detail').textContent =
    `${error.message} — if you are opening index.html straight from disk, the browser ` +
    `blocks reading data/books.csv; serve the folder over http instead (for example: npx serve).`;
  console.error(error);
}

/* ------------------------------------------------------------------ setup */

function buildFilters() {
  const countrySelect = $('filter-country');
  const sorted = [...data.byCountry.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of sorted) {
    countrySelect.append(el('option', { value: entry.code, text: `${entry.name} (${entry.count})` }));
  }

  const languageSelect = $('filter-language');
  const languages = [...data.byLanguage.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of languages) {
    languageSelect.append(el('option', { value: entry.name, text: `${entry.name} (${entry.count})` }));
  }

  countrySelect.addEventListener('change', (e) => setState({ country: e.target.value }));
  languageSelect.addEventListener('change', (e) => setState({ language: e.target.value }));
  $('filter-sort').addEventListener('change', (e) => setState({ sort: e.target.value }));

  let debounce;
  $('filter-search').addEventListener('input', (e) => {
    const value = e.target.value;
    clearTimeout(debounce);
    debounce = setTimeout(() => setState({ search: value }), 120);
  });

  $('filter-clear').addEventListener('click', () => {
    setState({ country: '', language: '', search: '' });
  });

  $('show-all-books').addEventListener('click', () => {
    showingAllBooks = !showingAllBooks;
    const wasExpanded = showingAllBooks;
    updateShowAll(visibleBooks().length);
    // Collapsing from far down the list would otherwise strand you in the
    // footer, so return to the top of the list.
    if (!wasExpanded) {
      scrollPageTo($('books'));
    }
  });
  $('country-clear').addEventListener('click', () => setState({ country: '' }));
}

function setMapHint() {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  // Say that every country answers, not just the shaded ones — otherwise you
  // would have to already know it to find out. On a phone the shapes are too
  // small to hit reliably, so the list stays in the sentence.
  $('map-hint').textContent = coarse
    ? 'Choose a region to see it close up. Tap any country to name it; shaded ones open their books.'
    : 'Hover or click any country to name it; shaded ones open their books. Ctrl + scroll to zoom, drag to pan.';
}

async function init() {
  initTheme();
  setMapHint();

  try {
    data = await loadData();
  } catch (error) {
    showError(error);
    return;
  }

  map = createMap({
    svgEl: $('map'),
    topology: data.topology,
    countries: data.countries,
    byCountry: data.byCountry,
    onSelect: (code) => selectCountry(code),
    tooltip,
  });

  renderStats();
  renderRegions();
  renderLegend();
  renderCountryIndex();
  renderCoverageNote();
  renderTranslators();
  renderLanguages();
  buildFilters();
  renderWarnings(data.warnings);

  setState(readHash());

  $('zoom-in').addEventListener('click', () => map.zoomIn());
  $('zoom-out').addEventListener('click', () => map.zoomOut());
  $('zoom-reset').addEventListener('click', () => {
    map.reset();
    // Otherwise a region would stay lit while the map showed the whole world.
    mapRegion = 'world';
    syncRegionButtons();
  });

  // Following a shared link while the page is already open changes only the
  // hash, which the browser treats as same-document — so apply it by hand.
  window.addEventListener('hashchange', () => setState(readHash()));

  window.addEventListener('scroll', () => tooltip.hide(), { passive: true });
}

init();
