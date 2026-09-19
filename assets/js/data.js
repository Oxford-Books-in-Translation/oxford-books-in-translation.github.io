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

  const { books, errors, warnings } = validateBooks(records, countries);

  return {
    books,
    countries,
    topology,
    byCountry: groupByCountry(books, countries),
    byLanguage: groupByLanguage(books),
    // The site draws no distinction: both are things for a human to look at.
    warnings: [...errors, ...columnCheck.warnings, ...warnings],
  };
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
