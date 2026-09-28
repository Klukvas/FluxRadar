import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EGRESS_LOCATION,
  executionConfigSchema,
  issueStatusUpdateInputSchema,
  loginInputSchema,
  registerInputSchema,
  competitorsListProblem,
  defaultProfileScanConfig,
  profileScanConfigSchema,
  scanRequestInputSchema,
  siteProfileInputSchema,
} from './api.js';

describe('registerInputSchema', () => {
  it('accepts a valid email and an 8+ character password', () => {
    const result = registerInputSchema.safeParse({
      email: 'user@example.com',
      password: 'longenough',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a password shorter than 8 characters', () => {
    expect(
      registerInputSchema.safeParse({ email: 'user@example.com', password: 'short7!' }).success,
    ).toBe(false);
  });

  it('rejects an invalid email', () => {
    expect(
      registerInputSchema.safeParse({ email: 'not-an-email', password: 'longenough' }).success,
    ).toBe(false);
  });

  // D-111: the 72 limit is the bcrypt truncation boundary in BYTES, not characters.
  it('applies the 72-byte password limit in UTF-8 bytes, not characters', () => {
    const parse = (password: string): boolean =>
      registerInputSchema.safeParse({ email: 'user@example.com', password }).success;

    expect(parse('a'.repeat(72))).toBe(true);
    expect(parse('a'.repeat(73))).toBe(false);
    // 36 Cyrillic characters = 72 UTF-8 bytes; 37 characters = 74 bytes.
    expect(parse('п'.repeat(36))).toBe(true);
    expect(parse('п'.repeat(37))).toBe(false);
  });
});

describe('loginInputSchema', () => {
  it('rejects an empty password', () => {
    expect(loginInputSchema.safeParse({ email: 'user@example.com', password: '' }).success).toBe(
      false,
    );
  });
});

describe('launch configuration revision', () => {
  it('preserves the expected profile revision independently of the requested plan', () => {
    expect(
      scanRequestInputSchema.parse({
        plan: 'Free',
        scope: { includeSubdomains: false },
        expectedProfileConfigVersion: 7,
      }),
    ).toMatchObject({ expectedProfileConfigVersion: 7 });
    expect(
      scanRequestInputSchema.safeParse({
        plan: 'Complete',
        scope: { includeSubdomains: false },
        expectedProfileConfigVersion: 0,
      }).success,
    ).toBe(false);
  });
});

describe('siteProfileInputSchema', () => {
  const base = { name: 'My Site' };

  it.each(['https://example.com', 'https://example.com/'])(
    'accepts a root https origin and normalizes it',
    (domain) => {
      const result = siteProfileInputSchema.safeParse({ ...base, domain });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.domain).toBe('https://example.com');
      }
    },
  );

  it('normalizes host case and default port to the canonical origin', () => {
    const result = siteProfileInputSchema.safeParse({ ...base, domain: 'https://Example.com:443' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domain).toBe('https://example.com');
    }
  });

  it('accepts the optional site context used for future domain-specific queries', () => {
    const result = siteProfileInputSchema.safeParse({
      ...base,
      domain: 'https://example.com',
      industry: 'Dental clinic',
      businessDescription: 'A family dental clinic in Kyiv.',
      offerings: 'Implants, cleanings, emergency appointments',
      region: 'Kyiv, Ukraine',
      targetLanguages: 'Ukrainian, Russian, English',
      targetAudience: 'Adults and families in Kyiv',
    });
    expect(result.success).toBe(true);
  });

  it('rejects site context that exceeds its bounded input size', () => {
    expect(
      siteProfileInputSchema.safeParse({
        ...base,
        domain: 'https://example.com',
        offerings: 'x'.repeat(1201),
      }).success,
    ).toBe(false);
  });

  it('defines a valid reusable Complete profile configuration', () => {
    const result = siteProfileInputSchema.safeParse({ ...base, domain: 'https://example.com' });
    expect(result.success).toBe(true);
    expect(defaultProfileScanConfig.plan).toBe('Complete');
    expect(profileScanConfigSchema.safeParse(defaultProfileScanConfig).success).toBe(true);
  });

  it('validates a saved profile configuration with the same plan limits as a scan', () => {
    expect(
      profileScanConfigSchema.safeParse({
        plan: 'Basic',
        scope: { includeSubdomains: false, maxPages: 5001 },
      }).success,
    ).toBe(false);
    expect(
      siteProfileInputSchema.safeParse({
        ...base,
        domain: 'https://example.com',
        scanConfig: {
          plan: 'Complete',
          scope: {
            includeSubdomains: true,
            maxPages: 120,
            maxDepth: 6,
            queryPolicy: 'include',
            respectRobots: true,
            userAgent: 'mobile',
          },
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    ['path', 'https://example.com/path'],
    ['query', 'https://example.com?q=1'],
    ['fragment', 'https://example.com#top'],
    ['userinfo', 'https://user:pass@example.com'],
    ['http scheme', 'http://example.com'],
    ['not a URL', 'example.com'],
  ])('rejects a domain with %s', (_label, domain) => {
    expect(siteProfileInputSchema.safeParse({ ...base, domain }).success).toBe(false);
  });
});

describe('competitors (T7)', () => {
  const withCompetitors = (competitors: readonly string[]) =>
    siteProfileInputSchema.safeParse({
      name: 'My Site',
      domain: 'https://example.com',
      competitors,
    });

  it('accepts up to 5 valid names', () => {
    const result = withCompetitors(['Acme', 'Beta Co', 'Gamma', 'Delta', 'Epsilon']);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.competitors).toEqual(['Acme', 'Beta Co', 'Gamma', 'Delta', 'Epsilon']);
    }
  });

  it('accepts an absent or empty list', () => {
    expect(
      siteProfileInputSchema.safeParse({ name: 'My Site', domain: 'https://example.com' }).success,
    ).toBe(true);
    expect(withCompetitors([]).success).toBe(true);
  });

  it('rejects more than 5 names', () => {
    expect(withCompetitors(['A1', 'B1', 'C1', 'D1', 'E1', 'F1']).success).toBe(false);
  });

  it('rejects a name shorter than 2 characters', () => {
    expect(withCompetitors(['A']).success).toBe(false);
  });

  it('rejects a name longer than 64 characters', () => {
    expect(withCompetitors(['x'.repeat(65)]).success).toBe(false);
  });

  it('trims each name', () => {
    const result = withCompetitors(['  Acme  ']);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.competitors).toEqual(['Acme']);
  });

  describe('competitorsListProblem', () => {
    it('is null for a list with no conflict', () => {
      expect(competitorsListProblem(['Acme', 'Beta'], 'My Site', 'https://example.com')).toBeNull();
    });

    it('is null when no competitors are configured', () => {
      expect(competitorsListProblem(undefined, 'My Site', 'https://example.com')).toBeNull();
      expect(competitorsListProblem(null, 'My Site', 'https://example.com')).toBeNull();
      expect(competitorsListProblem([], 'My Site', 'https://example.com')).toBeNull();
    });

    it('flags a case-insensitive duplicate', () => {
      expect(
        competitorsListProblem(['Acme', 'acme'], 'My Site', 'https://example.com'),
      ).not.toBeNull();
    });

    it('flags a competitor equal to the profile brand, case-insensitively', () => {
      expect(competitorsListProblem(['my site'], 'My Site', 'https://example.com')).not.toBeNull();
    });

    it('flags a competitor equal to the profile domain, case-insensitively', () => {
      expect(
        competitorsListProblem(['HTTPS://EXAMPLE.COM'], 'My Site', 'https://example.com'),
      ).not.toBeNull();
    });

    // T7-fix F2: the stored domain is already an https origin
    // (`httpsOriginSchema`), but a competitor entry is free text — every form
    // of the same host must be recognised as the profile's own domain.
    describe('own-domain escapes (T7-fix F2)', () => {
      const domain = 'https://www.acmedental.test';
      it.each([
        'acmedental.test',
        'www.acmedental.test',
        'https://acmedental.test',
        'http://www.acmedental.test',
        'https://www.acmedental.test/',
      ])('flags "%s" against domain %s', (competitor) => {
        expect(competitorsListProblem([competitor], 'My Site', domain)).not.toBeNull();
      });
    });

    // T7-fix2 N3: the own-domain check folds "rival.test" and
    // "www.rival.test" to the same host; the duplicate check must fold the
    // same way, not just the plain-name fold, or the same site can be
    // listed twice under two spellings.
    it('flags a duplicate competitor that only matches once folded as a domain', () => {
      expect(
        competitorsListProblem(['rival.test', 'www.rival.test'], 'My Site', 'https://example.com'),
      ).not.toBeNull();
    });

    // T7-fix2 N2: overlapping names (one a substring of the other) stay
    // accepted by validation — only the counting in shareOfVoiceFor resolves
    // the overlap, per the architect's decision.
    it('still accepts an overlapping pair of competitor names', () => {
      expect(
        competitorsListProblem(['Acme', 'Acme Corp'], 'My Site', 'https://example.com'),
      ).toBeNull();
    });
  });
});

describe('scanRequestInputSchema', () => {
  it('accepts a Basic scan within the plan URL limit', () => {
    const result = scanRequestInputSchema.safeParse({
      plan: 'Basic',
      scope: { includeSubdomains: true, maxPages: 5000, urlPatterns: ['/blog/*'] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects maxPages above the plan URL limit', () => {
    const result = scanRequestInputSchema.safeParse({
      plan: 'Basic',
      scope: { includeSubdomains: false, maxPages: 5001 },
    });
    expect(result.success).toBe(false);
  });

  it('applies the higher Complete limit', () => {
    const result = scanRequestInputSchema.safeParse({
      plan: 'Complete',
      scope: { includeSubdomains: false, maxPages: 50_000 },
    });
    expect(result.success).toBe(true);
  });

  it('normalizes the full crawl scope and requires an explicit robots override confirmation', () => {
    const parsed = scanRequestInputSchema.safeParse({
      plan: 'Complete',
      scope: {
        includeSubdomains: true,
        maxPages: 100,
        maxDepth: 4,
        urlPatterns: ['/docs/*'],
        excludePatterns: ['/docs/private/*'],
        queryPolicy: 'include',
        respectRobots: true,
        userAgent: 'mobile',
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.scope.queryPolicy).toBe('include');
      expect(parsed.data.scope.userAgent).toBe('mobile');
      expect(parsed.data.scope.robotsOverrideConfirmed).toBe(false);
    }
    expect(
      scanRequestInputSchema.safeParse({
        plan: 'Complete',
        scope: { includeSubdomains: false, respectRobots: false },
      }).success,
    ).toBe(false);
    expect(
      scanRequestInputSchema.safeParse({
        plan: 'Complete',
        scope: { includeSubdomains: false, respectRobots: false, robotsOverrideConfirmed: true },
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown plan and a malformed scope', () => {
    expect(
      scanRequestInputSchema.safeParse({ plan: 'Ultimate', scope: { includeSubdomains: true } })
        .success,
    ).toBe(false);
    expect(
      scanRequestInputSchema.safeParse({ plan: 'Basic', scope: { includeSubdomains: 'yes' } })
        .success,
    ).toBe(false);
  });
});

describe('the egress location in a scan scope', () => {
  it('accepts a scope that names its location, and one that does not', () => {
    const withLocation = scanRequestInputSchema.safeParse({
      plan: 'Complete',
      scope: { includeSubdomains: false, egressLocation: 'ua' },
    });
    expect(withLocation.success).toBe(true);
    if (withLocation.success) expect(withLocation.data.scope.egressLocation).toBe('ua');

    const withoutLocation = scanRequestInputSchema.safeParse({
      plan: 'Complete',
      scope: { includeSubdomains: false },
    });
    expect(withoutLocation.success).toBe(true);
    // Absent stays absent: nothing here decides that an unnamed location was
    // Ukraine. The API picks the default for a launch; a stored scan without
    // the field reads as "not recorded".
    if (withoutLocation.success) expect(withoutLocation.data.scope.egressLocation).toBeUndefined();
  });

  it.each([['UA'], ['ukraine'], ['u'], ['ua_kyiv'], ['../ua'], [''], [7]])(
    'rejects %j as a location id',
    (egressLocation) => {
      expect(
        scanRequestInputSchema.safeParse({
          plan: 'Complete',
          scope: { includeSubdomains: false, egressLocation },
        }).success,
      ).toBe(false);
    },
  );

  it('accepts a narrowed location for a second point in one country', () => {
    expect(
      scanRequestInputSchema.safeParse({
        plan: 'Basic',
        scope: { includeSubdomains: false, egressLocation: 'de-fra' },
      }).success,
    ).toBe(true);
  });

  it('starts a new profile on the default location', () => {
    expect(defaultProfileScanConfig.scope.egressLocation).toBe(DEFAULT_EGRESS_LOCATION);
    expect(DEFAULT_EGRESS_LOCATION).toBe('ua');
  });

  it('reads a stored execution config that predates the field', () => {
    const parsed = executionConfigSchema.safeParse({
      schemaVersion: 1,
      source: 'launch',
      profileConfigVersion: 1,
      profile: { name: 'Example', domain: 'https://example.com' },
      plan: 'Complete',
      scope: { includeSubdomains: false },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.scope.egressLocation).toBeUndefined();
  });
});

describe('issueStatusUpdateInputSchema', () => {
  it('accepts user-settable statuses', () => {
    expect(issueStatusUpdateInputSchema.safeParse({ status: 'Ignored' }).success).toBe(true);
    expect(issueStatusUpdateInputSchema.safeParse({ status: 'False Positive' }).success).toBe(true);
  });

  it('rejects system-only and unknown statuses', () => {
    // Resolved/Reopened are derived from fingerprint comparison, never set by hand.
    expect(issueStatusUpdateInputSchema.safeParse({ status: 'Resolved' }).success).toBe(false);
    expect(issueStatusUpdateInputSchema.safeParse({ status: 'Reopened' }).success).toBe(false);
    expect(issueStatusUpdateInputSchema.safeParse({ status: 'Fixed' }).success).toBe(false);
  });
});
