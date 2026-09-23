// The real JS rendering runtime: a headless Chromium whose every network
// request is served by safe-fetch.
//
// `context.route('**/*')` catches every HTTP request and
// `context.routeWebSocket('**/*')` catches every socket, so the traffic that
// leaves this process goes through the same SSRF guard, DNS pinning and
// redirect handling as the static crawl. That is also why an installed-but-old
// Playwright is refused rather than used: without `routeWebSocket` a page could
// open a socket we do not control.
//
// This is containment that fails closed, not a proof that Chromium has no path
// we have not thought of: the browser is additionally started with no resolver
// and a dead proxy (`--host-resolver-rules=MAP * ~NOTFOUND`,
// `--proxy-server=http://127.0.0.1:0`), so a channel that escaped interception
// cannot connect to anything either.

import { RENDER_LIMITS } from '@fluxradar/contracts';
import type { SafeFetchResult } from '@fluxradar/safe-fetch';
import { responseBytes, safeFetch } from '@fluxradar/safe-fetch';

import { HARDENED_CHROMIUM_ARGS, RENDER_ISOLATION_SCRIPT } from './isolation.js';
import type { Browser, Page, PlaywrightModule, Route } from './playwright-api.js';
import { asPlaywrightModule } from './playwright-api.js';
import type { DecodedBody } from './request-policy.js';
import {
  RenderBudgetLedger,
  decodeSubresourceBody,
  renderRequestHeaders,
  sanitizeResponseHeaders,
  subresourceVerdict,
} from './request-policy.js';
import type {
  BlockedRequest,
  RenderOutcome,
  RenderRequest,
  RenderRuntime,
  RenderRuntimeResult,
} from './types.js';

export interface PlaywrightRuntimeOptions {
  /** Extra Chromium flags a container needs (e.g. `--no-sandbox` in Docker). */
  readonly launchArgs?: readonly string[];
  /** Browser binary, when it is not where Playwright installed it. */
  readonly executablePath?: string;
  /** Test seam: supplies the module instead of importing it. */
  readonly loadModule?: () => Promise<unknown>;
  /** Passthrough to safe-fetch for the local fixture site only. */
  readonly dangerouslyAllowLoopback?: boolean;
}

/** How often a render checks whether the scan it belongs to has been stopped. */
const STOP_POLL_MS = 100;

/**
 * Starts a browser, or explains why there is none.
 *
 * Nothing here falls back to static HTML: a caller that asked for a rendered
 * DOM and did not get one has to report that, and it cannot do so if this
 * function quietly succeeds with something else.
 */
export async function startPlaywrightRuntime(
  options: PlaywrightRuntimeOptions = {},
): Promise<RenderRuntimeResult> {
  const loaded = await loadPlaywright(options.loadModule);
  if (loaded.kind === 'unavailable') return loaded;
  let browser: Browser;
  try {
    browser = await loaded.module.chromium.launch({
      headless: true,
      args: [...HARDENED_CHROMIUM_ARGS, ...(options.launchArgs ?? [])],
      ...(options.executablePath !== undefined ? { executablePath: options.executablePath } : {}),
      timeout: RENDER_LIMITS.navigationTimeoutMs,
    });
  } catch (error) {
    return {
      kind: 'unavailable',
      reason: 'RuntimeUnavailable',
      detail: `chromium could not be launched: ${messageOf(error)}`,
    };
  }
  const probe = await browser.newContext(contextOptionsFor('FluxRadarBot/0.1'));
  const supportsWebSocketRouting = typeof probe.routeWebSocket === 'function';
  await probe.close();
  if (!supportsWebSocketRouting) {
    await browser.close();
    return {
      kind: 'unavailable',
      reason: 'RuntimeTooOld',
      detail:
        'the installed Playwright cannot intercept WebSocket traffic (routeWebSocket is missing); ' +
        'rendering is refused rather than run with uncontrolled sockets',
    };
  }
  return {
    kind: 'ready',
    runtime: new PlaywrightRenderRuntime(browser, options.dangerouslyAllowLoopback ?? false),
  };
}

