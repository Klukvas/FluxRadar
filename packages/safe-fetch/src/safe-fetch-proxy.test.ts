// safeFetch через egress-прокси: локальный CONNECT-прокси и локальный сайт,
// внешняя сеть не используется. Проверяется главный инвариант: SSRF-гард
// остаётся на нашей стороне, а прокси получает только проверенный адрес.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { IncomingMessage, Server } from 'node:http';
import { createServer } from 'node:http';
import type { Server as TlsServer } from 'node:https';
import { createServer as createTlsServer } from 'node:https';
import { tmpdir } from 'node:os';
import type { AddressInfo, Socket } from 'node:net';
import { connect as netConnect } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { NetworkError, SsrfBlockedError } from './errors.js';
import type { EgressProxy } from './proxy.js';
import type { DnsResolver } from './resolver.js';
import { safeFetch } from './safe-fetch.js';

const CREDENTIALS = { username: 'bot', password: 's3cret' } as const;
/** Адрес, тоннель к которому фейковый прокси отвергает — так же, как живой. */
const REFUSED_ADDRESS = '127.0.0.9';
const EXPECTED_AUTHORIZATION = `Basic ${Buffer.from('bot:s3cret').toString('base64')}`;

const mockResolver = (map: Readonly<Record<string, readonly string[]>>): DnsResolver => ({
  resolveAll(host: string): Promise<readonly string[]> {
    const addresses = map[host];
    return addresses === undefined
      ? Promise.reject(new Error(`mock DNS: unknown host "${host}"`))
      : Promise.resolve(addresses);
  },
});

/**
 * Самоподписанный сертификат на site.test для ветки https. Доверия к нему нет
 * и быть не должно: тест ждёт именно ошибку проверки сертификата — это и есть
 * доказательство, что TLS поднят поверх тоннеля и проверяется у нас.
 */
function generateSelfSignedCert(directory: string): { key: string; cert: string } | null {
  const keyPath = join(directory, 'key.pem');
  const certPath = join(directory, 'cert.pem');
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '2',
        '-subj',
        '/CN=site.test',
        '-addext',
        'subjectAltName=DNS:site.test',
      ],
      { stdio: 'ignore' },
    );
  } catch {
    // Без openssl ветку https проверить нечем — тест помечается пропущенным.
    return null;
  }
  return { key: readFileSync(keyPath, 'utf8'), cert: readFileSync(certPath, 'utf8') };
}

let site: Server;
let sitePort: number;
let tlsSite: TlsServer | null = null;
let tlsSitePort = 0;
let certDirectory: string;
let proxy: Server;
let proxyEgress: EgressProxy;
/** Цели каждого CONNECT, который получил прокси, по порядку. */
let connectTargets: string[] = [];

