// SSRF-защищённый fetch-слой (T-05, план §6, D-125..D-128).
// Схема: валидация URL → резолв ВСЕХ адресов → blocklist (fail-closed) →
// запрос через node:http/https с pin проверенных IP через lookup-опцию →
// manual redirect с повторным гардом каждого Location.

import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';

import { CRAWL_LIMITS } from '@fluxradar/contracts';

import {
  NetworkError,
  RedirectLimitError,
  SafeFetchError,
  SsrfBlockedError,
  TimeoutError,
  UrlValidationError,
} from './errors.js';
import { classifyIp } from './ip-guard.js';
import type { DnsResolver } from './resolver.js';
import { stripIpv6Brackets, systemDnsResolver } from './resolver.js';

export interface SafeFetchOptions {
  readonly method?: 'GET' | 'HEAD';
  readonly headers?: Readonly<Record<string, string>>;
  /** Инъекция DNS для тестов; по умолчанию системный lookup (A+AAAA). */
  readonly resolver?: DnsResolver;
  /** Общий дедлайн на запрос, включая redirect-цепочку; default pageTimeoutMs (D-127). */
  readonly timeoutMs?: number;
  /** Обрыв тела сверх лимита с truncated=true; default maxHtmlBytes. */
  readonly maxBodyBytes?: number;
  /** Redirect сверх лимита → RedirectLimitError; default maxRedirects. */
  readonly maxRedirects?: number;
  /** Лимит длины URL в байтах (и стартового, и каждого Location); default maxUrlBytes. */
  readonly maxUrlBytes?: number;
  /**
   * ТОЛЬКО для тестов и локального fixture-сайта: пропускает loopback-адреса
   * (127/8, ::1) через SSRF-гард. Остальные непубличные диапазоны — RFC1918,
   * link-local/metadata, CGNAT и т.д. — блокируются даже с этим флагом (D-126).
   */
  readonly dangerouslyAllowLoopback?: boolean;
}

export interface RedirectHop {
  readonly url: string;
  readonly status: number;
  readonly location: string;
}