type PlaywrightLoad =
  | { readonly kind: 'loaded'; readonly module: PlaywrightModule }
  | {
      readonly kind: 'unavailable';
      readonly reason: 'RuntimeNotInstalled';
      readonly detail: string;
    };

async function loadPlaywright(
  loadModule: (() => Promise<unknown>) | undefined,
): Promise<PlaywrightLoad> {
  let raw: unknown;
  try {
    if (loadModule !== undefined) {
      raw = await loadModule();
    } else {
      // A variable specifier: `playwright` is an optional dependency, so this
      // file must compile and run where it was never installed.
      const specifier = 'playwright';
      raw = await import(specifier);
    }
  } catch (error) {
    return {
      kind: 'unavailable',
      reason: 'RuntimeNotInstalled',
      detail: `the optional "playwright" dependency is not installed: ${messageOf(error)}`,
    };
  }
  const module = asPlaywrightModule(raw);
  if (module === null) {
    return {
      kind: 'unavailable',
      reason: 'RuntimeNotInstalled',
      detail: 'the resolved "playwright" module does not expose a chromium browser type',
    };
  }
  return { kind: 'loaded', module };
}

function contextOptionsFor(userAgent: string) {
  return {
    userAgent,
    javaScriptEnabled: true,
    // A render never accepts a file, never carries a cookie jar, never bypasses
    // the site's own CSP and never accepts an invalid certificate.
    acceptDownloads: false,
    bypassCSP: false,
    ignoreHTTPSErrors: false,
    serviceWorkers: 'block',
    extraHTTPHeaders: {},
    permissions: [],
  } as const;
}

class PlaywrightRenderRuntime implements RenderRuntime {
  readonly engine = 'chromium';
  readonly version: string;
  private readonly browser: Browser;
  private readonly allowLoopback: boolean;
  private closed = false;

  constructor(browser: Browser, allowLoopback: boolean) {
    this.browser = browser;
    this.version = browser.version();
    this.allowLoopback = allowLoopback;
  }

  async render(request: RenderRequest): Promise<RenderOutcome> {
    if (this.closed) {
      return {
        kind: 'unavailable',
        reason: 'RuntimeUnavailable',
        detail: 'runtime already closed',
      };
    }
    if (request.shouldStop?.() === true) {
      return {
        kind: 'unavailable',
        reason: 'Stopped',
        detail: 'the scan stopped before rendering',
      };
    }
    const startedAt = Date.now();
    // One context per page: no cookie, storage or cache crosses between two
    // pages of the same crawl, so nothing a first page sets can change what a
    // second page renders.
    const context = await this.browser.newContext(contextOptionsFor(request.userAgent));
    const session = new RenderSession(request, this.allowLoopback);
    try {
      // Before the route handler, because a script that runs before the init
      // script could open a channel the route handler never sees.
      await context.addInitScript(RENDER_ISOLATION_SCRIPT);
      await context.route('**/*', (route) => session.handle(route));
      await context.routeWebSocket?.('**/*', (socket) => {
        session.recordBlocked(socket.url?.() ?? request.url, 'websocket-blocked');
        socket.close({ code: 1008, reason: 'websocket traffic is not permitted during a render' });
      });
      const page = await context.newPage();
      attachPageGuards(page);
      return await session.run(page, startedAt);
    } catch (error) {
      return {
        kind: 'unavailable',
        reason: 'NavigationFailed',
        detail: messageOf(error),
      };
    } finally {
      session.abandon();
      await context.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.browser.close().catch(() => undefined);
  }
}

/** Dialogs, popups and downloads are dismissed rather than waited on. */
function attachPageGuards(page: Page): void {
  page.on('dialog', (dialog) => void dialog.dismiss().catch(() => undefined));
  page.on('popup', (popup) => void popup.close().catch(() => undefined));
  page.on('download', (download) => void download.cancel().catch(() => undefined));
}

/** One page render: its budgets, its refusals and the DOM it ended with. */
class RenderSession {
  private readonly request: RenderRequest;
  private readonly allowLoopback: boolean;
  private readonly blocked: BlockedRequest[] = [];
  private readonly ledger = new RenderBudgetLedger(
    RENDER_LIMITS.maxSubresources,
    RENDER_LIMITS.maxSubresourceBytes,
  );
  /**
   * Aborted the moment the scan is stopped. Every outbound request of this
   * render carries it, so a pause reaches a fetch that is already on the wire
   * instead of only the ones that have not started.
   */
  private readonly abandoned = new AbortController();
  /** The main document is served from the body the crawler already fetched. */
  private documentServed = false;

