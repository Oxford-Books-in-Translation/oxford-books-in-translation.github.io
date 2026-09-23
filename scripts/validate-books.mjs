#!/usr/bin/env node
/**
 * Checks data/books.csv before you push.
 *
 *   node scripts/validate-books.mjs [path/to/books.csv]
 *
 * Flags invalid ISO 3166-1 alpha-3 country codes, missing required fields,
 * malformed dates and years, and language names spelled more than one way.
 *
 * Exits 1 on errors so it can gate a commit or a CI run; warnings alone exit 0.
 * The rules come from assets/js/validate.js, the same module the site uses, so
 * this check and the page can never disagree.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { parseCsv } from '../assets/js/csv.js';
import { validateBooks, validateColumns } from '../assets/js/validate.js';
import { localIsoDate } from '../assets/js/data.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const colour = process.env.NO_COLOR || !process.stdout.isTTY
  ? { red: (s) => s, yellow: (s) => s, green: (s) => s, dim: (s) => s, bold: (s) => s }
  : {
      red: (s) => `[31m${s}[0m`,
      yellow: (s) => `[33m${s}[0m`,
      green: (s) => `[32m${s}[0m`,
      dim: (s) => `[2m${s}[0m`,
      bold: (s) => `[1m${s}[0m`,
    };

function read(path) {
  try {
    // resolve, not join: an absolute path passed on the command line must win.
    return readFileSync(resolve(root, path), 'utf8');
  } catch (error) {
    console.error(colour.red(`Could not read ${path}: ${error.message}`));
    process.exit(1);
  }
}

const csvPath = process.argv[2] || 'data/books.csv';

const countries = JSON.parse(read('data/countries.json').replace(/^﻿/, ''));
const { columns, records } = parseCsv(read(csvPath));

const columnCheck = validateColumns(columns);
if (columnCheck.errors.length) {
  for (const error of columnCheck.errors) console.error(colour.red(`error  ${error}`));
  process.exit(1);
}

const { books, errors, warnings } = validateBooks(records, countries);
const allWarnings = [...columnCheck.warnings, ...warnings];

// Only this script can see the disk, so it is the one that checks a named
// cover was actually committed. The page copes with a missing file by showing
// no cover, which is exactly why nobody would notice without this.
for (const book of books) {
  if (book.cover && !existsSync(join(root, 'covers', book.cover))) {
    errors.push(`Row ${book.line} (${book.title}): cover "${book.cover}" is not in covers/.`);
  }
}

for (const error of errors) console.error(`${colour.red('error')}  ${error}`);
for (const warning of allWarnings) console.error(`${colour.yellow('warn')}   ${warning}`);

/* ---- summary ---- */

// Counted the way the site counts: a book dated after today is coming up, not
// read, and doesn't add a country or a language yet.
const today = localIsoDate(new Date());
const booksRead = books.filter((book) => !(book.dateDiscussed && book.dateDiscussed > today));
const upcoming = books.length - booksRead.length;

const countryCodes = new Set(booksRead.flatMap((book) => book.nationalities));
const languages = new Set(booksRead.map((book) => book.language).filter(Boolean));

const summary = [
  `${booksRead.length} books read`,
  `${countryCodes.size} countries`,
  `${languages.size} languages`,
  ...(upcoming ? [`${upcoming} coming up`] : []),
].join(' · ');

if (errors.length || allWarnings.length) console.error('');
console.error(colour.dim(summary));

if (errors.length) {
  console.error(colour.red(colour.bold(
    `\n${errors.length} error${errors.length === 1 ? '' : 's'} in ${csvPath}.`,
  )));
  process.exit(1);
}

if (allWarnings.length) {
  console.error(colour.yellow(
    `\n${allWarnings.length} warning${allWarnings.length === 1 ? '' : 's'} — worth a look, but nothing is broken.`,
  ));
  process.exit(0);
}

console.error(colour.green(`\n${csvPath} looks good.`));
