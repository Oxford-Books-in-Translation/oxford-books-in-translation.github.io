/**
 * The rules for what counts as a valid row of books.csv.
 *
 * Pure functions with no browser or Node dependencies, so the site and
 * scripts/validate-books.mjs apply exactly the same rules and can never
 * disagree about whether the data is sound.
 *
 * Errors are things that are definitely wrong (a bad country code, a date that
 * isn't a date). Warnings are things that are probably wrong and that only a
 * human can settle — chiefly two spellings of one language, which would
 * otherwise be silently counted as two languages.
 */

export const REQUIRED_COLUMNS = [
  'title', 'author', 'author_nationality', 'original_language', 'date_discussed',
];

export const KNOWN_COLUMNS = [
  'title', 'original_title', 'author', 'author_nationality', 'original_language',
  'translator', 'year_published', 'date_discussed', 'notes',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_RE = /^-?\d{1,4}$/;

export function clean(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function languageKey(name) {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

/** Levenshtein distance, short-circuited — only used to suggest typos. */
export function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

export function isRealDate(text) {
  if (!DATE_RE.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day;
}

/**
 * Turns parsed CSV records into book objects, collecting errors and warnings.
 * A row with a problem is still returned wherever it can be usefully shown.
 */
export function validateBooks(records, countries) {
  const errors = [];
  const warnings = [];
  const books = [];

  for (const record of records) {
    const line = record.__line;

    // An entirely empty row is a stray blank line, not a mistake worth reporting.
    if (REQUIRED_COLUMNS.every((column) => !clean(record[column]))) continue;

    const book = {
      title: clean(record.title),
      originalTitle: clean(record.original_title),
      author: clean(record.author),
      language: clean(record.original_language),
      translator: clean(record.translator),
      year: clean(record.year_published),
      dateDiscussed: clean(record.date_discussed),
      notes: clean(record.notes),
      line,
    };

    const where = `Row ${line} (${book.title || 'untitled'})`;

    const missing = REQUIRED_COLUMNS.filter((column) => !clean(record[column]));
    if (missing.length) errors.push(`${where}: missing ${missing.join(', ')}.`);

    const codes = clean(record.author_nationality)
      .toUpperCase()
      .split('|')
      .map((code) => code.trim())
      .filter(Boolean);

    book.nationalities = codes.filter((code) => countries[code]);
    book.badCodes = codes.filter((code) => !countries[code]);
    for (const code of book.badCodes) {
      errors.push(`${where}: "${code}" is not a valid ISO 3166-1 alpha-3 country code.`);
    }

    const historic = book.nationalities.filter((code) => countries[code].historic);
    for (const code of historic) {
      warnings.push(
        `${where}: "${code}" is a former state (${countries[code].name}). It is accepted, ` +
        `but the map can only mark it with a dot — use the present-day country unless ` +
        `the historic state is the point.`,
      );
    }

    if (book.dateDiscussed && !isRealDate(book.dateDiscussed)) {
      errors.push(`${where}: date_discussed "${book.dateDiscussed}" is not a real YYYY-MM-DD date.`);
      book.dateDiscussed = '';
    }

    if (book.year && !YEAR_RE.test(book.year)) {
      errors.push(`${where}: year_published "${book.year}" is not a year.`);
      book.year = '';
    }

    book.yearValue = book.year ? Number(book.year) : null;
    book.dateValue = book.dateDiscussed ? Date.parse(`${book.dateDiscussed}T00:00:00Z`) : null;
    books.push(book);
  }

  warnings.push(...languageWarnings(books));
  return { books, errors, warnings };
}

/** Column-level checks, kept separate because they stop parsing being useful. */
export function validateColumns(columns) {
  const errors = [];
  const warnings = [];

  const missing = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  if (missing.length) {
    errors.push(
      `data/books.csv is missing the required column(s): ${missing.join(', ')}. ` +
      `Found: ${columns.join(', ') || '(none)'}.`,
    );
  }

  const unexpected = columns.filter((column) => column && !KNOWN_COLUMNS.includes(column));
  if (unexpected.length) {
    warnings.push(`Unrecognised column(s) ignored: ${unexpected.join(', ')}.`);
  }

  return { errors, warnings };
}

/**
 * Language names are counted exactly as written, so two spellings of one
 * language become two languages. Catch both "same once normalised" and
 * "one character apart".
 */
function languageWarnings(books) {
  const byKey = new Map();
  for (const book of books) {
    if (!book.language) continue;
    const key = languageKey(book.language);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key).add(book.language);
  }

  const warnings = [];
  for (const spellings of byKey.values()) {
    if (spellings.size > 1) {
      warnings.push(
        `Language spelled inconsistently: ${[...spellings].map((s) => `"${s}"`).join(' and ')} — ` +
        `these are counted as separate languages.`,
      );
    }
  }

  const keys = [...byKey.keys()];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (keys[i].length < 4 || keys[j].length < 4) continue;
      if (editDistance(keys[i], keys[j]) <= 1) {
        const a = [...byKey.get(keys[i])][0];
        const b = [...byKey.get(keys[j])][0];
        warnings.push(`"${a}" and "${b}" differ by one character — is one of them a typo?`);
      }
    }
  }

  return warnings;
}