  constructor(request: RenderRequest, allowLoopback: boolean) {
    this.request = request;
    this.allowLoopback = allowLoopback;
  }

  async run(page: Page, startedAt: number): Promise<RenderOutcome> {
    // Navigation has its own timeout, but a pause must not have to wait for it:
    // closing the page is what turns "stop asking" into an actual stop while a
    // document is still loading. The watch covers the settle phase too — that
    // is another three seconds of the page's own scripts running, and a pause
    // that only reached the navigation would sit through all of it.
    const watch = this.watchForStop(() => void page.close().catch(() => undefined));
    try {
      try {
        await page.goto(this.request.url, {
          waitUntil: 'domcontentloaded',
          timeout: RENDER_LIMITS.navigationTimeoutMs,
        });
      } catch (error) {
        return this.isStopped()
          ? {
              kind: 'unavailable',
              reason: 'Stopped',
              detail: 'the scan was stopped mid-navigation',
            }
          : {
              kind: 'unavailable',
              reason: isTimeout(error) ? 'NavigationTimeout' : 'NavigationFailed',
              detail: messageOf(error),
            };
      }
      // The page's own scripts are what a render exists to run, so it waits for
      // them to go quiet — but never past the budget, and never past a pause.
      await Promise.race([
        page
          .waitForLoadState('networkidle', { timeout: RENDER_LIMITS.settleMs * 4 })
          .catch(() => undefined),
        watch.stopped,
      ]);
      await Promise.race([
        page.waitForTimeout(RENDER_LIMITS.settleMs).catch(() => undefined),
        watch.stopped,
      ]);
      if (this.isStopped()) {
        return {
          kind: 'unavailable',
          reason: 'Stopped',
          detail: 'the scan was stopped mid-render',
        };
      }
      const html = await page.content();
      return {
        kind: 'rendered',
        html,
        subresourceCount: this.ledger.servedRequests,
        subresourceBytes: this.ledger.servedBytes,
        blocked: this.blocked,
        timingMs: Date.now() - startedAt,
      };
    } finally {
      watch.close();
    }
  }

  recordBlocked(url: string, reason: BlockedRequest['reason']): void {
    if (this.blocked.length >= RENDER_LIMITS.maxSubresources) return;
    this.blocked.push({ url, reason });
  }

  /** Releases whatever this render still had in flight. */
  abandon(): void {
    if (!this.abandoned.signal.aborted) this.abandoned.abort();
  }

  /** Serves one browser request, or refuses it with a named reason. */
  async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = request.url();
    if (this.isStopped()) {
      this.abandon();
      this.recordBlocked(url, 'stopped');
      await route.abort('blockedbyclient');
      return;
    }
    if (request.isNavigationRequest()) {
      const verdict = await this.handleNavigation(route, url);
      // 'fetch' — this is the page we were asked to render and no body was
      // supplied, so it is fetched below like any other guarded request.
      if (verdict !== 'fetch') return;
    }
    const verdict = subresourceVerdict(
      { url, method: request.method(), resourceType: request.resourceType() },
      this.ledger.snapshot(),
    );
    if (!verdict.allowed) {
      this.recordBlocked(url, verdict.reason);
      await route.abort('blockedbyclient');
      return;
    }
    if (!(await this.isAllowedTarget(verdict.url))) {
      this.recordBlocked(url, 'robots-disallowed');
      await route.abort('blockedbyclient');
      return;
    }
    await this.fetchAndFulfil(route, verdict.url, request.method().toUpperCase() === 'HEAD');
  }

