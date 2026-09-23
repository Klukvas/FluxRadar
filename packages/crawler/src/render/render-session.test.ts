// What the render runtime lets a page do, tested against a real network.
//
// The browser is faked — these tests drive the route handler directly — but
// safe-fetch is not: every request here leaves through the same guard a real
// render uses, against a local server. That is deliberate. The interesting
// failures of this file are policy failures (a budget that concurrency can
// walk past, a redirect nobody re-checked, a request made after the scan was
// stopped), and a faked transport would hide all three.

import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RENDER_LIMITS } from '@fluxradar/contracts';

import { startPlaywrightRuntime } from './playwright-runtime.js';
import { RenderBudgetLedger } from './request-policy.js';
import type { RenderOutcome, RenderRequest, RenderRuntime } from './types.js';

/** Bytes that do not survive a round trip through UTF-8. */
const BINARY_SCRIPT = Buffer.from([0x2f, 0x2f, 0x20, 0xfe, 0xff, 0x80, 0x0a]);

/**
 * A redirect body. Servers are free to send one, safe-fetch reads it under the
 * manual redirect policy, and a chain that charged only its last hop would read
 * this four times for free.
 */
const HOP_BODY = 'x'.repeat(512);

const GZIPPED_SCRIPT_SOURCE = 'window.compressed = true;';
const GZIPPED_SCRIPT = gzipSync(Buffer.from(GZIPPED_SCRIPT_SOURCE, 'utf8'));

/**
 * A script past the per-subresource cap — the size an SPA's main chunk reaches
 * uncompressed, which is exactly the kind of site a render exists for.
 */
const OVERSIZED_SCRIPT = Buffer.alloc(RENDER_LIMITS.maxBytesPerSubresource + 4096, 'x');

let server: Server;
let baseUrl: string;
let slowRequestCount = 0;
/** Upstream requests per path — the thing a per-chain budget cannot see. */
let upstreamRequests = new Map<string, number>();

function upstreamCount(pathname: string): number {
  return upstreamRequests.get(pathname) ?? 0;
}

beforeEach(() => {
  upstreamRequests = new Map();
});

