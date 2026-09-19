/**
 * Page wiring: theme, headline stats, the map, the languages panel and the
 * filterable book table.
 *
 * One piece of state drives everything below the map — the selected country,
 * the selected language and the search text — so the map, the country panel
 * and the table can never disagree with each other.
 */

import { loadData, countryNames, formatDate } from './data.js';
import { createMap, binClass, BIN_LABELS } from './map.js';

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
      $('books').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
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

function countryCell(book) {
  const node = el('td', { 'data-label': 'Country' });
  const parts = [];

  book.nationalities.forEach((code) => {
    const button = el('button', {
      type: 'button',
      class: 'country-link',
      text: data.countries[code].name,
    });
    button.addEventListener('click', () => selectCountry(code, { scroll: true }));
    parts.push(button);
  });
  book.badCodes.forEach((code) => {
    parts.push(el('span', { class: 'code-bad', title: 'Not a valid ISO 3166-1 alpha-3 code', text: code }));
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
  return node;
}

function renderTable() {
  const books = visibleBooks();
  const body = $('book-tbody');
  body.replaceChildren();

  for (const book of books) {
    const title = el('td', { 'data-label': 'Title', class: 'cell-title' }, [
      el('span', { class: 'book-title', text: book.title }),
    ]);
    if (book.originalTitle && book.originalTitle !== book.title) {
      title.append(el('span', { class: 'book-original', text: book.originalTitle }));
    }
    if (book.notes) {
      title.append(el('span', { class: 'book-notes', text: book.notes }));
    }

    body.append(el('tr', {}, [
      title,
      cell('Author', book.author),
      countryCell(book),
      cell('Language', book.language),
      cell('Translator', book.translator),
      cell('Published', book.year, 'num'),
      cell('Discussed', formatDate(book)),
    ]));
  }

  $('book-table').hidden = books.length === 0;
  $('empty-note').hidden = books.length > 0;

  const filtersOn = state.country || state.language || state.search;
  $('result-count').textContent = filtersOn
    ? `Showing ${books.length} of ${plural(data.books.length, 'book')}${describeFilters()}.`
    : `All ${plural(data.books.length, 'book')}.`;
}

function describeFilters() {
  const bits = [];
  if (state.country) bits.push(data.countries[state.country].name);
  if (state.language) bits.push(`in ${state.language}`);
  if (state.search) bits.push(`matching “${state.search}”`);
  return bits.length ? ` — ${bits.join(', ')}` : '';
}

/* ------------------------------------------------------------------ state */

function setState(patch, options = {}) {
  Object.assign(state, patch);

  $('filter-country').value = state.country;
  $('filter-language').value = state.language;
  if ($('filter-search').value !== state.search) $('filter-search').value = state.search;
  $('filter-sort').value = state.sort;

  for (const button of document.querySelectorAll('.language-row')) {
    const name = button.querySelector('.language-name').textContent;
    button.setAttribute('aria-pressed', String(name === state.language));
  }

  map.highlight(state.country);
  renderCountryPanel();
  renderTable();
  syncHash();

  if (options.scroll && state.country) {
    $('country-panel').scrollIntoView({
      behavior: reducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  }
}

function selectCountry(code, options = {}) {
  // Tapping the selected country again clears it, which is what a map invites.
  setState({ country: state.country === code ? '' : code }, options);
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
  $('country-clear').addEventListener('click', () => setState({ country: '' }));
}

function setMapHint() {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  $('map-hint').textContent = coarse
    ? 'Tap a country for its books. Pinch with two fingers to zoom.'
    : 'Click a country for its books. Ctrl + scroll to zoom, drag to pan.';
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
    onSelect: (code) => selectCountry(code, { scroll: true }),
    tooltip,
  });

  renderStats();
  renderLegend();
  renderLanguages();
  buildFilters();
  renderWarnings(data.warnings);

  setState(readHash());

  $('zoom-in').addEventListener('click', () => map.zoomIn());
  $('zoom-out').addEventListener('click', () => map.zoomOut());
  $('zoom-reset').addEventListener('click', () => map.reset());

  // Following a shared link while the page is already open changes only the
  // hash, which the browser treats as same-document — so apply it by hand.
  window.addEventListener('hashchange', () => setState(readHash()));

  window.addEventListener('scroll', () => tooltip.hide(), { passive: true });
}

init();
