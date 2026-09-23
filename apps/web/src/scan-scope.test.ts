import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Scan } from './api';
import { PLAN_URL_LIMIT } from './plan-modules';
import {
  clampScopeToPlan,
  DEFAULT_SCOPE_FORM,
  invalidScopeFields,
  MAX_CRAWL_DEPTH,
  scanScopeFrom,
  profileScanConfigFromForm,
  scopeFormFromProfileConfig,
  scopeFormFromScan,
} from './scan-scope';

// The two directions the scan settings travel, tested apart from the form that
// draws them.
//
// Going out, the plan decides what is honest to ask for: Free is the fixed
// homepage check, so a Free request that carried a 200-page limit would be
// asking for something the server discards. Coming back, the last check of a
// site is what the form opens on — except where that check's settings were the
// server's own answer rather than the owner's choice.

function scanWith(plan: Scan['plan'], scope: Scan['scope']): Scan {
  return { plan, scope } as Scan;
}

it('preserves intentionally cleared limits when a saved configuration is reopened', () => {
  const saved = profileScanConfigFromForm(
    { ...DEFAULT_SCOPE_FORM, maxPages: '', maxDepth: '' },
    'Complete',
  );
  const restored = scopeFormFromProfileConfig(saved);
  expect(restored.maxPages).toBe('');
  expect(restored.maxDepth).toBe('');
  expect(profileScanConfigFromForm(restored, 'Complete')).toEqual(saved);
});

describe('scanScopeFrom', () => {
  const filledForm = {
    includeSubdomains: true,
    maxPages: '80',
    maxDepth: '4',
    includePatterns: '/docs/*, /blog/* ,',
    excludePatterns: '/admin/*',
    seedUrls: '',
    renderJs: false,
    apiChecks: '',
    queryPolicy: 'include' as const,
    respectRobots: false,
    robotsOverrideConfirmed: true,
    userAgent: 'mobile' as const,
  };

  it('sends everything the owner set on a paid plan', () => {
    expect(scanScopeFrom(filledForm, 'Complete')).toEqual({
      includeSubdomains: true,
      maxPages: 80,
      maxDepth: 4,
      urlPatterns: ['/docs/*', '/blog/*'],
      excludePatterns: ['/admin/*'],
      renderJs: false,
      queryPolicy: 'include',
      respectRobots: false,
      robotsOverrideConfirmed: true,
      userAgent: 'mobile',
    });
  });

  // Free honours the user agent and nothing else, so that is all it may claim.
  it('sends the fixed homepage check on Free, whatever the form holds', () => {
    expect(scanScopeFrom(filledForm, 'Free')).toEqual({
      includeSubdomains: false,
      maxPages: 1,
      maxDepth: 0,
      renderJs: false,
      queryPolicy: 'ignore',
      respectRobots: true,
      robotsOverrideConfirmed: false,
      userAgent: 'mobile',
    });
  });

  it('omits an emptied number field instead of sending zero', () => {
    const scope = scanScopeFrom({ ...filledForm, maxPages: '', maxDepth: '  ' }, 'Basic');

    expect(scope).not.toHaveProperty('maxPages');
    expect(scope).not.toHaveProperty('maxDepth');
  });

  // A value the API would refuse used to be dropped from the payload, and a
  // dropped limit is not "no answer" to the server — it is the plan's whole
  // allowance. One mistyped digit turned a 15-page check into a 5,000-page one.
  it.each([
    ['not a number', 'abc'],
    ['a fraction', '2.5'],
    ['zero', '0'],
    ['negative', '-3'],
  ])('narrows maxPages to one page when it is %s, never to the plan limit', (_label, value) => {
    const scope = scanScopeFrom({ ...filledForm, maxPages: value }, 'Basic');

    expect(scope.maxPages).toBe(1);
    expect(scope.maxPages).not.toBe(PLAN_URL_LIMIT.Basic);
  });

  it.each([
    ['not a number', 'abc'],
    ['a fraction', '1.5'],
    ['negative', '-1'],
  ])('narrows maxDepth to the homepage when it is %s', (_label, value) => {
    expect(scanScopeFrom({ ...filledForm, maxDepth: value }, 'Basic').maxDepth).toBe(0);
  });

  // The form clamps this on the way in (`clampScopeToPlan`); doing it here too
  // means no caller can produce a payload the API answers with a 400.
  it('never asks for more pages than the chosen plan sells', () => {
    expect(scanScopeFrom({ ...filledForm, maxPages: '40000' }, 'Basic').maxPages).toBe(
      PLAN_URL_LIMIT.Basic,
    );
    expect(scanScopeFrom({ ...filledForm, maxPages: '40000' }, 'Complete').maxPages).toBe(40000);
  });

  it('never asks for a crawl deeper than the schema accepts', () => {
    expect(scanScopeFrom({ ...filledForm, maxDepth: '500' }, 'Complete').maxDepth).toBe(
      MAX_CRAWL_DEPTH,
    );
  });

  it('omits empty pattern lists rather than sending empty arrays', () => {
    const scope = scanScopeFrom(
      { ...filledForm, includePatterns: ' , ', excludePatterns: '' },
      'Basic',
    );

    expect(scope).not.toHaveProperty('urlPatterns');
    expect(scope).not.toHaveProperty('excludePatterns');
  });
});

