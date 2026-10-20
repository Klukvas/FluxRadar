import { Resolver } from 'node:dns/promises';
import { describe, expect, it, vi } from 'vitest';
import { collectSiteSecurityFacts } from './site-security-facts.ts';
const inspectTls = vi.fn(async (hostname: string, options: { readonly port?: number } = {}) => ({
  port: options.port ?? 443,
  hostname,
  observedAt: '2026-10-19T00:00:00Z',
  status: 'unverified' as const,
  authorized: false,
}));
describe('site security collection', () => {
  it('does no probes without Security', async () => {
    const resolveTxt = vi.fn();
    inspectTls.mockClear();
    expect(
      await collectSiteSecurityFacts('https://example.com', ['SEO'], {
        inspectTls,
        txtResolver: { resolveTxt },
      }),
    ).toEqual({});
    expect(inspectTls).not.toHaveBeenCalled();
    expect(resolveTxt).not.toHaveBeenCalled();
  });
  it.each(['https://www.example.com.ua', 'https://shop.example.com.ua'])(
    'uses registrable domain for %s and joins TXT chunks',
    async (origin) => {
      const resolveTxt = vi.fn(async (hostname: string) =>
        hostname.length > 0 ? [['V=spf1 ', '-all']] : [],
      );
      const facts = await collectSiteSecurityFacts(origin, ['Security'], {
        inspectTls,
        txtResolver: { resolveTxt },
      });
      expect(resolveTxt.mock.calls.map((call) => call[0])).toEqual([
        'example.com.ua',
        '_dmarc.example.com.ua',
      ]);
      expect(facts.mailDns?.spf.records).toEqual(['V=spf1 -all']);
    },
  );
  it.each([
    ['ENODATA', 'checked'],
    ['ENOTFOUND', 'checked'],
    ['ESERVFAIL', 'unverified'],
    ['ETIMEOUT', 'unverified'],
  ] as const)('%s -> %s', async (code, status) => {
    const facts = await collectSiteSecurityFacts('https://example.com', ['Security'], {
      inspectTls,
      txtResolver: {
        resolveTxt: async () => {
          throw Object.assign(new Error(code), { code });
        },
      },
    });
    expect(facts.mailDns?.spf).toEqual({ status, records: [] });
  });
});

it('checks HTTP origins on port 443 as selected by the owner', async () => {
  inspectTls.mockClear();
  await collectSiteSecurityFacts('http://www.example.com', ['Security'], {
    inspectTls,
    txtResolver: { resolveTxt: async () => [] },
  });
  expect(inspectTls.mock.calls.map((call) => call[0])).toEqual(['www.example.com', 'example.com']);
  for (const call of inspectTls.mock.calls) expect(call[1]?.port ?? 443).toBe(443);
});

it('omits an unresolved counterpart while retaining a timeout as unverified', async () => {
  const txtResolver = { resolveTxt: async () => [] };
  const inspect = async (hostname: string) => ({
    hostname,
    observedAt: '2026-10-19T00:00:00Z',
    status: 'unverified' as const,
    authorized: false,
    unavailableReason: hostname.startsWith('www.') ? 'DnsUnresolved' : 'Timeout',
  });
  expect(
    (
      await collectSiteSecurityFacts('https://example.com', ['Security'], {
        inspectTls: inspect,
        txtResolver,
      })
    ).tls?.map((snapshot) => snapshot.hostname),
  ).toEqual(['example.com']);
});

it('does no TLS or TXT work when already cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  const inspect = vi.fn((hostname: string) => inspectTls(hostname));
  const resolveTxt = vi.fn(async () => []);
  expect(
    await collectSiteSecurityFacts('https://example.com', ['Security'], {
      signal: controller.signal,
      inspectTls: inspect,
      txtResolver: { resolveTxt },
    }),
  ).toEqual({});
  expect(inspect).not.toHaveBeenCalled();
  expect(resolveTxt).not.toHaveBeenCalled();
});

it('cancelling during TLS prevents TXT and late TLS completion starts no new phase', async () => {
  const controller = new AbortController();
  const resolveTxt = vi.fn(async () => []);
  const finishes: ((snapshot: Awaited<ReturnType<typeof inspectTls>>) => void)[] = [];
  const inspect = vi.fn(
    (hostname: string) =>
      new Promise<Awaited<ReturnType<typeof inspectTls>>>((resolve) => {
        finishes.push(resolve);
        void hostname;
      }),
  );
  const pending = collectSiteSecurityFacts('https://example.com', ['Security'], {
    signal: controller.signal,
    inspectTls: inspect,
    txtResolver: { resolveTxt },
  });
  controller.abort();
  const result = await Promise.race([
    pending,
    new Promise((resolve) => setTimeout(() => resolve('pending'), 30)),
  ]);
  expect(result).toEqual({});
  for (const finish of finishes) finish(await inspectTls('example.com'));
  await Promise.resolve();
  await Promise.resolve();
  expect(resolveTxt).not.toHaveBeenCalled();
});

it('settles a cancelled injected TXT lookup without cancelling its shared resolver', async () => {
  const controller = new AbortController();
  const cancel = vi.fn();
  const finishes: ((records: string[][]) => void)[] = [];
  const resolveTxt = vi.fn(
    () =>
      new Promise<string[][]>((resolve) => {
        finishes.push(resolve);
      }),
  );
  const resolver = { resolveTxt, cancel };
  const pending = collectSiteSecurityFacts('https://example.com', ['Security'], {
    signal: controller.signal,
    inspectTls,
    txtResolver: resolver,
  });
  await vi.waitFor(() => expect(resolveTxt).toHaveBeenCalledTimes(2));
  controller.abort();
  expect(
    await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve('pending'), 30)),
    ]),
  ).toEqual({});
  expect(cancel).not.toHaveBeenCalled();
  for (const finish of finishes) finish([]);
  await Promise.resolve();
  await Promise.resolve();
  expect(resolveTxt).toHaveBeenCalledTimes(2);
});

it('cancels an owned pending resolver and removes cancellation listeners', async () => {
  const controller = new AbortController();
  const resolveTxt = vi
    .spyOn(Resolver.prototype, 'resolveTxt')
    .mockImplementation(() => new Promise<string[][]>(() => {}));
  const cancel = vi.spyOn(Resolver.prototype, 'cancel').mockImplementation(() => undefined);
  try {
    const pending = collectSiteSecurityFacts('https://example.com', ['Security'], {
      signal: controller.signal,
      inspectTls,
    });
    await vi.waitFor(() => expect(resolveTxt).toHaveBeenCalledTimes(2));
    controller.abort();
    expect(await pending).toEqual({});
    expect(cancel).toHaveBeenCalledOnce();
  } finally {
    resolveTxt.mockRestore();
    cancel.mockRestore();
  }
});

it('does not cancel an owned resolver after completed collection', async () => {
  const controller = new AbortController();
  const resolveTxt = vi.spyOn(Resolver.prototype, 'resolveTxt').mockResolvedValue([]);
  const cancel = vi.spyOn(Resolver.prototype, 'cancel').mockImplementation(() => undefined);
  try {
    await collectSiteSecurityFacts('https://example.com', ['Security'], {
      signal: controller.signal,
      inspectTls,
    });
    controller.abort();
    expect(cancel).not.toHaveBeenCalled();
  } finally {
    resolveTxt.mockRestore();
    cancel.mockRestore();
  }
});
