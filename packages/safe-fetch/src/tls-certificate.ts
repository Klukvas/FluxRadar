// Passive TLS inspection retains safe-fetch's local DNS guard and approved-IP tunnel.
import { isIP, type Socket } from 'node:net';
import { checkServerIdentity, connect, type ConnectionOptions, type TLSSocket } from 'node:tls';
import { SsrfBlockedError, UrlValidationError } from './errors.js';
import { openProxyTunnel, type EgressProxy, type ProxyTunnelOptions } from './proxy.js';
import type { DnsResolver } from './resolver.js';
import { resolvePublicAddresses, validatePublicUrl } from './safe-fetch.js';

export interface TlsCertificateSnapshot {
  readonly hostname: string;
  readonly observedAt: string;
  readonly status: 'checked' | 'unverified';
  readonly authorized: boolean;
  readonly authorizationError?: string;
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly subjectAltNames?: readonly string[];
  readonly issuer?: string;
  readonly unavailableReason?: string;
}
export interface InspectTlsOptions {
  readonly resolver?: DnsResolver;
  readonly proxy?: EgressProxy;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly port?: number;
  readonly now?: () => Date;
  readonly dangerouslyAllowLoopback?: boolean;
  readonly tlsConnect?: (options: ConnectionOptions) => TLSSocket;
  readonly openTunnel?: (options: ProxyTunnelOptions) => Promise<Socket>;
}

export async function inspectTlsCertificate(
  hostname: string,
  options: InspectTlsOptions = {},
): Promise<TlsCertificateSnapshot> {
  const port = options.port ?? 443;
  const bare = hostname.replace(/^\[|\]$/g, '');
  const host = isIP(bare) === 6 ? `[${bare}]` : bare;
  const url = validatePublicUrl(`https://${host}:${port}/`);
  if (url.hostname.replace(/^\[|\]$/g, '') !== bare || url.username !== '' || url.password !== '') {
    throw new UrlValidationError(hostname, 'expected a hostname');
  }
  const base = { hostname: bare, observedAt: (options.now?.() ?? new Date()).toISOString() };
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted === true) controller.abort();
  const timer = setTimeout(abort, options.timeoutMs ?? 10_000);
  let socket: TLSSocket | undefined;
  let tunnel: Socket | undefined;
  try {
    const work = async (): Promise<TlsCertificateSnapshot> => {
      if (controller.signal.aborted) throw new Error('TLS inspection aborted or timed out');
      const addresses = await resolvePublicAddresses(url, options);
      if (controller.signal.aborted) throw new Error('TLS inspection aborted or timed out');
      const address = addresses[0];
      if (address === undefined) throw new Error('No resolved address');
      if (options.proxy !== undefined) {
        tunnel = await (options.openTunnel ?? openProxyTunnel)({
          proxy: options.proxy,
          address,
          port,
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          tunnel.destroy();
          throw new Error('TLS inspection aborted or timed out');
        }
      }
      return await new Promise<TlsCertificateSnapshot>((resolve, reject) => {
        socket = (options.tlsConnect ?? connect)({
          ...(tunnel === undefined ? { host: address, port } : { socket: tunnel }),
          servername: isIP(bare) === 0 ? bare : undefined,
          rejectUnauthorized: false,
        });
        socket.once('error', reject);
        socket.once('secureConnect', () => {
          if (socket === undefined) return;
          const certificate = socket.getPeerCertificate();
          if (Object.keys(certificate).length === 0) {
            reject(new Error('No peer certificate'));
            return;
          }
          const identityError = checkServerIdentity(bare, certificate);
          const authorizationError =
            identityError?.message ??
            (socket.authorizationError === null ? undefined : String(socket.authorizationError));
          resolve({
            ...base,
            status: 'checked',
            authorized: socket.authorized && identityError === undefined,
            ...(authorizationError === undefined ? {} : { authorizationError }),
            validFrom: certificate.valid_from,
            validTo: certificate.valid_to,
            subjectAltNames: certificate.subjectaltname?.split(/,\s*/) ?? [],
            issuer: Object.entries(certificate.issuer ?? {})
              .map(([key, value]) => `${key}=${value}`)
              .join(', '),
          });
        });
      });
    };
    return await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        const onAbort = (): void => reject(new Error('TLS inspection aborted or timed out'));
        if (controller.signal.aborted) onAbort();
        else controller.signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } catch (error) {
    if (error instanceof SsrfBlockedError || error instanceof UrlValidationError) throw error;
    return {
      ...base,
      status: 'unverified',
      authorized: false,
      unavailableReason: isUnresolvedDns(error)
        ? 'DnsUnresolved'
        : error instanceof Error
          ? error.message
          : 'TLS connection failed',
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
    options.signal?.removeEventListener('abort', abort);
    socket?.destroy();
    tunnel?.destroy();
  }
}

function isUnresolvedDns(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = error.cause;
  const code =
    cause !== null && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
  return (
    code === 'ENOTFOUND' ||
    code === 'ENODATA' ||
    error.message.startsWith('safe-fetch: DNS returned no addresses')
  );
}
