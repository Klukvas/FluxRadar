// The render runtime against a real browser and a real client-rendered page.
//
// Everything else about rendering can be tested with a fake browser; this
// cannot. A DOM that only exists after the page's own scripts ran, a script
// served to the browser through safe-fetch, and the egress APIs actually being
// gone inside the page are three claims that are only worth anything when an
// engine has actually executed them.
//
// The suite is skipped — loudly, with the reason in the name — when no Chromium
// is installed, because a render that cannot run must be reported as
// unavailable rather than imagined.

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { crawl } from '../crawler.js';
import { startFixtureSite, type FixtureSite } from '../fixture-server.js';
import { startPlaywrightRuntime } from './playwright-runtime.js';
import type { RenderRuntime } from './types.js';

/**
 * Chromium binaries a developer machine or CI image is likely to already have.
 *
 * Playwright's own download is tried first (`undefined` = whatever it
 * installed); the rest are read-only system installs we may drive but never
 * modify.
 */
const CHROMIUM_CANDIDATES: readonly (string | undefined)[] = [
  undefined,
  process.env.FLUXRADAR_RENDER_CHROMIUM_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const loadPlaywright = (): Promise<unknown> => import('@playwright/test');

async function startAnyChromium(): Promise<RenderRuntime | null> {
  for (const executablePath of CHROMIUM_CANDIDATES) {
    if (executablePath !== undefined && !existsSync(executablePath)) continue;
    const started = await startPlaywrightRuntime({
      loadModule: loadPlaywright,
      dangerouslyAllowLoopback: true,
      ...(executablePath !== undefined ? { executablePath } : {}),
    });
    if (started.kind === 'ready') return started.runtime;
  }
  return null;
}

const runtime = await startAnyChromium();

/** Egress constructors probed in every realm the document reaches into. */
const EGRESS_APIS = ['RTCPeerConnection', 'SharedWorker', 'EventSource', 'WebTransport'];

/**
 * A page that asks two realms the init script does not reach what they kept.
 *
 * A dedicated worker started from a blob and an `about:blank` iframe are the
 * two standard ways out of a hardened main realm, so the page itself reports
 * from inside both. Asserting on their own answer is the point: a control that
 * silently did not apply looks exactly like one that did, from the outside.
 */
function escapeProbeDocument(origin: string): string {
  const probe = `(scope) => ${JSON.stringify(EGRESS_APIS)}.filter((name) => {
    const api = scope[name];
    if (typeof api !== 'function') return false;
    try {
      Reflect.construct(api, ['https://example.invalid/']);
    } catch (error) {
      return !String(error && error.message).includes('FluxRadar');
    }
    return true;
  })`;
  const workerSource = `
    const reachable = (${probe})(self);
    fetch(${JSON.stringify(`${origin}/robots.txt`)})
      .then((response) => response.status)
      .catch(() => 'failed')
      .then((status) => postMessage({ reachable, status }));
  `;
  return `<!DOCTYPE html><html lang="en"><body><div id="probe"></div><script>
    (async () => {
      const probe = document.getElementById('probe');
      const blobUrl = URL.createObjectURL(
        new Blob([${JSON.stringify(workerSource)}], { type: 'text/javascript' }),
      );
      const worker = new Worker(blobUrl);
      const report = await new Promise((resolve) => {
        worker.addEventListener('message', (event) => resolve(event.data));
        setTimeout(() => resolve({ reachable: ['worker-never-answered'], status: 'timeout' }), 4000);
      });
      probe.dataset.workerEgress = report.reachable.join(',');
      probe.dataset.workerFetch = String(report.status);
      const frame = document.createElement('iframe');
      document.body.appendChild(frame);
      probe.dataset.frameEgress = (${probe})(frame.contentWindow).join(',');
      probe.dataset.probeDone = 'yes';
    })();
  </script></body></html>`;
}

describe('render runtime: no browser installed', () => {
  it('says so explicitly instead of returning something that renders nothing', async () => {
    const result = await startPlaywrightRuntime({
      loadModule: () => Promise.reject(new Error('Cannot find package "playwright"')),
    });
    expect(result).toMatchObject({ kind: 'unavailable', reason: 'RuntimeNotInstalled' });
  });

  it('refuses a runtime too old to intercept websocket traffic', async () => {
    const result = await startPlaywrightRuntime({
      loadModule: () =>
        Promise.resolve({
          chromium: {
            launch: () =>
              Promise.resolve({
                version: () => '1.0',
                newContext: () =>
                  Promise.resolve({
                    route: () => Promise.resolve(),
                    addInitScript: () => Promise.resolve(),
                    newPage: () => Promise.resolve({}),
                    close: () => Promise.resolve(),
                  }),
                close: () => Promise.resolve(),
              }),
          },
        }),
    });
    expect(result).toMatchObject({ kind: 'unavailable', reason: 'RuntimeTooOld' });
  });
});

describe.skipIf(runtime === null)('render runtime: real chromium on a real SPA', () => {
  it('reads the DOM the page built, not the shell it was served', async () => {
    if (runtime === null) return;
    let site: FixtureSite | null = null;
    try {
      site = await startFixtureSite();
      const result = await crawl(
        {
          origin: site.origin,
          includeSubdomains: false,
          maxPages: 20,
          maxDepth: 1,
          renderJs: true,
          seedUrls: [`${site.origin}/spa.html`],
        },
        {
          renderRuntime: { kind: 'ready', runtime },
          dangerouslyAllowLoopback: true,
          logger: { warn: () => undefined },
        },
      );

      const spa = result.pages.find((page) => page.normalizedUrl.endsWith('/spa.html'));
      expect(spa?.rendering).toMatchObject({ status: 'Rendered' });
      // The shell has none of this: it is an empty <div id="app">.
      expect(spa?.html).toContain('data-rendered="yes"');
      expect(spa?.html).toContain('This paragraph exists only after the page scripts have run.');
      expect(spa?.html).toContain('Rendered Shell');
      // The script reached the browser through our own fetch, not the browser's.
      expect(spa?.rendering).toMatchObject({ status: 'Rendered', subresourceCount: 1 });
      // A link that only exists in the rendered DOM is followed like any other.
      expect(result.pages.map((page) => page.normalizedUrl)).toContain(
        `${site.origin}/spa-linked.html`,
      );
      expect(result.rendering).toMatchObject({
        status: 'Rendered',
        engine: 'chromium',
        failedPages: 0,
      });
    } finally {
      await site?.close();
    }
  }, 60_000);

  it('leaves the page without the APIs that egress outside an HTTP route', async () => {
    if (runtime === null) return;
    let site: FixtureSite | null = null;
    try {
      site = await startFixtureSite();
      const outcome = await runtime.render({
        url: `${site.origin}/spa.html`,
        userAgent: 'FluxRadarBot/0.1',
      });
      expect(outcome.kind).toBe('rendered');
      if (outcome.kind !== 'rendered') return;
      // The page itself reports what it could still reach, so this asserts on
      // the browser's own view rather than on our intent.
      expect(outcome.html).toContain(
        'data-egress-blocked="RTCPeerConnection,SharedWorker,EventSource,WebTransport"',
      );
      expect(outcome.html).toContain('data-beacon-refused="true"');
      // A socket is routed rather than removed, so the refusal is ours to show.
      expect(outcome.blocked.map((entry) => entry.reason)).toContain('websocket-blocked');
      expect(outcome.blocked.map((entry) => entry.url)).toContainEqual(
        expect.stringContaining('/live'),
      );
    } finally {
      await site?.close();
    }
  }, 60_000);

  it('leaves a blob worker and an about:blank frame without those APIs either', async () => {
    if (runtime === null) return;
    let site: FixtureSite | null = null;
    try {
      site = await startFixtureSite();
      const outcome = await runtime.render({
        url: `${site.origin}/escape.html`,
        userAgent: 'FluxRadarBot/0.1',
        document: {
          html: escapeProbeDocument(site.origin),
          contentType: 'text/html; charset=utf-8',
          status: 200,
        },
      });
      expect(outcome.kind).toBe('rendered');
      if (outcome.kind !== 'rendered') return;
      expect(outcome.html).toContain('data-probe-done="yes"');
      // Both realms report *nothing* still reachable. A realm the controls
      // missed would list the APIs it kept.
      expect(outcome.html).toContain('data-worker-egress=""');
      expect(outcome.html).toContain('data-frame-egress=""');
      // And the worker's own HTTP goes through the render's fetch, not the
      // browser's: a request the route handler never saw could not be served.
      expect(outcome.html).toContain('data-worker-fetch="200"');
      expect(outcome.subresourceCount).toBeGreaterThanOrEqual(1);
    } finally {
      await site?.close();
    }
  }, 60_000);

  it('refuses to navigate anywhere the crawl did not send it', async () => {
    if (runtime === null) return;
    let site: FixtureSite | null = null;
    try {
      site = await startFixtureSite();
      const outcome = await runtime.render({
        url: `${site.origin}/redirect-a`,
        userAgent: 'FluxRadarBot/0.1',
        document: {
          html: '<html><body><script>location.href="/orphan.html"</script></body></html>',
          contentType: 'text/html; charset=utf-8',
          status: 200,
        },
      });
      if (outcome.kind !== 'rendered') {
        // A blocked navigation can also end the render outright; both outcomes
        // are honest, and neither may show the other page's content.
        expect(outcome.reason).toBe('NavigationFailed');
        return;
      }
      expect(outcome.html).not.toContain('Orphan');
      expect(outcome.blocked.map((entry) => entry.reason)).toContain('navigation-blocked');
    } finally {
      await site?.close();
    }
  }, 60_000);
});
