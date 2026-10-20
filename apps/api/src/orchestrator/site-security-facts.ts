import { Resolver } from 'node:dns/promises';
import { getDomain } from 'tldts';
import {
  inspectTlsCertificate,
  type InspectTlsOptions,
  type TlsCertificateSnapshot,
} from '@fluxradar/safe-fetch';
import type { MailDnsSnapshot } from '@fluxradar/rules';

interface TxtResolver {
  resolveTxt(hostname: string): Promise<string[][]>;
}
export interface SiteSecurityOptions extends InspectTlsOptions {
  readonly txtResolver?: TxtResolver;
  readonly inspectTls?: typeof inspectTlsCertificate;
}
export interface SiteSecurityFacts {
  readonly tls?: readonly TlsCertificateSnapshot[];
  readonly mailDns?: MailDnsSnapshot;
}

/** DNS TXT answers are geographical-independent and bypass the HTTP egress proxy. */
export async function collectSiteSecurityFacts(
  origin: string,
  modules: readonly string[],
  options: SiteSecurityOptions = {},
): Promise<SiteSecurityFacts> {
  if (!modules.includes('Security') || isAborted(options.signal)) return {};
  const url = new URL(origin);
  const hostname = url.hostname;
  const inspect = options.inspectTls ?? inspectTlsCertificate;
  const tlsOptions = {
    ...options,
    ...(url.protocol === 'https:' && url.port !== '' ? { port: Number(url.port) } : {}),
  };
  const snapshots = await untilAborted(
    () =>
      Promise.all(
        [hostname, hostname.startsWith('www.') ? hostname.slice(4) : `www.${hostname}`].map(
          async (host, index) => {
            if (isAborted(options.signal)) return null;
            // Both names go through the same local DNS/IP guard. An unresolved pair is inapplicable.
            try {
              const snapshot = await inspect(host, tlsOptions);
              return index > 0 && snapshot.unavailableReason === 'DnsUnresolved' ? null : snapshot;
            } catch (error) {
              return {
                hostname: host,
                observedAt: (options.now?.() ?? new Date()).toISOString(),
                status: 'unverified',
                authorized: false,
                unavailableReason: error instanceof Error ? error.name : 'TLSUnavailable',
              } satisfies TlsCertificateSnapshot;
            }
          },
        ),
      ),
    options.signal,
  );
  if (snapshots === null || isAborted(options.signal)) return {};
  const tls = snapshots.filter((snapshot): snapshot is TlsCertificateSnapshot => snapshot !== null);
  const domain = getDomain(hostname, { allowPrivateDomains: true });
  if (domain === null) return { tls };
  if (isAborted(options.signal)) return {};
  const resolver = options.txtResolver ?? new Resolver({ timeout: 5_000, tries: 2 });
  // Only a resolver created here belongs to this run; injected resolvers may be shared.
  const cancelOwnedResolver = (): void => {
    if (options.txtResolver === undefined && resolver instanceof Resolver) resolver.cancel();
  };
  options.signal?.addEventListener('abort', cancelOwnedResolver, { once: true });
  try {
    if (isAborted(options.signal)) {
      cancelOwnedResolver();
      return {};
    }
    const records = await untilAborted(
      () => Promise.all([readTxt(resolver, domain), readTxt(resolver, `_dmarc.${domain}`)]),
      options.signal,
    );
    if (records === null || isAborted(options.signal)) return {};
    const [spf, dmarc] = records;
    return {
      tls,
      mailDns: { domain, observedAt: (options.now?.() ?? new Date()).toISOString(), spf, dmarc },
    };
  } finally {
    options.signal?.removeEventListener('abort', cancelOwnedResolver);
  }
}

async function readTxt(resolver: TxtResolver, hostname: string): Promise<MailDnsSnapshot['spf']> {
  try {
    return {
      status: 'checked',
      records: (await resolver.resolveTxt(hostname)).map((record) => record.join('')),
    };
  } catch (error) {
    const code =
      error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
    return {
      status: code === 'ENOTFOUND' || code === 'ENODATA' ? 'checked' : 'unverified',
      records: [],
    };
  }
}

/** An injected lookup may be non-cancellable; stop waiting without owning its lifetime. */
async function untilAborted<T>(start: () => Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (isAborted(signal)) return null;
  if (signal === undefined) return start();
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<null>((resolve) => {
    onAbort = (): void => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    if (isAborted(signal)) return null;
    return await Promise.race([start(), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}
