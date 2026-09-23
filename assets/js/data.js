/**
 * Loading and aggregating the book data.
 *
 * The CSV is the single source of truth, so it is read defensively: a typo in
 * one row should never blank the page. Parsing and the validation rules live in
 * csv.js and validate.js, shared with scripts/validate-books.mjs so the site
 * and the command-line check always agree.
 */

import { parseCsv } from './csv.js';
import { validateBooks, validateColumns } from './validate.js';

async function fetchText(url) {
  // no-store: the point of the CSV workflow is that an edit shows up on the
  // next load, so a stale cached copy would be the wrong kind of fast.
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url} — HTTP ${response.status} ${response.statusText}`);
  return response.text();
}

/**
 * Reads books.csv, countries.json and the boundary topology.
 * Returns everything the page needs, plus anything worth flagging.
 */
export async function loadData() {
  const [csvText, countriesText, topoText] = await Promise.all([
    fetchText('data/books.csv'),
    fetchText('data/countries.json'),
    fetchText('vendor/countries-110m.json'),
  ]);

  const countries = JSON.parse(countriesText.replace(/^﻿/, ''));
  const topology = JSON.parse(topoText);

  const { columns, records } = parseCsv(csvText);
  const columnCheck = validateColumns(columns);
  if (columnCheck.errors.length) throw new Error(columnCheck.errors.join(' '));

  const { books: allBooks, errors, warnings } = validateBooks(records, countries);

  // A row dated after today is a book we're going to read, not one we have.
  // It is listed as coming up but counted nowhere — not on the map, not in the
  // figures, not in the languages or translators — until its day arrives, when
  // it joins everything else with no edit needed. A book counts from the day
  // it is discussed. Rows whose date failed validation have no date and stay
  // with the books read, where the warning banner can point at them.
  const today = localIsoDate(new Date());
  const isUpcoming = (book) => Boolean(book.dateDiscussed) && book.dateDiscussed > today;
  const books = allBooks.filter((book) => !isUpcoming(book));
  const upcoming = allBooks
    .filter(isUpcoming)
    .sort((a, b) => a.dateDiscussed.localeCompare(b.dateDiscussed));

  return {
    books,
    upcoming,
    countries,
    topology,
    byCountry: groupByCountry(books, countries),
    byLanguage: groupByLanguage(books),
    byTranslator: groupByTranslator(books),
    // The site draws no distinction: both are things for a human to look at.
    // Column warnings are left out on purpose. An unrecognised column is
    // simply ignored, so it harms nothing, and the banner is seen by everyone
    // who visits, not just whoever maintains the CSV — it appeared for a few
    // minutes after the event_url column was added, whenever a browser still
    // held the old code. `npm run check` still reports it before a push.
    warnings: [...errors, ...warnings],
  };
}

/**
 * Today as YYYY-MM-DD in the viewer's own time zone. ISO dates compare
 * correctly as strings, and using local rather than UTC means a book night
 * counts as read from midnight on the day, not from 1am during British
 * Summer Time.
 */
export function localIsoDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function groupByCountry(books, countries) {
  const map = new Map();
  for (const book of books) {
    for (const code of book.nationalities) {
      if (!map.has(code)) {
        map.set(code, { code, name: countries[code].name, meta: countries[code], books: [] });
      }
      map.get(code).books.push(book);
    }
  }
  for (const entry of map.values()) entry.count = entry.books.length;
  return map;
}

function groupByLanguage(books) {
  const map = new Map();
  for (const book of books) {
    if (!book.language) continue;
    if (!map.has(book.language)) map.set(book.language, { name: book.language, books: [] });
    map.get(book.language).books.push(book);
  }
  for (const entry of map.values()) entry.count = entry.books.length;
  // Most-read first: the interesting end of the list.
  return new Map(
    [...map.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])),
  );
}

/**
 * Language names from the CSV mapped to BCP 47 tags, so an original title can
 * be marked up in its own language (WCAG 3.1.2) and a screen reader switches
 * pronunciation instead of reading Hungarian as English.
 */
const LANGUAGE_TAGS = {
  afrikaans: 'af', albanian: 'sq', amharic: 'am', arabic: 'ar', armenian: 'hy',
  azerbaijani: 'az', basque: 'eu', belarusian: 'be', bengali: 'bn', bosnian: 'bs',
  bulgarian: 'bg', burmese: 'my', catalan: 'ca', chinese: 'zh', croatian: 'hr',
  czech: 'cs', danish: 'da', dutch: 'nl', english: 'en', estonian: 'et',
  finnish: 'fi', french: 'fr', galician: 'gl', georgian: 'ka', german: 'de',
  greek: 'el', gujarati: 'gu', hebrew: 'he', hindi: 'hi', hungarian: 'hu',
  icelandic: 'is', indonesian: 'id', irish: 'ga', italian: 'it', japanese: 'ja',
  kannada: 'kn', kazakh: 'kk', khmer: 'km', korean: 'ko', kurdish: 'ku',
  lao: 'lo', latin: 'la', latvian: 'lv', lithuanian: 'lt', macedonian: 'mk',
  malay: 'ms', malayalam: 'ml', maltese: 'mt', marathi: 'mr', mongolian: 'mn',
  nepali: 'ne', norwegian: 'no', persian: 'fa', polish: 'pl', portuguese: 'pt',
  punjabi: 'pa', romanian: 'ro', russian: 'ru', serbian: 'sr', sinhala: 'si',
  slovak: 'sk', slovenian: 'sl', somali: 'so', spanish: 'es', swahili: 'sw',
  swedish: 'sv', tagalog: 'tl', tamil: 'ta', telugu: 'te', thai: 'th',
  tibetan: 'bo', turkish: 'tr', ukrainian: 'uk', urdu: 'ur', vietnamese: 'vi',
  welsh: 'cy', yiddish: 'yi',
};

const RTL_TAGS = new Set(['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ku']);

/** BCP 47 tag for a language name, or null if we don't recognise it. */
export function languageTag(name) {
  return LANGUAGE_TAGS[name.trim().toLowerCase()] || null;
}

/** Whether a BCP 47 tag is written right to left. */
export function isRightToLeft(tag) {
  return RTL_TAGS.has(tag);
}

/**
 * A book can credit more than one translator. They're written as ordinary
 * prose in the CSV — "Ann Goldstein" or "William Hutchins and Olive Kenny" or
 * a comma-separated pair — so split on commas and "and". This assumes names
 * are written forename-first; "Goldstein, Ann" would come apart into two.
 */
function splitTranslators(text) {
  return text
    .split(/,| and /i)
    .map((name) => name.trim())
    .filter(Boolean);
}

function groupByTranslator(books) {
  const map = new Map();
  for (const book of books) {
    for (const name of splitTranslators(book.translator)) {
      if (!map.has(name)) map.set(name, { name, books: [] });
      map.get(name).books.push(book);
    }
  }
  for (const entry of map.values()) entry.count = entry.books.length;
  // Most-translated first, then alphabetically by surname-ish (last word).
  return new Map(
    [...map.entries()].sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      const surname = (n) => n.split(' ').pop();
      return surname(a[0]).localeCompare(surname(b[0]));
    }),
  );
}

/** Names of the countries a book's author belongs to, ready for display. */
export function countryNames(book, countries) {
  return [...book.nationalities.map((code) => countries[code].name), ...book.badCodes];
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
});

export function formatDate(book) {
  return book.dateValue == null ? '' : DATE_FORMAT.format(book.dateValue);
}