export interface SafeFetchResult {
  readonly finalUrl: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly redirectChain: readonly RedirectHop[];
  readonly timingMs: number;
  readonly truncated: boolean;
}

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * Выполняет GET/HEAD с SSRF-гардом. Любой resolved-адрес вне публичного
 * пространства → SsrfBlockedError до открытия соединения; соединение идёт
 * строго на проверенные адреса (lookup-pin), TLS проверяется по hostname.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const method = options.method ?? 'GET';
  const resolver = options.resolver ?? systemDnsResolver;
  const timeoutMs = options.timeoutMs ?? CRAWL_LIMITS.pageTimeoutMs;
  const maxBodyBytes = options.maxBodyBytes ?? CRAWL_LIMITS.maxHtmlBytes;
  const maxRedirects = options.maxRedirects ?? CRAWL_LIMITS.maxRedirects;
  const maxUrlBytes = options.maxUrlBytes ?? CRAWL_LIMITS.maxUrlBytes;
  const allowLoopback = options.dangerouslyAllowLoopback ?? false;

  const startedAt = Date.now();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);

  try {
    let currentUrl = validateUrl(url, maxUrlBytes);
    let redirectChain: readonly RedirectHop[] = [];

    for (;;) {
      const addresses = await resolveAndGuard(currentUrl, resolver, allowLoopback);
      const response = await performRequest(
        currentUrl,
        addresses,
        method,
        options.headers,
        deadline.signal,
      );
      const status = response.statusCode ?? 0;
      const location = response.headers.location;

      if (REDIRECT_STATUSES.has(status) && location !== undefined) {
        response.destroy(); // тело redirect-ответа не читаем; agent:false — пула сокетов нет
        const hop: RedirectHop = { url: currentUrl.href, status, location };
        if (redirectChain.length >= maxRedirects) {
          throw new RedirectLimitError(maxRedirects, [...redirectChain, hop]);
        }
        redirectChain = [...redirectChain, hop];
        currentUrl = validateUrl(resolveRedirectTarget(location, currentUrl), maxUrlBytes);
        continue;
      }

      const { body, truncated } = await readBodyCapped(response, maxBodyBytes);
      return {
        finalUrl: currentUrl.href,
        status,
        headers: flattenHeaders(response.headers),
        body,
        redirectChain,
        timingMs: Date.now() - startedAt,
        truncated,
      };
    }
  } catch (error) {
    throw mapError(error, deadline.signal.aborted, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

function validateUrl(input: string, maxUrlBytes: number): URL {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch (error) {
    throw new UrlValidationError(input, 'not a parseable absolute URL', { cause: error });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UrlValidationError(
      input,
      `unsupported scheme "${parsed.protocol}" — only http/https`,
    );
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new UrlValidationError(input, 'userinfo (user:pass@) is not allowed');
  }
  const byteLength = Buffer.byteLength(parsed.href, 'utf8');
  if (byteLength > maxUrlBytes) {
    throw new UrlValidationError(
      input,
      `URL is ${byteLength} bytes, limit is ${maxUrlBytes} (CRAWL_LIMITS.maxUrlBytes)`,
    );
  }
  return parsed;
}

function resolveRedirectTarget(location: string, base: URL): string {
  try {
    return new URL(location, base).href;
  } catch (error) {
    throw new UrlValidationError(location, 'unresolvable redirect Location', { cause: error });
  }
}

/** Fail-closed: ЛЮБОЙ непубличный адрес в ответе DNS блокирует весь host. */
async function resolveAndGuard(
  url: URL,
  resolver: DnsResolver,
  allowLoopback: boolean,
): Promise<readonly string[]> {
  const host = stripIpv6Brackets(url.hostname);
  let addresses: readonly string[];
  try {
    addresses = await resolver.resolveAll(host);
  } catch (error) {
    throw new NetworkError(`safe-fetch: DNS resolution failed for host "${host}"`, {
      cause: error,
    });
  }
  if (addresses.length === 0) {
    throw new NetworkError(`safe-fetch: DNS returned no addresses for host "${host}"`);
  }
  for (const ip of addresses) {
    const verdict = classifyIp(ip);
    if (verdict.isPublic) {
      continue;
    }
    if (allowLoopback && verdict.category === 'loopback') {
      continue;
    }
    throw new SsrfBlockedError({ url: url.href, host, ip, reason: verdict.reason });
  }
  return addresses;
}

/**
 * Запрос с pin проверенных адресов: lookup-callback подменяет DNS на список
 * из resolveAndGuard, поэтому соединение физически не может уйти на другой IP
 * (DNS rebinding закрыт — D-125). TLS SNI/cert проверяются по hostname как обычно.
 */
function performRequest(
  url: URL,
  addresses: readonly string[],
  method: 'GET' | 'HEAD',
  headers: Readonly<Record<string, string>> | undefined,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  const isHttps = url.protocol === 'https:';
  const requestFn = isHttps ? httpsRequest : httpRequest;
  const port = url.port !== '' ? Number(url.port) : isHttps ? 443 : 80;
  return new Promise((resolve, reject) => {
    const request = requestFn(
      {
        hostname: stripIpv6Brackets(url.hostname),
        port,
        path: `${url.pathname}${url.search}`,
        method,
        // identity: лимит maxBodyBytes считается по байтам тела на проводе (D-125)
        headers: { 'accept-encoding': 'identity', ...headers },
        signal,
        agent: false,
        lookup: pinnedLookup(addresses),
      },
      resolve,
    );
    request.on('error', reject);
    request.end();
  });
}

function pinnedLookup(addresses: readonly string[]): LookupFunction {
  return (_hostname, lookupOptions, callback) => {
    const entries = addresses.map((address) => ({ address, family: isIP(address) }));
    const first = entries[0];
    if (first === undefined) {
      callback(new Error('safe-fetch: pinned address list is empty'), '', 4);
      return;
    }
    if (lookupOptions.all === true) {
      callback(null, entries);
    } else {
      callback(null, first.address, first.family);
    }
  };
}

/** Стриминг тела с жёстким лимитом: сверх лимита — обрыв соединения + truncated. */
function readBodyCapped(
  response: IncomingMessage,
  maxBodyBytes: number,
): Promise<{ body: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;

    const finish = (truncated: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ body: Buffer.concat(chunks).toString('utf8'), truncated });
    };

    response.on('data', (chunk: Buffer) => {
      const remaining = maxBodyBytes - received;
      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        received = maxBodyBytes;
        response.destroy();
        finish(true);
        return;
      }
      chunks.push(chunk);
      received += chunk.length;
    });
    response.on('end', () => finish(false));
    response.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function flattenHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : String(value)]),
  );
}

/** Дедлайн-таймаут имеет приоритет над сетевыми ошибками, вызванными abort-ом. */
function mapError(error: unknown, deadlineFired: boolean, timeoutMs: number): SafeFetchError {
  if (deadlineFired) {
    return new TimeoutError(timeoutMs);
  }
  if (error instanceof SafeFetchError) {
    return error;
  }
  return new NetworkError('safe-fetch: request failed', { cause: error });
}
