// What the cookieless count may and may not do.
//
// Plausible is the one analytics here that runs without being allowed, so the
// promises the Cookie Policy makes for it are not "we asked first" but "there
// is nothing to ask about": nothing is written to the device, and nothing that
// identifies a page's reader leaves the browser. Those are the two things this
// file holds, next to the host gate that keeps the tracker out of tests, a
// local build and a preview.
//
// The address is the sharp edge. `/scans/<id>` names a customer's audit,
// a password-reset link puts a one-time token in the query, and a Google Ads
// click id belongs to GA4 alone. Every assertion about the sent URL below is
// really an assertion that none of those three ever reach Plausible.
//
// The script's automatic captures are the same edge from the other side. They
// are switched on in the Plausible dashboard and compiled into the script it
// serves, so they can arrive without a commit here, and the outbound-link one
// reports `props.url`: the clicked href whole. A report page links out to the
// audited site. Both halves of the answer are asserted below — the four
// captures turned off through `init`, and `transformRequest` refusing every
// event that is not a page view.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ANALYTICS_HOSTNAME } from './analytics-config';
import {
  PLAUSIBLE_EVENT_PATH,
  PLAUSIBLE_SCRIPT_PATH,
  PLAUSIBLE_SITE_SCRIPT,
  PLAUSIBLE_SITE_SCRIPT_PLACEHOLDER,
  plausibleConfigured,
  plausibleSiteScriptProblem,
  plausibleUpstreamScriptPath,
} from './plausible-config';
import {
  PLAUSIBLE_SCRIPT_ID,
  resetPlausibleForTests,
  startPlausible,
  trackPlausiblePageView,
} from './plausible';

/** One queued or delivered call, as `plausible(...)` received it. */
type Call = readonly unknown[];

/**
 * A tracker that has "loaded": it replaces the queueing stub exactly as the
 * real script does, so a page view sent after load is observed directly.
 */
function installLoadedTracker(): Call[] {
  const calls: Call[] = [];
  const queued = (window.plausible?.q ?? []) as Call[];
  calls.push(...queued);
  const tracker = ((...args: unknown[]) => {
    calls.push(args);
  }) as NonNullable<typeof window.plausible>;
  tracker.init = () => {};
  tracker.o = window.plausible?.o;
  window.plausible = tracker;
  return calls;
}

/** Every call the module made, whether it was queued or delivered. */
function allCalls(): Call[] {
  return (window.plausible?.q ?? []) as Call[];
}

function pageViews(calls: readonly Call[]): readonly string[] {
  return calls
    .filter((call) => call[0] === 'pageview')
    .map((call) => (call[1] as { readonly url?: string } | undefined)?.url ?? '');
}

