// Egress через HTTP CONNECT-прокси.
//
// Сайты, которые блокируют хостинг-сеть краулера, отвечают 403 на каждый
// запрос, а ниже по потоку это читается как «у сайта нет robots.txt и он не
// отдаёт 200» — отчёт, полный находок про нас самих. Лечится выходом через
// прокси в сети, которую проверяемый рынок принимает.
//
// SSRF-гард при этом НЕ переезжает на прокси: safe-fetch по-прежнему сам
// резолвит хост и проверяет каждый адрес, а прокси просят открыть тоннель на
// ОДИН уже одобренный адрес (D-125). Имени хоста, которое можно разрешить
// во что-то другое, прокси не получает.

import { request as httpRequest } from 'node:http';
import type { Socket } from 'node:net';
import { isIP } from 'node:net';

import { NetworkError, ProxyConfigError } from './errors.js';

export interface ProxyCredentials {
  readonly username: string;
  readonly password: string;
}

export interface EgressProxy {
  readonly host: string;
  readonly port: number;
  /** null — прокси авторизует по адресу источника, без заголовка. */
  readonly credentials: ProxyCredentials | null;
}

export interface ProxyTunnelOptions {
  readonly proxy: EgressProxy;
  /** IP-литерал, уже проверенный вызывающим, — никогда не имя хоста. */
  readonly address: string;
  readonly port: number;
  readonly signal: AbortSignal;
}

/**
 * Разбирает `http://user:pass@host:port`. Порт обязателен: молчаливый переход
 * на 80 из-за опечатки — это целое развёртывание, обходящее сайты не из той
 * сети, и в отчётах такой сбой не виден.
 */
export function parseEgressProxyUrl(value: string): EgressProxy {
  const raw = value.trim();
  if (raw === '') {
    throw new ProxyConfigError('the value is empty');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new ProxyConfigError('not a parseable absolute URL', { cause: error });
  }
  if (parsed.protocol !== 'http:') {
    throw new ProxyConfigError(
      `unsupported scheme "${parsed.protocol}" — the proxy hop must be plain http`,
    );
  }
  if (parsed.hostname === '') {
    throw new ProxyConfigError('no proxy host');
  }
  if (parsed.port === '') {
    throw new ProxyConfigError('no proxy port — state it explicitly, as in host:13128');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new ProxyConfigError('a proxy URL carries no path');
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new ProxyConfigError('a proxy URL carries no query or fragment');
  }
  return {
    host: parsed.hostname,
    port: Number(parsed.port),
    credentials: readCredentials(parsed),
  };
}

function readCredentials(parsed: URL): ProxyCredentials | null {
  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  if (username === '' && password === '') {
    return null;
  }
  if (username === '' || password === '') {
    throw new ProxyConfigError('proxy credentials need both a username and a password');
  }
  return { username, password };
}

function proxyAuthorization(credentials: ProxyCredentials): string {
  const encoded = Buffer.from(`${credentials.username}:${credentials.password}`, 'utf8');
  return `Basic ${encoded.toString('base64')}`;
}

/** `1.2.3.4:443`, для IPv6 — `[2001:db8::1]:443`. */
function authority(address: string, port: number): string {
  return isIP(address) === 6 ? `[${address}]:${port}` : `${address}:${port}`;
}

/**
 * Открывает тоннель и отдаёт сырой сокет. TLS поверх него поднимает вызывающий,
 * поэтому сертификат проверяется по hostname и на нашей стороне прокси.
 */
export function openProxyTunnel(options: ProxyTunnelOptions): Promise<Socket> {
  const { proxy, address, port, signal } = options;
  if (isIP(address) === 0) {
    // Инвариант вызывающего, а не пользовательский ввод: имя хоста здесь
    // отдало бы резолв прокси и обнулило SSRF-гард.
    throw new NetworkError(`safe-fetch: tunnel target "${address}" is not a literal IP address`);
  }
  const target = authority(address, port);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: target,
      agent: false,
      signal,
      headers: {
        host: target,
        ...(proxy.credentials === null
          ? {}
          : { 'proxy-authorization': proxyAuthorization(proxy.credentials) }),
      },
    });
    // Любой ответ на CONNECT приходит сюда, включая отказ: node отдаёт статус
    // и сокет, а не обычный 'response'.
    request.once('connect', (response, socket: Socket) => {
      const status = response.statusCode ?? 0;
      if (status === 200) {
        resolve(socket);
        return;
      }
      socket.destroy();
      reject(
        new NetworkError(
          `safe-fetch: egress proxy ${proxy.host}:${proxy.port} refused CONNECT to ${target} ` +
            `with status ${status}` +
            (status === 407 ? ' — check the proxy credentials' : ''),
        ),
      );
    });
    request.once('error', (error) => {
      reject(
        new NetworkError(`safe-fetch: egress proxy ${proxy.host}:${proxy.port} is unreachable`, {
          cause: error,
        }),
      );
    });
    request.end();
  });
}
