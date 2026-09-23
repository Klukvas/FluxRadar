import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanScopeSchema } from '@fluxradar/contracts';
import { startFixtureSite, type FixtureSite } from '@fluxradar/crawler';
import { HostLimiter } from '@fluxradar/safe-fetch';
import { createSiteContext, runModuleRules } from '@fluxradar/rules';

import { isWithinSite } from '../scans/scope-targets.ts';
import { runApiChecks } from './api-checks.ts';

// The configured API checks, end to end against a real local fixture server:
// what leaves the process, what comes back, and what the two REL-API rules make
// of it. The fixture is loopback, which safe-fetch only allows behind the
// explicit test flag (D-126).

let site: FixtureSite;

beforeAll(async () => {
  site = await startFixtureSite();
});

afterAll(async () => {
  await site.close();
});

function options() {
  return {
    userAgent: 'FluxRadarBot/0.1',
    dangerouslyAllowLoopback: true,
    limiter: new HostLimiter({ rps: 1000, concurrency: 4 }),
  };
}

const scope = scanScopeSchema.parse({ includeSubdomains: false });

/** An empty crawl: these rules read ctx.apiChecks, not pages. */
function contextFor(checks: Awaited<ReturnType<typeof runApiChecks>>['checks']) {
  return createSiteContext({
    origin: site.origin,
    plan: 'Complete',
    apiChecks: checks,
    crawl: {
      pages: [],
      skippedOverLimit: [],
      blockedByRobots: [],
      errors: [],
      urlVariants: {},
      sitemapUrls: [],
      rejectedSeeds: [],
      rendering: { status: 'NotRequested' },
      resources: [],
      pendingQueue: [],
      stoppedEarly: false,
    },
  });
}

/** One rule's result from a real Reliability module run over these checks. */
function evaluationFor(checks: Awaited<ReturnType<typeof runApiChecks>>['checks'], ruleId: string) {
  return runModuleRules('Reliability', contextFor(checks)).evaluations.find(
    (evaluation) => evaluation.ruleId === ruleId,
  );
}

// The predicate itself lives with the scope validation an owner meets first
// (scans/scope-targets.ts); this is the execution side of the same rule.
describe('the endpoints a check may be pointed at', () => {
  it('refuses an endpoint on another site, with and without subdomains', () => {
    expect(isWithinSite('https://other.test/api', 'https://example.com', false)).toBe(false);
    expect(isWithinSite('https://other.test/api', 'https://example.com', true)).toBe(false);
    expect(isWithinSite('https://api.example.com/x', 'https://example.com', true)).toBe(true);
  });
});

describe('runApiChecks', () => {
  it('records the status and timing of an endpoint that answers', async () => {
    const run = await runApiChecks(
      [{ method: 'GET', url: `${site.origin}/index.html` }],
      site.origin,
      scope,
      options(),
    );

    expect(run.results[0]?.status).toBe(200);
    expect(run.results[0]?.timingMs).toBeGreaterThanOrEqual(0);
    expect(run.checks[0]?.snapshot?.status).toBe(200);
  });

  it('never leaves the scanned site, and says so instead of requesting', async () => {
    const run = await runApiChecks(
      [{ method: 'GET', url: 'https://not-the-site.example/api' }],
      site.origin,
      scope,
      options(),
    );

    expect(run.results[0]?.skippedReason).toBe('OutsideScannedSite');
    expect(run.results[0]?.status).toBeNull();
    // An endpoint on somebody else's site was never one of this module's
    // targets, and the report says "not applicable" about exactly these.
    expect(run.results[0]?.applicable).toBe(false);
    // Without a snapshot the expected-status rule has nothing to judge.
    expect(run.checks[0]?.snapshot).toBeUndefined();
  });

  it('reports an unreachable endpoint as no response rather than a wrong status', async () => {
    const run = await runApiChecks(
      // A port nothing listens on, still on the fixture host so it is in scope.
      [{ method: 'GET', url: `${new URL(site.origin).protocol}//127.0.0.1:1/api` }],
      `${new URL(site.origin).protocol}//127.0.0.1:1`,
      scope,
      options(),
    );

    expect(run.results[0]?.status).toBeNull();
    expect(run.results[0]?.skippedReason).not.toBeUndefined();
    // It was checked — it just has no answer — so the report must not file it
    // under "not applicable" next to the endpoints that were never targets.
    expect(run.results[0]?.applicable).toBe(true);
  });

  // A configured endpoint may answer with a redirect. Following it blindly
  // would point the product at whoever runs the redirect target and then report
  // *their* status as the owner's endpoint — so the hop is vetted like the URL
  // the owner configured, and refused by name when it leaves the site.
  it('refuses a redirect that leaves the scanned site instead of following it', async () => {
    const run = await runApiChecks(
      [{ method: 'GET', url: `${site.origin}/redirect-offsite` }],
      site.origin,
      scope,
      options(),
    );

    expect(run.results[0]?.skippedReason).toBe('RedirectedOffSite');
    expect(run.results[0]?.status).toBeNull();
    expect(run.checks[0]?.snapshot).toBeUndefined();
  });

  it('follows a redirect that stays on the scanned site and reports where it ended', async () => {
    const run = await runApiChecks(
      [{ method: 'GET', url: `${site.origin}/redirect-a` }],
      site.origin,
      scope,
      options(),
    );

    expect(run.results[0]?.status).toBe(200);
    expect(run.results[0]?.finalUrl).toBe(`${site.origin}/redirect-final.html`);
  });

  it('stops making requests once the scan has been stopped', async () => {
    const run = await runApiChecks(
      [{ method: 'GET', url: `${site.origin}/index.html` }],
      site.origin,
      scope,
      { ...options(), shouldStop: () => true },
    );

    expect(run.results[0]?.skippedReason).toBe('ScanStopped');
  });

  it('honours the plan cap on how many endpoints run', async () => {
    const many = Array.from({ length: 30 }, () => ({
      method: 'GET' as const,
      url: `${site.origin}/index.html`,
    }));
    const run = await runApiChecks(many, site.origin, scope, options());

    expect(run.results).toHaveLength(20);
  });
});