function visit(url: string): void {
  (window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL(url);
}

const PRODUCTION = `https://${ANALYTICS_HOSTNAME}`;

beforeEach(() => {
  resetPlausibleForTests();
  visit(`${PRODUCTION}/`);
});

afterEach(() => {
  resetPlausibleForTests();
  visit('http://localhost:3000/');
  vi.restoreAllMocks();
});

describe('the site script id', () => {
  // The fluxradar.net site, filled in on 28 October 2026. DEPLOY-023 holds the
  // Caddyfile rewrite and the blog's own copy to this same value; what is
  // asserted here is only that the build counts at all, which going back to the
  // placeholder would quietly turn off.
  it('is the site this build counts into rather than the placeholder', () => {
    expect(PLAUSIBLE_SITE_SCRIPT).not.toBe(PLAUSIBLE_SITE_SCRIPT_PLACEHOLDER);
    expect(plausibleSiteScriptProblem(PLAUSIBLE_SITE_SCRIPT)).toBeNull();
    expect(plausibleConfigured()).toBe(true);
  });

  // The placeholder is "not set up", which is allowed; a filled-in id that is
  // wrong is a broken site, and vite.config.ts refuses to build it.
  it('reports no problem while unset, and names a half-pasted value', () => {
    expect(plausibleSiteScriptProblem(PLAUSIBLE_SITE_SCRIPT_PLACEHOLDER)).toBeNull();
    expect(plausibleSiteScriptProblem('pa-7Ab3Kd9')).toBeNull();

    expect(plausibleSiteScriptProblem('https://plausible.io/js/pa-7Ab3Kd9.js')).toMatch(/URL/);
    expect(plausibleSiteScriptProblem('pa-7Ab3Kd9.js')).toMatch(/\.js/);
    expect(plausibleSiteScriptProblem('G-0N0B548CGE')).toMatch(/pa-/);
    expect(plausibleSiteScriptProblem('pa-')).toMatch(/4 to 64/);
    expect(plausibleSiteScriptProblem(' pa-7Ab3Kd9 ')).toMatch(/whitespace/);
  });

  it('names the upstream file the proxy rewrites to', () => {
    expect(plausibleUpstreamScriptPath('pa-7Ab3Kd9')).toBe('/js/pa-7Ab3Kd9.js');
  });

  // The event path must stay out of the API's namespace: `/api/*` is forwarded
  // to the backend with the prefix stripped, and Caddy orders a named matcher
  // by position rather than specificity, so an `/api/event` of ours would be
  // one block move away from being answered by our own API instead.
  it('keeps the first-party paths first-party and off /api/', () => {
    expect(PLAUSIBLE_SCRIPT_PATH.startsWith('/')).toBe(true);
    expect(PLAUSIBLE_EVENT_PATH.startsWith('/')).toBe(true);
    expect(PLAUSIBLE_EVENT_PATH.startsWith('/api/')).toBe(false);
  });
});

describe('the loader', () => {
  // The off switch, exercised by handing the loader the placeholder: a build
  // without a Plausible site of its own requests no script and leaves no
  // tracker behind, rather than asking for a file that 404s on every page.
  it('requests nothing at all when the script id is the placeholder', () => {
    startPlausible(PLAUSIBLE_SITE_SCRIPT_PLACEHOLDER);

    expect(document.getElementById(PLAUSIBLE_SCRIPT_ID)).toBeNull();
    expect(window.plausible).toBeUndefined();
  });

  it('writes no cookie and no storage key of its own', () => {
    const cookiesBefore = document.cookie;
    const storageBefore = { ...window.localStorage };

    startPlausible();
    trackPlausiblePageView();

    expect(document.cookie).toBe(cookiesBefore);
    expect({ ...window.localStorage }).toEqual(storageBefore);
  });
});

// A site script id of this file's own, so these assertions go on holding
// whatever id the build ships. Everything else — the cleaning, the host gate,
// the dedupe — is the module exactly as it ships.
describe('a configured build', () => {
  const SITE_SCRIPT = 'pa-7Ab3Kd9';

  /** The tracker's own hook, called as the script calls it. Null means "drop". */
  function transform(payload: Record<string, unknown>): Record<string, unknown> | null {
    const options = window.plausible?.o;
    if (options?.transformRequest === undefined) {
      expect.unreachable('the tracker was configured without a transformRequest');
    }
    return options.transformRequest(payload) as Record<string, unknown> | null;
  }

  it('loads the tracker from this origin and turns automatic page views off', () => {
    startPlausible(SITE_SCRIPT);

    const script = document.getElementById(PLAUSIBLE_SCRIPT_ID);
    expect(script?.getAttribute('src')).toBe(PLAUSIBLE_SCRIPT_PATH);
    expect(script?.getAttribute('async')).not.toBeNull();
    // Nothing third-party: a `script-src` of `'self'` has to be enough, which
    // is what lets deploy/Caddyfile keep the policy unchanged (DEPLOY-023).
    expect(script?.getAttribute('src')).not.toMatch(/plausible\.io/);
    expect(window.plausible?.o?.autoCapturePageviews).toBe(false);
    expect(window.plausible?.o?.endpoint).toBe(PLAUSIBLE_EVENT_PATH);
  });

  it.each([
    ['localhost', 'http://localhost:3000/'],
    ['a preview host', 'https://preview.fluxradar.net/'],
    ['a Docker build', 'http://127.0.0.1:8080/'],
  ])('stays off on %s', (_label, url) => {
    visit(url);

    startPlausible(SITE_SCRIPT);
    trackPlausiblePageView();

    expect(document.getElementById(PLAUSIBLE_SCRIPT_ID)).toBeNull();
    expect(window.plausible).toBeUndefined();
  });

  it('sends one page view per screen, carrying the cleaned address', () => {
    startPlausible(SITE_SCRIPT);
    const calls = installLoadedTracker();

    trackPlausiblePageView();
    visit(`${PRODUCTION}/reports`);
    trackPlausiblePageView();
    // A re-render of the same screen is not a second page view.
    trackPlausiblePageView();

    expect(pageViews(calls)).toEqual([`${PRODUCTION}/`, `${PRODUCTION}/reports`]);
  });

  // The scan id names a customer's audited site. One page per screen is also
  // the only way the report screen is legible in the dashboard at all.
  it('collapses scan ids exactly as GA4 does', () => {
    visit(`${PRODUCTION}/scans/7f3c1b9e-aaaa-bbbb-cccc-1234567890ab`);
    startPlausible(SITE_SCRIPT);
    const calls = installLoadedTracker();

    trackPlausiblePageView();

    expect(pageViews(calls)).toEqual([`${PRODUCTION}/scans/:id`]);
  });

  it.each([
    ['a reset token', '?reset_token=abc123'],
    ['an email verification link', '?verify_email=someone%40example.com'],
    ['a Google Ads click', '?gclid=EAIaIQobChMI'],
    ['a Creem return', '?checkout_id=ch_1&signature=deadbeef'],
    ['an unapproved campaign', '?utm_source=spy&utm_medium=unknown'],
  ])('drops the query string of %s', (_label, search) => {
    visit(`${PRODUCTION}/account${search}`);
    startPlausible(SITE_SCRIPT);
    const calls = installLoadedTracker();

    trackPlausiblePageView();

    expect(pageViews(calls)).toEqual([`${PRODUCTION}/account`]);
  });

  // Plausible reads utm_source and utm_medium out of the address it is given,
  // so an approved pair has to travel there to be credited at all. Only the
  // fixed allowlist in analytics-attribution.ts does, and only on the view that
  // opens the visit — after that the address is reported bare, as GA4 does.
  it('forwards the approved campaign pair on the landing view alone', () => {
    visit(`${PRODUCTION}/?utm_source=instagram&utm_medium=social`);
    startPlausible(SITE_SCRIPT);
    const calls = installLoadedTracker();

    trackPlausiblePageView();
    visit(`${PRODUCTION}/reports`);
    trackPlausiblePageView();

    expect(pageViews(calls)).toEqual([
      `${PRODUCTION}/?utm_source=instagram&utm_medium=social`,
      `${PRODUCTION}/reports`,
    ]);
  });

  it('forwards no campaign when the pair is not an approved one', () => {
    visit(`${PRODUCTION}/?utm_source=instagram&utm_medium=cpc&gclid=EAIaIQobChMI`);
    startPlausible(SITE_SCRIPT);
    const calls = installLoadedTracker();

    trackPlausiblePageView();

    expect(pageViews(calls)).toEqual([`${PRODUCTION}/`]);
  });

  // Plausible's automatic captures — outbound links, file downloads, form
  // submissions — are dashboard settings baked into the script it serves, so
  // the repository cannot see whether they are on and an `init` option is what
  // overrides them. Named explicitly for that reason, and `hashBasedRouting`
  // with them, because this app routes by history.
  it('turns every automatic capture off by name', () => {
    startPlausible(SITE_SCRIPT);

    expect(window.plausible?.o).toMatchObject({
      autoCapturePageviews: false,
      outboundLinks: false,
      fileDownloads: false,
      formSubmissions: false,
      hashBasedRouting: false,
    });
  });

  // The tracker reads document.referrer itself, so the one field the `url`
  // option cannot clean is cleaned on the way out instead. A report page
  // linking to another screen would otherwise hand Plausible a scan id.
  describe('the referrer it sends', () => {
    it('reduces a same-origin referrer to its cleaned path', () => {
      startPlausible(SITE_SCRIPT);

      expect(
        transform({ n: 'pageview', r: `${PRODUCTION}/scans/abc123?token=secret` }),
      ).toMatchObject({ r: `${PRODUCTION}/scans/:id` });
    });

    it('reduces an external referrer to its bare origin', () => {
      startPlausible(SITE_SCRIPT);

      expect(
        transform({ n: 'pageview', r: 'https://news.example.com/thread/9?user=me' }),
      ).toMatchObject({ r: 'https://news.example.com/' });
    });

    it('leaves a page view without a referrer alone', () => {
      startPlausible(SITE_SCRIPT);

      expect(transform({ n: 'pageview', u: `${PRODUCTION}/` })).toEqual({
        n: 'pageview',
        u: `${PRODUCTION}/`,
      });
    });

    // The payload belongs to the tracker, which goes on reading it after the
    // hook returns — the engagement events it derives are built from it.
    it('cleans into a copy instead of editing the payload the tracker owns', () => {
      startPlausible(SITE_SCRIPT);
      const payload = { n: 'pageview', r: `${PRODUCTION}/scans/abc123?token=secret` };

      const sent = transform(payload);

      expect(sent).not.toBe(payload);
      expect(payload.r).toBe(`${PRODUCTION}/scans/abc123?token=secret`);
    });
  });

  // The second half of the capture promise, and the half that holds even if a
  // setting is switched back on in the dashboard: a null answer makes the
  // tracker drop the request unsent, and only a page view is ever not null.
  //
  // Engagement is not caught by this. The script takes the address for those
  // from the page view's payload AFTER this hook returned it, and posts them
  // without passing them through the hook again (plausible/analytics,
  // tracker/src/track.js and tracker/src/engagement.js).
  describe('the events it refuses to send', () => {
    it.each([
      [
        'an outbound link click, whose url is the audited customer',
        { n: 'Outbound Link: Click', p: { url: 'https://customer.example.com/pricing?ref=abc' } },
      ],
      [
        'a file download, whose url can be a signed link',
        { n: 'File Download', p: { url: `${PRODUCTION}/reports/abc123.pdf?token=secret` } },
      ],
      ['a form submission', { n: 'Form: Submission' }],
      ['a tagged custom event', { n: 'Signup', p: { url: `${PRODUCTION}/scans/abc123` } }],
    ])('drops %s', (_label, payload) => {
      startPlausible(SITE_SCRIPT);

      expect(transform(payload)).toBeNull();
    });

    it('sends the page view itself', () => {
      startPlausible(SITE_SCRIPT);

      expect(transform({ n: 'pageview', u: `${PRODUCTION}/` })).not.toBeNull();
    });
  });

  it('queues a page view sent before the tracker has loaded', () => {
    startPlausible(SITE_SCRIPT);
    trackPlausiblePageView();

    expect(pageViews(allCalls())).toEqual([`${PRODUCTION}/`]);
  });
});