describe('scopeFormFromScan', () => {
  it('opens the form on the settings a paid check used', () => {
    const form = scopeFormFromScan(
      scanWith('Complete', {
        includeSubdomains: true,
        maxPages: 120,
        maxDepth: 3,
        urlPatterns: ['/docs/*', '/blog/*'],
        excludePatterns: ['/admin/*'],
        queryPolicy: 'include',
        respectRobots: true,
        userAgent: 'mobile',
      }),
    );

    expect(form).toEqual({
      includeSubdomains: true,
      maxPages: '120',
      maxDepth: '3',
      includePatterns: '/docs/*, /blog/*',
      excludePatterns: '/admin/*',
      seedUrls: '',
      renderJs: false,
      apiChecks: '',
      queryPolicy: 'include',
      respectRobots: true,
      robotsOverrideConfirmed: false,
      userAgent: 'mobile',
    });
  });

  // A Free scope is the server's answer, not a preference: carrying its
  // one-page, zero-depth limits into a paid form would report a choice the
  // owner never made.
  it('carries only the user agent forward from a free check', () => {
    const form = scopeFormFromScan(
      scanWith('Free', {
        includeSubdomains: false,
        maxPages: 1,
        maxDepth: 0,
        queryPolicy: 'ignore',
        respectRobots: true,
        robotsOverrideConfirmed: false,
        userAgent: 'mobile',
      }),
    );

    expect(form).toEqual({ ...DEFAULT_SCOPE_FORM, userAgent: 'mobile' });
  });

  // Overriding robots.txt is confirmed for the scan in front of the owner, not
  // inherited from one they ran last week.
  it('never carries a robots.txt override forward', () => {
    const form = scopeFormFromScan(
      scanWith('Basic', {
        includeSubdomains: false,
        respectRobots: false,
        robotsOverrideConfirmed: true,
      }),
    );

    expect(form.respectRobots).toBe(false);
    expect(form.robotsOverrideConfirmed).toBe(false);
  });

  it('falls back to the defaults for anything the stored scope omits', () => {
    expect(scopeFormFromScan(scanWith('Basic', { includeSubdomains: false }))).toEqual(
      DEFAULT_SCOPE_FORM,
    );
  });
});