beforeAll(async () => {
  site = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<html><body>${req.headers['user-agent'] ?? 'no agent'}</body></html>`);
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  sitePort = (site.address() as AddressInfo).port;

  certDirectory = mkdtempSync(join(tmpdir(), 'fluxradar-proxy-tls-'));
  const credentials = generateSelfSignedCert(certDirectory);
  if (credentials !== null) {
    tlsSite = createTlsServer(credentials, (_req, res) => res.writeHead(200).end('ok'));
    await new Promise<void>((resolve) => tlsSite?.listen(0, '127.0.0.1', resolve));
    tlsSitePort = (tlsSite.address() as AddressInfo).port;
  }

  proxy = createServer((_req, res) => {
    res.writeHead(405).end();
  });
  proxy.on('connect', (req: IncomingMessage, clientSocket: Socket) => {
    connectTargets.push(req.url ?? '');
    if (req.headers['proxy-authorization'] !== EXPECTED_AUTHORIZATION) {
      clientSocket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
      return;
    }
    const [host, port] = (req.url ?? '').split(':');
    if (host === REFUSED_ADDRESS) {
      // Deterministic refusal: an unassigned loopback address hangs on macOS
      // and is refused instantly on Linux, which is not a difference a test
      // about our fallback should depend on.
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }
    const upstream = netConnect(Number(port), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  proxyEgress = {
    host: '127.0.0.1',
    port: (proxy.address() as AddressInfo).port,
    credentials: { ...CREDENTIALS },
  };
});

beforeEach(() => {
  connectTargets = [];
});

afterAll(async () => {
  await new Promise<void>((resolve) => site.close(() => resolve()));
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
  if (tlsSite !== null) await new Promise<void>((resolve) => tlsSite?.close(() => resolve()));
  rmSync(certDirectory, { recursive: true, force: true });
});

describe('safeFetch through an egress proxy', () => {
  it('fetches the page through the tunnel and keeps the crawler headers', async () => {
    const result = await safeFetch(`http://site.test:${sitePort}/`, {
      proxy: proxyEgress,
      headers: { 'user-agent': 'FluxRadarBot/0.1' },
      resolver: mockResolver({ 'site.test': ['127.0.0.1'] }),
      dangerouslyAllowLoopback: true,
    });

    expect(result.status).toBe(200);
    expect(result.body).toContain('FluxRadarBot/0.1');
    expect(connectTargets).toEqual([`127.0.0.1:${sitePort}`]);
  });

  it('falls back to the next verified address when the first one is dead', async () => {
    const result = await safeFetch(`http://site.test:${sitePort}/`, {
      proxy: proxyEgress,
      resolver: mockResolver({ 'site.test': [REFUSED_ADDRESS, '127.0.0.1'] }),
      dangerouslyAllowLoopback: true,
    });

    expect(result.status).toBe(200);
    expect(connectTargets).toEqual([`${REFUSED_ADDRESS}:${sitePort}`, `127.0.0.1:${sitePort}`]);
  });

  it('blocks a private target before the proxy is contacted', async () => {
    await expect(
      safeFetch('http://internal.test/', {
        proxy: proxyEgress,
        resolver: mockResolver({ 'internal.test': ['10.0.0.5'] }),
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);

    expect(connectTargets).toEqual([]);
  });

  it('reports a refused tunnel as a network error naming the status', async () => {
    await expect(
      safeFetch(`http://site.test:${sitePort}/`, {
        proxy: { ...proxyEgress, credentials: { username: 'bot', password: 'wrong' } },
        resolver: mockResolver({ 'site.test': ['127.0.0.1'] }),
        dangerouslyAllowLoopback: true,
      }),
    ).rejects.toThrow(/refused CONNECT .* 407/);
  });

  it('reports an unreachable proxy as a network error', async () => {
    await expect(
      safeFetch(`http://site.test:${sitePort}/`, {
        // Port 1 on loopback has nothing listening.
        proxy: { host: '127.0.0.1', port: 1, credentials: null },
        resolver: mockResolver({ 'site.test': ['127.0.0.1'] }),
        dangerouslyAllowLoopback: true,
      }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('verifies the https certificate on our side of the tunnel', async ({ skip }) => {
    if (tlsSite === null) skip('openssl is unavailable, so no TLS fixture was generated');

    const attempt = safeFetch(`https://site.test:${tlsSitePort}/`, {
      proxy: proxyEgress,
      resolver: mockResolver({ 'site.test': ['127.0.0.1'] }),
      dangerouslyAllowLoopback: true,
    });

    // Сертификат самоподписанный: успешный ответ означал бы, что проверку
    // где-то отключили. Тоннель при этом должен быть открыт на проверенный IP.
    await expect(attempt).rejects.toThrow(NetworkError);
    await expect(attempt).rejects.toMatchObject({
      cause: { code: expect.stringMatching(/SELF_SIGNED_CERT|SELF_SIGNED/) as unknown as string },
    });
    expect(connectTargets).toEqual([`127.0.0.1:${tlsSitePort}`]);
  });
});
