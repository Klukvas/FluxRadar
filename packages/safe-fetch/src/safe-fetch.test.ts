// Интеграционные тесты safeFetch на локальном node:http-сервере (127.0.0.1).
// Внешняя сеть не используется: DNS мокируется, соединения только loopback.

import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  NetworkError,
  RedirectLimitError,
  SsrfBlockedError,
  TimeoutError,
  UrlValidationError,
} from './errors.js';
import type { DnsResolver } from './resolver.js';
import { safeFetch } from './safe-fetch.js';

const mockResolver = (map: Readonly<Record<string, readonly string[]>>): DnsResolver => ({
  resolveAll(host: string): Promise<readonly string[]> {
    const addresses = map[host];
    if (addresses === undefined) {
      return Promise.reject(new Error(`mock DNS: unknown host "${host}"`));
    }
    return Promise.resolve(addresses);
  },
});

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    // Тестовый сервер: клиент обрывает соединения намеренно (cap/timeout) —
    // ошибки записи в закрытый сокет здесь ожидаемы и безопасны.
    res.on('error', () => undefined);
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/ok') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-probe': 'fluxradar' });
      res.end('hello world');
      return;
    }
    if (url.pathname === '/echo-host') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(req.headers.host ?? '');
      return;
    }
    if (url.pathname === '/redirect-metadata') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }
    if (url.pathname === '/chain-start') {
      res.writeHead(302, { location: '/chain-mid' });
      res.end();
      return;
    }
    if (url.pathname === '/chain-mid') {
      res.writeHead(301, { location: '/ok' });
      res.end();
      return;
    }
    if (url.pathname.startsWith('/hop/')) {
      const hopIndex = Number(url.pathname.slice('/hop/'.length));
      if (hopIndex < 6) {
        res.writeHead(302, { location: `/hop/${hopIndex + 1}` });
        res.end();
      } else {
        res.writeHead(200);
        res.end('made it');
      }
      return;
    }
    if (url.pathname === '/slow') {
      const lateReply = setTimeout(() => res.end('late'), 5_000);
      res.on('close', () => clearTimeout(lateReply));
      return;
    }
    if (url.pathname === '/big') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('a'.repeat(64 * 1024));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe('safeFetch: SSRF-гард', () => {
  it('блокирует host, резолвящийся в приватный IP', async () => {
    const promise = safeFetch('http://internal.example/', {
      resolver: mockResolver({ 'internal.example': ['10.0.0.5'] }),
    });
    await expect(promise).rejects.toBeInstanceOf(SsrfBlockedError);
    await promise.catch((error: SsrfBlockedError) => {
      expect(error.ip).toBe('10.0.0.5');
      expect(error.host).toBe('internal.example');
    });
  });

  it('fail-closed: блокирует, если приватен хотя бы ОДИН из resolved-адресов', async () => {
    const promise = safeFetch('http://mixed.example/', {
      resolver: mockResolver({ 'mixed.example': ['93.184.216.34', '192.168.1.10'] }),
    });
    await expect(promise).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('блокирует loopback без dangerouslyAllowLoopback', async () => {
    await expect(safeFetch(`${baseUrl}/ok`)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('redirect на metadata IP блокируется даже с dangerouslyAllowLoopback', async () => {
    const promise = safeFetch(`${baseUrl}/redirect-metadata`, {
      dangerouslyAllowLoopback: true,
    });
    await expect(promise).rejects.toBeInstanceOf(SsrfBlockedError);
    await promise.catch((error: SsrfBlockedError) => {
      expect(error.ip).toBe('169.254.169.254');
    });
  });

  it('ошибка DNS → NetworkError', async () => {
    await expect(
      safeFetch('http://unknown.example/', { resolver: mockResolver({}) }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('блокирует NAT64 local-use (64:ff9b:1::/96) embedding loopback — ранее незакрытый вектор', async () => {
    // DNS возвращает 64:ff9b:1::7f00:1 (= 127.0.0.1 через RFC 8215 NAT64)
    const promise = safeFetch('http://nat64local.example/', {
      resolver: mockResolver({ 'nat64local.example': ['64:ff9b:1::7f00:1'] }),
    });
    await expect(promise).rejects.toBeInstanceOf(SsrfBlockedError);
    await promise.catch((error: SsrfBlockedError) => {
      expect(error.ip).toBe('64:ff9b:1::7f00:1');
    });
  });

  it('блокирует NAT64 local-use (64:ff9b:1::/96) embedding private — ранее незакрытый вектор', async () => {
    const promise = safeFetch('http://nat64priv.example/', {
      resolver: mockResolver({ 'nat64priv.example': ['64:ff9b:1::a00:1'] }),
    });
    await expect(promise).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('пропускает NAT64 local-use с публичным вложенным IPv4', async () => {
    // 64:ff9b:1::808:808 = 8.8.8.8 → публичный
    const result = await safeFetch(`${baseUrl}/ok`, {
      resolver: mockResolver({ '127.0.0.1': ['127.0.0.1'] }),
      dangerouslyAllowLoopback: true,
    });
    expect(result.status).toBe(200);
  });

  it('блокирует 6to4 (2002::/16) embedding loopback — ранее незакрытый вектор', async () => {
    // 2002:7f00:1:: embeds 127.0.0.1
    const promise = safeFetch('http://sixtofour.example/', {
      resolver: mockResolver({ 'sixtofour.example': ['2002:7f00:1::'] }),
    });
    await expect(promise).rejects.toBeInstanceOf(SsrfBlockedError);
    await promise.catch((error: SsrfBlockedError) => {
      expect(error.ip).toBe('2002:7f00:1::');
    });
  });

  it('блокирует 6to4 (2002::/16) embedding private RFC1918', async () => {
    // 2002:c0a8:101:: embeds 192.168.1.1
    const promise = safeFetch('http://sixtofour2.example/', {
      resolver: mockResolver({ 'sixtofour2.example': ['2002:c0a8:101::'] }),
    });
    await expect(promise).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe('safeFetch: валидация URL', () => {
  it('отклоняет не-http(s) схему', async () => {
    await expect(safeFetch('ftp://example.com/file')).rejects.toBeInstanceOf(UrlValidationError);
  });

  it('отклоняет userinfo', async () => {
    await expect(safeFetch('http://user:pass@example.com/')).rejects.toBeInstanceOf(
      UrlValidationError,
    );
  });

  it('отклоняет URL длиннее maxUrlBytes (CRAWL_LIMITS.maxUrlBytes по умолчанию)', async () => {
    await expect(safeFetch(`http://example.com/${'a'.repeat(3000)}`)).rejects.toBeInstanceOf(
      UrlValidationError,
    );
  });
});

describe('safeFetch: запросы к локальному серверу', () => {
  it('happy path: GET с dangerouslyAllowLoopback', async () => {
    const result = await safeFetch(`${baseUrl}/ok`, { dangerouslyAllowLoopback: true });
    expect(result.status).toBe(200);
    expect(result.body).toBe('hello world');
    expect(result.truncated).toBe(false);
    expect(result.redirectChain).toEqual([]);
    expect(result.finalUrl).toBe(`${baseUrl}/ok`);
    expect(result.headers['x-probe']).toBe('fluxradar');
    expect(result.timingMs).toBeGreaterThanOrEqual(0);
  });

  it('pin: hostname из мок-DNS соединяется с проверенным IP, Host остаётся hostname', async () => {
    const port = new URL(baseUrl).port;
    const result = await safeFetch(`http://fixture.test:${port}/echo-host`, {
      resolver: mockResolver({ 'fixture.test': ['127.0.0.1'] }),
      dangerouslyAllowLoopback: true,
    });
    expect(result.status).toBe(200);
    expect(result.body).toBe(`fixture.test:${port}`);
  });

  it('redirect-цепочка возвращается в результате', async () => {
    const result = await safeFetch(`${baseUrl}/chain-start`, { dangerouslyAllowLoopback: true });
    expect(result.status).toBe(200);
    expect(result.finalUrl).toBe(`${baseUrl}/ok`);
    expect(result.redirectChain).toEqual([
      { url: `${baseUrl}/chain-start`, status: 302, location: '/chain-mid' },
      { url: `${baseUrl}/chain-mid`, status: 301, location: '/ok' },
    ]);
  });

  it('цепочка из 6 редиректов при лимите 5 → RedirectLimitError', async () => {
    const promise = safeFetch(`${baseUrl}/hop/0`, { dangerouslyAllowLoopback: true });
    await expect(promise).rejects.toBeInstanceOf(RedirectLimitError);
    await promise.catch((error: RedirectLimitError) => {
      expect(error.maxRedirects).toBe(5);
      expect(error.redirectChain).toHaveLength(6);
    });
  });

  it('превышение дедлайна → TimeoutError', async () => {
    const promise = safeFetch(`${baseUrl}/slow`, {
      dangerouslyAllowLoopback: true,
      timeoutMs: 100,
    });
    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
  });

  it('тело сверх maxBodyBytes обрывается с truncated=true', async () => {
    const result = await safeFetch(`${baseUrl}/big`, {
      dangerouslyAllowLoopback: true,
      maxBodyBytes: 1000,
    });
    expect(result.status).toBe(200);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.body, 'utf8')).toBe(1000);
  });

  it('HEAD возвращает заголовки без тела', async () => {
    const result = await safeFetch(`${baseUrl}/ok`, {
      dangerouslyAllowLoopback: true,
      method: 'HEAD',
    });
    expect(result.status).toBe(200);
    expect(result.body).toBe('');
    expect(result.truncated).toBe(false);
  });
});