describe('invalidScopeFields', () => {
  const form = { ...DEFAULT_SCOPE_FORM };

  it('accepts an empty field, which means the owner set no limit of their own', () => {
    expect(invalidScopeFields({ ...form, maxPages: '', maxDepth: '  ' }, 'Basic')).toEqual([]);
  });

  it.each([['abc'], ['2.5'], ['0'], ['-4']])('reports maxPages typed as %s', (value) => {
    expect(invalidScopeFields({ ...form, maxPages: value }, 'Basic')).toEqual(['maxPages']);
  });

  it.each([['abc'], ['1.5'], ['-1']])('reports maxDepth typed as %s', (value) => {
    expect(invalidScopeFields({ ...form, maxDepth: value }, 'Basic')).toEqual(['maxDepth']);
  });

  // Depth starts at the homepage, so zero is a real answer there and a typo in
  // the page count above it.
  it('accepts a depth of zero and refuses a page count of zero', () => {
    expect(invalidScopeFields({ ...form, maxDepth: '0' }, 'Complete')).toEqual([]);
    expect(invalidScopeFields({ ...form, maxPages: '0' }, 'Complete')).toEqual(['maxPages']);
  });

  // Above the plan's ceiling is the last check's setting far more often than a
  // typo, so it is clamped rather than thrown back at the owner.
  it('does not call a page count above the plan limit a mistake', () => {
    expect(invalidScopeFields({ ...form, maxPages: '40000' }, 'Basic')).toEqual([]);
  });

  it('reports nothing on Free, whose controls are not on screen', () => {
    expect(invalidScopeFields({ ...form, maxPages: '0', maxDepth: 'abc' }, 'Free')).toEqual([]);
  });
});

describe('clampScopeToPlan', () => {
  // The 400 this exists to prevent: a site last checked on Complete opens the
  // form on Complete-sized limits, and Basic does not sell them.
  it('brings a Complete-sized page count down to what Basic sells', () => {
    const clamped = clampScopeToPlan({ ...DEFAULT_SCOPE_FORM, maxPages: '20000' }, 'Basic');

    expect(clamped.maxPages).toBe(String(PLAN_URL_LIMIT.Basic));
  });

  it('caps the crawl depth at the deepest the API accepts', () => {
    expect(clampScopeToPlan({ ...DEFAULT_SCOPE_FORM, maxDepth: '500' }, 'Basic').maxDepth).toBe(
      String(MAX_CRAWL_DEPTH),
    );
  });

  it('leaves a scope already inside the limits exactly as it was', () => {
    const form = { ...DEFAULT_SCOPE_FORM, maxPages: '80', maxDepth: '4' };

    expect(clampScopeToPlan(form, 'Basic')).toBe(form);
  });

  // Rewriting the fields to the fixed homepage check would throw away settings
  // the owner would find missing on switching back to a paid plan.
  it('leaves the form alone on Free, whose scope is fixed anyway', () => {
    const form = { ...DEFAULT_SCOPE_FORM, maxPages: '20000' };

    expect(clampScopeToPlan(form, 'Free')).toBe(form);
  });

  // A typo is the form's to report, not this function's to overwrite: replacing
  // it would hide the value the error message is pointing at.
  it('does not overwrite a value that is not a number', () => {
    const form = { ...DEFAULT_SCOPE_FORM, maxPages: 'abc' };

    expect(clampScopeToPlan(form, 'Basic')).toBe(form);
  });
});

// The two ceilings are mirrored from the packages the web app does not import,
// the same seam `plan-modules.test.ts` uses for the tariff table. A limit that
// moves in the contracts package and not here fails in the repository that owns
// both, rather than as a 400 in front of a buyer.
describe('the API limits this form mirrors', () => {
  const contracts = readFileSync(
    resolve(process.cwd(), '..', '..', 'packages', 'contracts', 'src', 'api.ts'),
    'utf8',
  );

  it('caps the crawl depth where scanScopeSchema does', () => {
    const declared = /maxDepth: z\.number\(\)\.int\(\)\.min\(0\)\.max\((\d+)\)/.exec(contracts);
    expect(declared?.[1]).toBe(String(MAX_CRAWL_DEPTH));
  });

  it('starts the page count where scanScopeSchema does', () => {
    expect(contracts).toContain('maxPages: z.number().int().min(1).optional()');
  });
});
