// Локальный fixture-сайт (T-07) для crawler/rules/integration-тестов
// (T-08/T-09/T-15). Статика из fixtures/site + программные маршруты
// (redirect-цепочка, 1x1 PNG). Слушает только 127.0.0.1; security headers
// намеренно отсутствуют, Set-Cookie на `/` — без Secure/HttpOnly (SEC-PASSIVE).

import { readFile } from 'node:fs/promises';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface FixtureSite {
  readonly port: number;
  /** `http://127.0.0.1:<port>` — подставляется в {{ORIGIN}} шаблонов. */
  readonly origin: string;
  close(): Promise<void>;
}

const SITE_DIR = fileURLToPath(new URL('../fixtures/site/', import.meta.url));
const ORIGIN_PLACEHOLDER = /\{\{ORIGIN\}\}/g;

/** Валидный 1x1 прозрачный PNG — для <img> с 200-ответом, но без alt. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
};

/** Программные redirect-маршруты: /redirect-a → /redirect-b → /redirect-final.html. */
const REDIRECTS: Readonly<Record<string, string>> = {
  '/redirect-a': '/redirect-b',
  '/redirect-b': '/redirect-final.html',
};

export async function startFixtureSite(): Promise<FixtureSite> {
  let origin = '';
  const server = createServer((request, response) => {
    handleRequest(request, response, origin).catch((error: unknown) => {
      respondError(response, error);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('fixture-site: server did not report a bound TCP port');
  }
  origin = `http://127.0.0.1:${address.port}`;
  return { port: address.port, origin, close: () => closeServer(server) };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  origin: string,
): Promise<void> {
  const pathname = new URL(request.url ?? '/', origin).pathname;

  const redirectTarget = REDIRECTS[pathname];
  if (redirectTarget !== undefined) {
    response.writeHead(301, { location: redirectTarget });
    response.end();
    return;
  }
  if (pathname === '/img/pixel.png') {
    response.writeHead(200, { 'content-type': 'image/png' });
    response.end(PIXEL_PNG);
    return;
  }

  const filePath = resolveSitePath(pathname);
  if (filePath === null) {
    respondNotFound(response, pathname);
    return;
  }
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    respondNotFound(response, pathname);
    return;
  }
  const body = raw.replace(ORIGIN_PLACEHOLDER, origin);
  const headers: Record<string, string> = {
    'content-type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
  };
  if (pathname === '/') {
    // Намеренно небезопасная кука для SEC-PASSIVE-проверок (без Secure/HttpOnly).
    headers['set-cookie'] = 'fixture_session=abc123; Path=/';
  }
  response.writeHead(200, headers);
  response.end(body);
}

/** Отображение pathname → файл в fixtures/site с защитой от path traversal. */
function resolveSitePath(pathname: string): string | null {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const withIndex = relative.endsWith('/') ? `${relative}index.html` : relative;
  const resolved = path.resolve(SITE_DIR, withIndex);
  if (!resolved.startsWith(path.resolve(SITE_DIR) + path.sep)) {
    return null;
  }
  return resolved;
}

function respondNotFound(response: ServerResponse, pathname: string): void {
  response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
  response.end(
    `<!DOCTYPE html><html lang="en"><head><title>404 Not Found</title></head>` +
      `<body><h1>404</h1><p>No fixture at ${escapeHtml(pathname)}</p></body></html>`,
  );
}

function respondError(response: ServerResponse, error: unknown): void {
  if (!response.headersSent) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
  }
  response.end(`fixture-site error: ${error instanceof Error ? error.message : String(error)}`);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
