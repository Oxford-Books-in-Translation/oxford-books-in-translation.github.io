#!/usr/bin/env node
/**
 * A local preview server, so you can look at the site before pushing.
 *
 *   node scripts/serve.mjs        then open http://localhost:8080
 *   node scripts/serve.mjs 3000   to use a different port
 *
 * This exists because the page fetches data/books.csv, and browsers refuse
 * that over file://. It is a development convenience only — GitHub Pages does
 * this job in production and there is nothing to build.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, resolve, sep, extname } from 'node:path';

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const port = Number(process.argv[2]) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  // Keep the server inside the project directory.
  const target = resolve(join(root, normalize(pathname)));
  if (target !== root && !target.startsWith(root + sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      response.writeHead(302, { Location: `${pathname.replace(/\/?$/, '/')}index.html` }).end();
      return;
    }
    response.writeHead(200, {
      'content-type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-store',
    });
    createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      .end(`Not found: ${pathname}`);
  }
});

server.listen(port, () => {
  console.log(`Serving ${root}\n  http://localhost:${port}`);
});