  /**
   * Decides what happens to a navigation.
   *
   * Exactly one navigation is legitimate: the page the crawl asked for. It is
   * answered from the body the crawler already read, so the site is not asked
   * for every page twice — once for the rules and once for the browser — with
   * the two readings free to disagree. Every other navigation is refused: a
   * redirect, a `location.href`, a popup or a frame would all make the browser
   * read a URL the crawl's scope and robots handling never approved.
   */
  private async handleNavigation(
    route: Route,
    url: string,
  ): Promise<'served' | 'blocked' | 'fetch'> {
    if (this.documentServed || url !== this.request.url) {
      this.recordBlocked(url, 'navigation-blocked');
      await route.abort('blockedbyclient');
      return 'blocked';
    }
    this.documentServed = true;
    const document = this.request.document;
    if (document === undefined) return 'fetch';
    await route.fulfill({
      status: document.status,
      headers: { 'content-type': document.contentType },
      body: Buffer.from(document.html, 'utf8'),
    });
    return 'served';
  }

  private async fetchAndFulfil(route: Route, url: URL, headOnly: boolean): Promise<void> {
    const outcome = await this.fetchFollowingGuardedRedirects(url, headOnly);
    if (outcome.kind === 'blocked') {
      this.recordBlocked(url.href, outcome.reason);
      await route.abort('blockedbyclient');
      return;
    }
    if (outcome.kind === 'failed') {
      // An SSRF refusal and an unreachable host are both "the browser does not
      // get this resource"; they are recorded apart so a report can tell a
      // blocked private address from a broken CDN.
      this.recordBlocked(url.href, isSsrfBlocked(outcome.error) ? 'ssrf-blocked' : 'fetch-failed');
      await route.abort('failed');
      return;
    }
    if (this.isStopped()) {
      // The answer arrived after the scan was stopped: it is dropped rather
      // than handed to a page that is about to be thrown away anyway.
      this.recordBlocked(url.href, 'stopped');
      await route.abort('blockedbyclient');
      return;
    }
    await route.fulfill({
      status: outcome.result.status,
      headers: sanitizeResponseHeaders(outcome.result.headers),
      body: outcome.body,
    });
  }

  /**
   * Fetches a subresource, applying the render policy to every redirect hop.
   *
   * safe-fetch can follow redirects itself, but then only the *first* URL was
   * ever checked against robots.txt and the resource-kind rules — a site could
   * point a script at anything and have the browser receive it. So each hop is
   * resolved here and vetted exactly like the request that started the chain.
   *
   * Every hop is also *paid for* separately. A chain is not one request: with
   * `redirectPolicy: 'manual'` safe-fetch reads each 3xx body too, so charging
   * the chain once would let one subresource make four upstream requests and
   * read four full allowances against budgets that claim to cap both.
   */
  private async fetchFollowingGuardedRedirects(
    start: URL,
    headOnly: boolean,
  ): Promise<ChainOutcome> {
    const method = headOnly ? 'HEAD' : 'GET';
    let current = start;
    for (let hop = 0; hop <= RENDER_LIMITS.maxSubresourceRedirects; hop += 1) {
      const attempt = await this.fetchOneHop(current, method);
      if (attempt.kind !== 'response') return attempt;
      const { result } = attempt;
      const location = redirectLocation(result.status, result.headers);
      if (location === null) {
        return attempt.body.kind === 'undecodable'
          ? { kind: 'blocked', reason: 'encoding-not-decodable' }
          : { kind: 'response', result, body: attempt.body.bytes };
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { kind: 'blocked', reason: 'url-not-allowed' };
      }
      const verdict = subresourceVerdict(
        { url: next.href, method, resourceType: 'fetch' },
        this.ledger.snapshot(),
      );
      if (!verdict.allowed) return { kind: 'blocked', reason: verdict.reason };
      if (!(await this.isAllowedTarget(verdict.url))) {
        return { kind: 'blocked', reason: 'robots-disallowed' };
      }
      current = verdict.url;
    }
    return { kind: 'blocked', reason: 'redirect-not-allowed' };
  }