describe('the REL-API rules over a real run', () => {
  it('passes an endpoint whose status is expected, including an expected 404', async () => {
    const run = await runApiChecks(
      [
        { method: 'GET', url: `${site.origin}/index.html`, expectedStatus: [200] },
        { method: 'GET', url: `${site.origin}/missing.html`, expectedStatus: [404] },
      ],
      site.origin,
      scope,
      options(),
    );
    const evaluation = evaluationFor(run.checks, 'REL-API-003');

    expect(evaluation?.applicableTargets).toBe(2);
    expect(evaluation?.findings).toEqual([]);
  });

  it('reports an unexpected status as a finding', async () => {
    const run = await runApiChecks(
      [{ method: 'GET', url: `${site.origin}/missing.html`, expectedStatus: [200] }],
      site.origin,
      scope,
      options(),
    );
    const evaluation = evaluationFor(run.checks, 'REL-API-003');

    expect(evaluation?.findings).toHaveLength(1);
    expect(evaluation?.findings[0]?.evidenceExcerpt).toContain('404');
  });

  // The difference between "every endpoint passed" and "no endpoint answered"
  // has to be visible in the numbers, not only in the metadata list.
  it('counts an endpoint it could not reach as checked-but-incomplete', async () => {
    const unreachable = `${new URL(site.origin).protocol}//127.0.0.1:1/api`;
    const run = await runApiChecks(
      [
        { method: 'GET', url: `${site.origin}/index.html` },
        { method: 'GET', url: unreachable },
      ],
      // Both are on 127.0.0.1, so both are in scope; only one answers.
      `${new URL(site.origin).protocol}//127.0.0.1`,
      scope,
      options(),
    );
    const module = runModuleRules('Reliability', contextFor(run.checks));
    const evaluation = module.evaluations.find((entry) => entry.ruleId === 'REL-API-003');

    expect(evaluation?.applicableTargets).toBe(2);
    // Two endpoints are in scope and one has no verdict: coverage must say so.
    expect(evaluation?.findings).toHaveLength(0);
    expect(module.applicableChecks).toBeGreaterThan(module.completedApplicableChecks);
  });

  it('leaves an endpoint on another site out of the denominator entirely', async () => {
    const run = await runApiChecks(
      [{ method: 'GET', url: 'https://not-the-site.example/api' }],
      site.origin,
      scope,
      options(),
    );
    const evaluation = evaluationFor(run.checks, 'REL-API-003');

    // It was never one of this audit's targets, so it neither passes nor
    // lowers the coverage of the endpoints that are.
    expect(evaluation?.applicableTargets).toBe(0);
  });

  // Nothing the owner can configure carries a credential, so the policy rule
  // reports a clean result rather than catching a mistake after the fact.
  it('finds no credential headers, because a check has nowhere to hold one', async () => {
    const run = await runApiChecks(
      [{ method: 'GET', url: `${site.origin}/index.html` }],
      site.origin,
      scope,
      options(),
    );
    const evaluation = evaluationFor(run.checks, 'REL-API-005');

    expect(evaluation?.applicableTargets).toBe(1);
    expect(evaluation?.affectedTargets).toBe(0);
  });
});
