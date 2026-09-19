/**
 * A small RFC 4180 CSV reader.
 *
 * Written by hand rather than pulled from a library so the browser and the
 * command-line validator parse the file exactly the same way. It handles
 * quoted fields, escaped quotes, commas and newlines inside quotes, and both
 * CRLF and LF endings, and it reports each record's real line number so
 * validation messages can point at a line in the file.
 */

export function parseCsv(text) {
  const source = text.replace(/^﻿/, ''); // Excel writes a byte-order mark
  const rows = [];
  const lineNumbers = [];

  let row = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let started = false;

  const beginRow = () => {
    if (!started) {
      rowLine = line;
      started = true;
    }
  };

  const endRow = () => {
    row.push(field);
    rows.push(row);
    lineNumbers.push(rowLine);
    row = [];
    field = '';
    started = false;
  };

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    beginRow();

    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') line++;
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      endRow();
      line++;
    } else if (char !== '\r') {
      field += char;
    }
  }

  // A file ending without a newline still has a final record to flush.
  if (started) endRow();

  if (!rows.length) return { columns: [], records: [] };

  const columns = rows[0].map((header) => header.trim());
  const records = rows.slice(1).map((cells, index) => {
    const record = { __line: lineNumbers[index + 1] };
    columns.forEach((column, position) => {
      record[column] = cells[position] ?? '';
    });
    return record;
  });

  return { columns, records };
}