  /**
   * One upstream request: its own request slot, its own byte reservation, and
   * a settle that books what it actually read — including a hop whose body was
   * a redirect nobody wanted and a hop that failed after reading part of one.
   */
  private async fetchOneHop(url: URL, method: 'GET' | 'HEAD'): Promise<HopOutcome> {
    // The request slot is taken first and synchronously: it is the cap that has
    // to hold no matter how many requests the page fires at once.
    if (!this.ledger.reserveRequest()) return { kind: 'blocked', reason: 'budget' };
    const reservation = await this.ledger.reserveBytes(
      RENDER_LIMITS.maxBytesPerSubresource,
      RENDER_LIMITS.navigationTimeoutMs,
    );
    if (reservation === null) {
      // Nothing went out, so the slot was never spent.
      this.ledger.releaseRequest();
      return { kind: 'blocked', reason: 'budget' };
    }
    let chargedBytes = 0;
    try {
      const result = await safeFetch(url.href, {
        method,
        headers: renderRequestHeaders(this.request.userAgent),
        maxBodyBytes: reservation.allowanceBytes,
        timeoutMs: RENDER_LIMITS.navigationTimeoutMs,
        dangerouslyAllowLoopback: this.allowLoopback,
        redirectPolicy: 'manual',
        signal: this.abandoned.signal,
      });
      const wireBytes = responseBytes(result);
      chargedBytes = wireBytes.byteLength;
      if (redirectLocation(result.status, result.headers) !== null) {
        // A redirect body is never handed to anyone, so it is not decoded —
        // but it was read off the wire, and that is what is charged.
        return { kind: 'response', result, body: { kind: 'decoded', bytes: wireBytes } };
      }
      if (result.truncated) {
        // The resource is larger than the bytes this page may spend on one. The
        // part that arrived is not a smaller version of it: `content-length` is
        // stripped, so the browser would take a script cut mid-token for the
        // whole file and build a DOM out of what half of it did. Refused by
        // name, exactly like a body whose encoding cannot be decoded.
        return { kind: 'blocked', reason: 'budget' };
      }
      const body = decodeSubresourceBody(result.headers, wireBytes, reservation.allowanceBytes);
      // Compression can hand the browser far more than came off the wire, so
      // the budget is charged the larger of the two.
      if (body.kind === 'decoded') chargedBytes = Math.max(chargedBytes, body.bytes.byteLength);
      return { kind: 'response', result, body };
    } catch (error) {
      return { kind: 'failed', error };
    } finally {
      this.ledger.settle(reservation, chargedBytes);
    }
  }

  /** robots.txt and the crawl's own opinion about one absolute target. */
  private async isAllowedTarget(url: URL): Promise<boolean> {
    return (await this.request.isSubresourceAllowed?.(url)) ?? true;
  }

  private isStopped(): boolean {
    return this.request.shouldStop?.() === true;
  }

  private watchForStop(onStop: () => void): StopWatch {
    let announceStop: (() => void) | undefined;
    const stopped = new Promise<void>((resolve) => {
      announceStop = resolve;
    });
    const timer = setInterval(() => {
      if (!this.isStopped()) return;
      clearInterval(timer);
      this.abandon();
      onStop();
      announceStop?.();
    }, STOP_POLL_MS);
    timer.unref();
    return { stopped, close: () => clearInterval(timer) };
  }
}

/** A poll for "the scan stopped", plus a promise anything waiting can race. */
interface StopWatch {
  readonly stopped: Promise<void>;
  close(): void;
}

/** One upstream request of a subresource chain, already charged to the budget. */
type HopOutcome =
  | { readonly kind: 'response'; readonly result: SafeFetchResult; readonly body: DecodedBody }
  | { readonly kind: 'blocked'; readonly reason: BlockedRequest['reason'] }
  | { readonly kind: 'failed'; readonly error: unknown };

/** What a whole subresource chain produced, after every hop was vetted. */
type ChainOutcome =
  | { readonly kind: 'response'; readonly result: SafeFetchResult; readonly body: Buffer }
  | { readonly kind: 'blocked'; readonly reason: BlockedRequest['reason'] }
  | { readonly kind: 'failed'; readonly error: unknown };

/** The `Location` of a redirect response, or null when it is not one. */
function redirectLocation(
  status: number,
  headers: Readonly<Record<string, string>>,
): string | null {
  if (status < 300 || status >= 400) return null;
  const location = headers.location;
  return location === undefined || location === '' ? null : location;
}

function isSsrfBlocked(error: unknown): boolean {
  return error instanceof Error && error.name === 'SsrfBlockedError';
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && /timeout/i.test(error.message);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