beforeAll(async () => {
  server = createServer((req, res) => {
    res.on('error', () => undefined);
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    upstreamRequests.set(url.pathname, (upstreamRequests.get(url.pathname) ?? 0) + 1);
    const chainHop = /^\/redirect-chain-(\d)$/.exec(url.pathname);
    if (chainHop !== null) {
      const remaining = Number(chainHop[1]);
      res.writeHead(302, {
        location: remaining > 1 ? `/redirect-chain-${remaining - 1}` : '/app.js',
        'content-type': 'text/plain',
      });
      res.end(HOP_BODY);
      return;
    }
    if (url.pathname === '/gzipped.js') {
      // Answers `accept-encoding: identity` with gzip anyway, as some CDNs do.
      res.writeHead(200, { 'content-type': 'text/javascript', 'content-encoding': 'gzip' });
      res.end(GZIPPED_SCRIPT);
      return;
    }
    if (url.pathname === '/broken-encoding.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'content-encoding': 'gzip' });
      res.end('this was never gzipped');
      return;
    }
    if (url.pathname === '/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'set-cookie': 'a=1' });
      res.end('window.ready = true;');
      return;
    }
    if (url.pathname === '/oversized.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(OVERSIZED_SCRIPT);
      return;
    }
    if (url.pathname === '/binary.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(BINARY_SCRIPT);
      return;
    }
    if (url.pathname === '/redirect-to-private') {
      res.writeHead(302, { location: '/private/secret.js' });
      res.end();
      return;
    }
    if (url.pathname === '/redirect-to-app') {
      res.writeHead(302, { location: '/app.js' });
      res.end();
      return;
    }
    if (url.pathname === '/redirect-loop') {
      res.writeHead(302, { location: '/redirect-loop' });
      res.end();
      return;
    }
    if (url.pathname === '/private/secret.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end('window.secret = true;');
      return;
    }
    if (url.pathname === '/slow.js') {
      slowRequestCount += 1;
      const late = setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end('window.late = true;');
      }, 120);
      res.on('close', () => clearTimeout(late));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

interface RoutedRequest {
  readonly url: string;
  readonly method?: string;
  readonly resourceType?: string;
  readonly navigation?: boolean;
}

interface FulfilledResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}

/** One intercepted browser request, and what the session decided about it. */
class FakeRoute {
  fulfilled: FulfilledResponse | null = null;
  aborted: string | null = null;
  private readonly init: Required<RoutedRequest>;

  constructor(init: RoutedRequest) {
    this.init = {
      method: 'GET',
      resourceType: init.navigation === true ? 'document' : 'script',
      navigation: false,
      ...init,
    };
  }

  request(): {
    url(): string;
    method(): string;
    resourceType(): string;
    isNavigationRequest(): boolean;
  } {
    return {
      url: () => this.init.url,
      method: () => this.init.method,
      resourceType: () => this.init.resourceType,
      isNavigationRequest: () => this.init.navigation,
    };
  }

  fulfill(response: FulfilledResponse): Promise<void> {
    this.fulfilled = response;
    return Promise.resolve();
  }

  abort(errorCode?: string): Promise<void> {
    this.aborted = errorCode ?? 'failed';
    return Promise.resolve();
  }
}

/** A browser that does nothing but hand the session its own route handler. */
function fakeChromium(settled: Promise<void>): {
  readonly module: unknown;
  dispatch(request: RoutedRequest): Promise<FakeRoute>;
  readonly initScripts: string[];
  readonly launchArgs: string[][];
} {
  let handler: ((route: FakeRoute) => Promise<void>) | null = null;
  const initScripts: string[] = [];
  const launchArgs: string[][] = [];
  const context = {
    route: (_pattern: string, routeHandler: (route: FakeRoute) => Promise<void>): Promise<void> => {
      handler = routeHandler;
      return Promise.resolve();
    },
    routeWebSocket: (): Promise<void> => Promise.resolve(),
    addInitScript: (script: string): Promise<void> => {
      initScripts.push(script);
      return Promise.resolve();
    },
    newPage: (): Promise<unknown> =>
      Promise.resolve({
        on: (): void => undefined,
        goto: (url: string): Promise<unknown> =>
          handler === null
            ? Promise.resolve(null)
            : handler(new FakeRoute({ url, navigation: true })).then(() => null),
        // A real page keeps running while its scripts fetch things; this is
        // what holds the render open until the test has driven its requests.
        waitForLoadState: (): Promise<void> => settled,
        waitForTimeout: (): Promise<void> => Promise.resolve(),
        content: (): Promise<string> => Promise.resolve('<html><body>rendered</body></html>'),
        close: (): Promise<void> => Promise.resolve(),
      }),
    close: (): Promise<void> => Promise.resolve(),
  };
  return {
    module: {
      chromium: {
        launch: (options: { args?: readonly string[] }): Promise<unknown> => {
          launchArgs.push([...(options.args ?? [])]);
          return Promise.resolve({
            version: () => '0.0.0-fake',
            newContext: () => Promise.resolve(context),
            close: () => Promise.resolve(),
          });
        },
      },
    },
    dispatch: async (request: RoutedRequest): Promise<FakeRoute> => {
      const route = new FakeRoute(request);
      if (handler === null) throw new Error('no route handler was registered');
      await handler(route);
      return route;
    },
    initScripts,
    launchArgs,
  };
}

interface Harness {
  readonly runtime: RenderRuntime;
  readonly browser: ReturnType<typeof fakeChromium>;
  render(overrides?: Partial<RenderRequest>): Promise<void>;
  /** Lets the page settle and returns what the render actually accounted for. */
  finish(): Promise<RenderOutcome>;
  /** The render's own promise, with the page still settling. */
  pending(): Promise<RenderOutcome>;
  close(): Promise<void>;
}

async function harness(overrides: Partial<RenderRequest> = {}): Promise<Harness> {
  let letPageSettle = (): void => undefined;
  const settled = new Promise<void>((resolve) => {
    letPageSettle = resolve;
  });
  const browser = fakeChromium(settled);
  const started = await startPlaywrightRuntime({
    loadModule: () => Promise.resolve(browser.module),
    dangerouslyAllowLoopback: true,
  });
  if (started.kind !== 'ready') {
    throw new Error(`fake runtime did not start: ${started.detail}`);
  }
  const runtime = started.runtime;
  let inFlight: Promise<RenderOutcome> = Promise.resolve({
    kind: 'unavailable',
    reason: 'NavigationFailed',
    detail: 'no render was started',
  });
  return {
    runtime,
    browser,
    render: async (extra: Partial<RenderRequest> = {}) => {
      inFlight = runtime.render({
        url: `${baseUrl}/`,
        userAgent: 'FluxRadarBot/0.1',
        document: { html: '<html></html>', contentType: 'text/html', status: 200 },
        ...overrides,
        ...extra,
      });
      // Let the render register its route handler and answer the navigation
      // before the test starts driving subresources.
      await new Promise((resolve) => setImmediate(resolve));
    },
    finish: async () => {
      letPageSettle();
      return await inFlight;
    },
    pending: () => inFlight,
    close: async () => {
      letPageSettle();
      await inFlight.catch(() => undefined);
      await runtime.close();
    },
  };
}

describe('render session: what a page may fetch', () => {
  it('serves the crawler’s document and refuses every other navigation', async () => {
    const test = await harness();
    await test.render();

    const elsewhere = await test.browser.dispatch({
      url: `${baseUrl}/other-page`,
      navigation: true,
    });
    expect(elsewhere.fulfilled).toBeNull();
    expect(elsewhere.aborted).toBe('blockedbyclient');
    await test.close();
  });

  it('strips set-cookie and hands the browser the bytes off the wire', async () => {
    const test = await harness();
    await test.render();

    const script = await test.browser.dispatch({ url: `${baseUrl}/binary.js` });
    expect(script.aborted).toBeNull();
    expect(script.fulfilled?.body.equals(BINARY_SCRIPT)).toBe(true);

    const cookied = await test.browser.dispatch({ url: `${baseUrl}/app.js` });
    expect(Object.keys(cookied.fulfilled?.headers ?? {})).not.toContain('set-cookie');
    await test.close();
  });

  it('re-checks every redirect hop against robots.txt', async () => {
    const test = await harness({
      isSubresourceAllowed: (url: URL) => !url.pathname.startsWith('/private/'),
    });
    await test.render();

    const blocked = await test.browser.dispatch({ url: `${baseUrl}/redirect-to-private` });
    expect(blocked.fulfilled).toBeNull();
    expect(blocked.aborted).toBe('blockedbyclient');

    const allowed = await test.browser.dispatch({ url: `${baseUrl}/redirect-to-app` });
    expect(allowed.fulfilled?.status).toBe(200);
    await test.close();
  });

  it('charges every redirect hop a request slot and the bytes it read', async () => {
    const test = await harness();
    await test.render();

    const served = await test.browser.dispatch({ url: `${baseUrl}/redirect-chain-3` });
    expect(served.fulfilled?.status).toBe(200);
    const outcome = await test.finish();
    if (outcome.kind !== 'rendered') throw new Error('the render must have produced a DOM');

    // Three redirects and the script itself are four upstream requests, and
    // every one of them was answered by the server.
    expect(upstreamCount('/redirect-chain-3')).toBe(1);
    expect(upstreamCount('/redirect-chain-2')).toBe(1);
    expect(upstreamCount('/redirect-chain-1')).toBe(1);
    expect(upstreamCount('/app.js')).toBe(1);
    expect(outcome.subresourceCount).toBe(4);
    // Each redirect carried a body that safe-fetch read under the manual
    // policy; charging only the final response would understate this 4×.
    expect(outcome.subresourceBytes).toBeGreaterThanOrEqual(HOP_BODY.length * 3);
    await test.close();
  });

  it('spends the request budget on hops, not on chains', async () => {
    // One slot short of a four-hop chain: the chain is refused rather than
    // silently allowed to overrun the cap it was checked against.
    const test = await harness();
    await test.render();

    const fillers = RENDER_LIMITS.maxSubresources - 2;
    await Promise.all(
      Array.from({ length: fillers }, (_, index) =>
        test.browser.dispatch({ url: `${baseUrl}/app.js?n=${index}` }),
      ),
    );
    const chain = await test.browser.dispatch({ url: `${baseUrl}/redirect-chain-3` });
    expect(chain.fulfilled).toBeNull();
    expect(chain.aborted).toBe('blockedbyclient');
    // The budget stopped the chain before its last hops left the process.
    expect(upstreamCount('/app.js')).toBe(fillers);
    await test.close();
  });

  it('refuses a redirect chain longer than the hop budget', async () => {
    const test = await harness();
    await test.render();

    const looped = await test.browser.dispatch({ url: `${baseUrl}/redirect-loop` });
    expect(looped.fulfilled).toBeNull();
    expect(looped.aborted).toBe('blockedbyclient');
    await test.close();
  });

  it('decodes a body the server compressed despite being asked not to', async () => {
    const test = await harness();
    await test.render();

    const script = await test.browser.dispatch({ url: `${baseUrl}/gzipped.js` });
    expect(script.aborted).toBeNull();
    // The browser gets source it can parse, not gzip bytes labelled as script.
    expect(script.fulfilled?.body.toString('utf8')).toBe(GZIPPED_SCRIPT_SOURCE);
    expect(Object.keys(script.fulfilled?.headers ?? {})).not.toContain('content-encoding');
    await test.close();
  });

  it('refuses a body larger than its allowance rather than serving the part that fit', async () => {
    // `content-length` is stripped from what reaches the browser, so a body cut
    // at the cap arrives looking complete: the page would run a script that
    // ends mid-token and every rule would then judge the DOM it produced.
    const test = await harness();
    await test.render();

    const oversized = await test.browser.dispatch({ url: `${baseUrl}/oversized.js` });
    expect(oversized.fulfilled).toBeNull();
    expect(oversized.aborted).toBe('blockedbyclient');
    const outcome = await test.finish();
    if (outcome.kind !== 'rendered') throw new Error('the render must have produced a DOM');
    // Refused by name, so the report can say the page was rendered without one
    // of the scripts that build it.
    expect(outcome.blocked).toContainEqual({ url: `${baseUrl}/oversized.js`, reason: 'budget' });
    await test.close();
  });

  it('refuses a body whose encoding it cannot decode rather than serving it raw', async () => {
    const test = await harness();
    await test.render();

    const broken = await test.browser.dispatch({ url: `${baseUrl}/broken-encoding.js` });
    expect(broken.fulfilled).toBeNull();
    expect(broken.aborted).toBe('blockedbyclient');
    const outcome = await test.finish();
    if (outcome.kind !== 'rendered') throw new Error('the render must have produced a DOM');
    expect(outcome.blocked.map((entry) => entry.reason)).toContain('encoding-not-decodable');
    await test.close();
  });

  it('keeps concurrent requests inside the request budget', async () => {
    const test = await harness();
    await test.render();

    const attempts = RENDER_LIMITS.maxSubresources + 25;
    const routes = await Promise.all(
      Array.from({ length: attempts }, (_, index) =>
        test.browser.dispatch({ url: `${baseUrl}/app.js?n=${index}` }),
      ),
    );

    const served = routes.filter((route) => route.fulfilled !== null);
    const refused = routes.filter((route) => route.aborted === 'blockedbyclient');
    expect(served).toHaveLength(RENDER_LIMITS.maxSubresources);
    expect(refused).toHaveLength(attempts - RENDER_LIMITS.maxSubresources);
    await test.close();
  });

  it('stops requesting once the scan is stopped, mid-flight included', async () => {
    let stopped = false;
    const test = await harness({ shouldStop: () => stopped });
    await test.render();

    const countBefore = slowRequestCount;
    const inFlight = test.browser.dispatch({ url: `${baseUrl}/slow.js` });
    await new Promise((resolve) => setTimeout(resolve, 20));
    stopped = true;
    const aborted = await inFlight;
    expect(aborted.fulfilled).toBeNull();
    expect(aborted.aborted).not.toBeNull();

    const afterStop = await test.browser.dispatch({ url: `${baseUrl}/slow.js` });
    expect(afterStop.aborted).toBe('blockedbyclient');
    // The request made before the stop reached the server; the one after it
    // never left the process.
    expect(slowRequestCount).toBe(countBefore + 1);
    await test.close();
  });
});

describe('render session: stopping', () => {
  it('abandons the settle wait as soon as the scan is stopped', async () => {
    // The page never goes idle here — `waitForLoadState` resolves only when the
    // harness lets it — so a render that waited out the settle phase before
    // noticing a pause would hang until the test timed out.
    let stopped = false;
    const test = await harness({ shouldStop: () => stopped });
    await test.render();

    stopped = true;
    const outcome = await test.pending();
    expect(outcome).toMatchObject({ kind: 'unavailable', reason: 'Stopped' });
    await test.close();
  }, 5_000);
});

describe('render session: how the browser is started', () => {
  it('installs the egress-removal script before any page script', async () => {
    const test = await harness();
    await test.render();

    expect(test.browser.initScripts).toHaveLength(1);
    for (const api of ['RTCPeerConnection', 'SharedWorker', 'sendBeacon', 'WebSocket', 'Worker']) {
      expect(test.browser.initScripts[0]).toContain(api);
    }
    await test.close();
  });

  it('never turns the OS sandbox off by itself', async () => {
    const test = await harness();
    await test.render();

    expect(test.browser.launchArgs.flat()).not.toContain('--no-sandbox');
    expect(test.browser.launchArgs.flat()).toContain('--disable-background-networking');
    await test.close();
  });

  it('starts the browser with no way to reach the network on its own', async () => {
    const test = await harness();
    await test.render();

    const args = test.browser.launchArgs.flat();
    // Neither a resolver nor a proxy: a channel that escaped interception —
    // including one that used a literal IP and never asked DNS — fails closed.
    expect(args).toContain('--host-resolver-rules=MAP * ~NOTFOUND');
    expect(args).toContain('--proxy-server=http://127.0.0.1:0');
    expect(args).toContain('--proxy-bypass-list=<-loopback>');
    await test.close();
  });
});

describe('RenderBudgetLedger', () => {
  it('holds bytes for a request in flight, so concurrency cannot overspend', async () => {
    const ledger = new RenderBudgetLedger(10, 1000);
    const first = await ledger.reserveBytes(600, 50);
    expect(first?.allowanceBytes).toBe(600);
    // Only 400 bytes were free while the first request was still in flight —
    // not enough for a second full response, so it waits and is then refused
    // rather than being given a sliver it would have to read a body into.
    expect(await ledger.reserveBytes(600, 50)).toBeNull();
  });

  it('never grants less than a caller asked for, so no response arrives cut short', async () => {
    const ledger = new RenderBudgetLedger(10, 1000);
    const spender = await ledger.reserveBytes(900, 50);
    if (spender === null) throw new Error('the first reservation must be granted');
    ledger.settle(spender, 900);

    // 100 bytes are left and nothing can give more back: a 600-byte response
    // cannot be read here, and saying so is the only honest answer. Granting
    // the 100 would have produced a body truncated at 100 bytes.
    expect(await ledger.reserveBytes(600, 1_000)).toBeNull();
    // What does fit is still served.
    expect(await ledger.reserveBytes(100, 50)).toEqual({ allowanceBytes: 100 });
  });

  it('gives back what a response did not use, and wakes whoever was waiting', async () => {
    const ledger = new RenderBudgetLedger(10, 1000);
    const held = await ledger.reserveBytes(800, 50);
    if (held === null) throw new Error('the first reservation must be granted');
    const queued = ledger.reserveBytes(800, 1_000);
    ledger.settle(held, 10);
    // The waiter gets the whole allowance it asked for, out of the 990 bytes
    // the settled request left behind.
    expect(await queued).toEqual({ allowanceBytes: 800 });
    expect(ledger.servedBytes).toBe(10);
  });

  it('refuses outright once the budget is spent rather than merely held', async () => {
    const ledger = new RenderBudgetLedger(10, 100);
    const reservation = await ledger.reserveBytes(100, 50);
    if (reservation === null) throw new Error('the first reservation must be granted');
    ledger.settle(reservation, 100);
    expect(await ledger.reserveBytes(10, 1_000)).toBeNull();
  });

  it('counts a request that produced nothing against the request budget', () => {
    const ledger = new RenderBudgetLedger(2, 1000);
    expect(ledger.reserveRequest()).toBe(true);
    expect(ledger.reserveRequest()).toBe(true);
    expect(ledger.reserveRequest()).toBe(false);
    expect(ledger.snapshot().remainingRequests).toBe(0);
  });

  it('gives back a slot taken for a request that never went out', () => {
    const ledger = new RenderBudgetLedger(1, 1000);
    expect(ledger.reserveRequest()).toBe(true);
    ledger.releaseRequest();
    expect(ledger.snapshot().remainingRequests).toBe(1);
    expect(ledger.reserveRequest()).toBe(true);
  });
});
