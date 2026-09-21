import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AiProvider } from '@fluxradar/ai';
import {
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
  MockAiProvider,
  UnavailableError,
} from '@fluxradar/ai';
import { validateExportRecords } from '@fluxradar/export';
import type { Scan, SiteProfile } from '@prisma/client';
import { buildExportRecords } from './export/build-records.ts';
import type { GoogleScanData } from './integrations/google/types.ts';
import type { WorkerDeps } from './orchestrator/deps.ts';
import { defaultGeoFixtures } from './orchestrator/geo.ts';
import { processScan } from './orchestrator/worker.ts';
import { createApp } from './index.ts';
import { silentLogger } from './http/logger.ts';
import { createTestDb, TEST_WEBHOOK_SECRET, type TestDb } from './test-utils/test-db.ts';
import { startFixtureSite, type FixtureSite } from '@fluxradar/crawler';

type TestAgent = ReturnType<typeof request.agent>;
type AiFactory = (scan: Scan, profile: SiteProfile) => AiProvider;

const AI_CONFIG = {
  provider: 'anthropic' as const,
  apiVersion: '2023-06-01',
  modelId: 'claude-sonnet-5',
  timeoutMs: 1_000,
  maxRetries: 1 as const,
};

describe('backend E2E: Complete UX/Conversion flow', () => {
  let fixture: FixtureSite;
  let db: TestDb;

  beforeAll(async () => {
    fixture = await startFixtureSite();
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('runs Complete from checkout through UX findings, Issue Center, and export', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      createPerformanceRunner: () => undefined,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'ux-e2e@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await agent
      .post('/billing/dev-checkout')
      .set('Cookie', account.cookie)
      .send({
        siteProfileId: profile.id,
        plan: 'Complete',
        scope: { includeSubdomains: false, maxPages: 15 },
        aiConsent: {
          providers: ['anthropic'],
          noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
        },
      });

    expect(checkout.status).toBe(201);
    const scanId = checkout.body.data.scanId as string;
    const edit = await agent.patch(`/profiles/${profile.id}`).set('Cookie', account.cookie).send({
      expectedProfileConfigVersion: 1,
      name: 'Changed Plumbing',
      offerings: 'Leak repairs',
    });
    expect(edit.status).toBe(200);
    const result = await runScan(scanId, () => uxAwareProvider(profile.name));
    expect(['Completed', 'Partial']).toContain(result.outcome);

    const scan = await agent.get(`/scans/${scanId}`).set('Cookie', account.cookie);
    expect(scan.status).toBe(200);
    const accessibility = scan.body.data.modules.find(
      (module: { module: string }) => module.module === 'Accessibility',
    );
    // The report's Accessibility card opens to this list: the module totals
    // alone could not say which checks ran or which of them found something.
    expect(accessibility.metadata.ruleChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'A11Y-001',
          title: 'text contrast',
          applicableTargets: expect.any(Number),
          affectedTargets: expect.any(Number),
        }),
        expect.objectContaining({ ruleId: 'A11Y-011', scoring: 'informational' }),
      ]),
    );
    const ux = scan.body.data.modules.find(
      (module: { module: string }) => module.module === 'UX/Conversion',
    );
    expect(ux).toMatchObject({
      module: 'UX/Conversion',
      status: 'Completed',
      usableOutput: true,
      metadata: {
        standard: 'UX/Conversion',
        pages: expect.arrayContaining([
          expect.objectContaining({
            url: expect.stringContaining('[REDACTED:private-ip]'),
            visibleText: expect.any(String),
          }),
        ]),
        automation: 'static-html + AI-assisted',
        limitation: 'static-html-only',
        ai: { status: 'Completed', findings: 1, modelId: 'claude-sonnet-5' },
      },
    });
    const geo = scan.body.data.modules.find(
      (module: { module: string }) => module.module === 'AI SEO / GEO',
    );
    expect(geo).toMatchObject({
      module: 'AI SEO / GEO',
      status: 'Completed',
      usableOutput: true,
      metadata: {
        providerVisibility: {
          method: 'AI-generated neutral context questions plus direct brand-awareness questions',
          queryGeneration: {
            status: 'Completed',
            promptVersion: 'geo-query-generation-v2',
            generatedQuestions: expect.arrayContaining([expect.stringContaining('providers')]),
          },
          requests: expect.arrayContaining([
            expect.objectContaining({ purpose: 'awareness' }),
            expect.objectContaining({ purpose: 'discovery' }),
          ]),
        },
      },
    });

    const dashboard = await agent.get(`/scans/${scanId}/dashboard`).set('Cookie', account.cookie);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.geoObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          purpose: 'discovery',
          question: expect.stringContaining('providers'),
          status: 'answered',
          answer: expect.stringContaining(profile.name),
          modelId: 'claude-sonnet-5',
          // The fixture names the real profile brand but cites smile.example,
          // not the scan's loopback test domain. The report must not turn that
          // unrelated URL into an official-domain mention.
          //
          // A discovery question is neutral — it names neither the brand nor
          // the domain — so both signals are real measurements here. The two
          // awareness questions name the brand by construction and are reported
          // as `named-in-question` instead, which is what stopped both badges
          // being green on every scan.
          mentions: { brand: 'mentioned', domain: 'not-mentioned' },
        }),
      ]),
    );

    const issues = await agent
      .get(`/scans/${scanId}/issues?limit=100&module=UX%2FConversion`)
      .set('Cookie', account.cookie);
    expect(issues.status).toBe(200);
    expect(issues.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module: 'UX/Conversion',
          ruleId: 'UX-CONV-AI-001',
          recommendation: 'Make the primary offer and next step visible together.',
        }),
      ]),
    );

    // Rule findings used to store one Russian sentence that every reader saw.
    // A real scan now stores message codes, and the API renders them per report
    // language; the AI-written UX finding has no codes and keeps its own text.
    const allIssues = await agent
      .get(`/scans/${scanId}/issues?limit=100`)
      .set('Cookie', account.cookie);
    expect(allIssues.status).toBe(200);
    const ruleIssue = allIssues.body.data.find(
      (issue: { module: string; localized: unknown }) =>
        issue.module !== 'UX/Conversion' && issue.localized !== null,
    );
    expect(ruleIssue).toBeDefined();
    expect(ruleIssue.recommendation).not.toMatch(/\p{Script=Cyrillic}/u);
    expect(ruleIssue.localized.en.recommendation).toBe(ruleIssue.recommendation);
    expect(ruleIssue.localized.uk.recommendation).toEqual(expect.any(String));
    expect(ruleIssue.localized.uk.recommendation).not.toBe(ruleIssue.recommendation);
    // Taken from the UX-filtered page above, not from the unfiltered one: a
    // Complete scan has more than 100 issues, ordered by severity and then by
    // fingerprint — which hashes the fixture's random loopback port — so the AI
    // finding lands on the first unfiltered page only in some runs.
    const aiIssue = issues.body.data.find(
      (issue: { ruleId: string }) => issue.ruleId === 'UX-CONV-AI-001',
    );
    expect(aiIssue).toBeDefined();
    expect(aiIssue.localized).toBeNull();

    const jsonExport = await agent
      .get(`/scans/${scanId}/export?format=json`)
      .set('Cookie', account.cookie);
    expect(jsonExport.status).toBe(200);
    expect(jsonExport.body.data.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ record_type: 'module', module: 'UX/Conversion' }),
        expect.objectContaining({ record_type: 'issue', module: 'UX/Conversion' }),
        expect.objectContaining({
          record_type: 'ai_response',
          module: 'UX/Conversion',
          prompt_version: 'ux-conversion-v3',
          usage: expect.objectContaining({
            input_tokens: 220,
            output_tokens: 90,
            total_tokens: 310,
          }),
          deletion_evidence_ref: expect.stringContaining('ai-001/deletion/'),
          raw_text: expect.stringContaining('Make the primary offer'),
        }),
        expect.objectContaining({
          record_type: 'ai_response',
          module: 'AI SEO / GEO',
          prompt_version: 'geo-query-generation-v2',
          raw_text: expect.stringContaining('questions'),
        }),
      ]),
    );
  }, 15_000);

  it('keeps static UX evidence when AI consent is absent and explains the partial result', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      createPerformanceRunner: () => undefined,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'ux-no-consent-e2e@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await agent
      .post('/billing/dev-checkout')
      .set('Cookie', account.cookie)
      .send({
        siteProfileId: profile.id,
        plan: 'Complete',
        scope: { includeSubdomains: false, maxPages: 1, maxDepth: 0 },
      });

    expect(checkout.status).toBe(201);
    const scanId = checkout.body.data.scanId as string;
    await runScan(scanId, () => uxAwareProvider(profile.name), `${fixture.origin}/empty.html`);

    const scan = await agent.get(`/scans/${scanId}`).set('Cookie', account.cookie);
    expect(scan.status).toBe(200);
    const ux = scan.body.data.modules.find(
      (module: { module: string }) => module.module === 'UX/Conversion',
    );
    expect(ux).toMatchObject({
      module: 'UX/Conversion',
      status: 'Partial',
      statusReason: 'UxAiConsentMissing',
      coverage: 0.75,
      applicableChecks: 4,
      completedApplicableChecks: 3,
      usableOutput: true,
      // D-218: the three static checks that ran score the section — a missing
      // h1 and a missing action on the entry page cost 3 each (Medium, 1 of 1).
      score: 94,
      metadata: {
        staticSignals: { pagesAnalyzed: expect.any(Number) },
        ai: { status: 'Unavailable', statusReason: 'UxAiConsentMissing', findings: 0 },
      },
    });
    // The static checks are listed with their own counts; the AI ones are not,
    // because a review without consent never looked at the pages.
    expect(ux.metadata.ruleChecks.map((check: { ruleId: string }) => check.ruleId)).toEqual([
      'UX-CONV-STATIC-001',
      'UX-CONV-STATIC-002',
      'UX-CONV-STATIC-003',
    ]);
    expect(ux.metadata.ruleChecks[0]).toMatchObject({ applicableTargets: 1, affectedTargets: 1 });

    const issues = await agent
      .get(`/scans/${scanId}/issues?limit=100`)
      .set('Cookie', account.cookie);
    expect(issues.status).toBe(200);
    expect(issues.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module: 'UX/Conversion',
          ruleId: 'UX-CONV-STATIC-001',
          evidenceType: 'dom',
        }),
        expect.objectContaining({
          module: 'UX/Conversion',
          ruleId: 'UX-CONV-STATIC-002',
          evidenceType: 'dom',
        }),
      ]),
    );
    expect(
      issues.body.data.some((issue: { ruleId: string }) => issue.ruleId.startsWith('UX-CONV-AI-')),
    ).toBe(false);
  }, 15_000);

  // D-219: connecting Google used to add numbers to the report and check
  // nothing. The Analytics section now runs its checks after the scan outcome is
  // settled, scores them, and puts its findings in the Issue Center and export.
  it('scores Analytics from the connected Google data and exports its findings', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      createPerformanceRunner: () => undefined,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'analytics-e2e@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await agent
      .post('/billing/dev-checkout')
      .set('Cookie', account.cookie)
      .send({
        siteProfileId: profile.id,
        plan: 'Complete',
        scope: { includeSubdomains: false, maxPages: 3 },
      });
    expect(checkout.status).toBe(201);
    const scanId = checkout.body.data.scanId as string;

    await runScan(
      scanId,
      () => uxAwareProvider(profile.name),
      fixture.origin,
      connectedGoogle(fixture.origin),
    );

    const scan = await agent.get(`/scans/${scanId}`).set('Cookie', account.cookie);
    expect(scan.status).toBe(200);
    const analytics = scan.body.data.modules.find(
      (module: { module: string }) => module.module === 'Analytics',
    );
    expect(analytics).toMatchObject({
      status: 'Completed',
      usableOutput: true,
      applicableChecks: 8,
      completedApplicableChecks: 8,
      metadata: {
        source: 'google',
        analysis: {
          trend: { metric: 'clicks', previous: 100, current: 40 },
          nearTop: [{ query: 'fixture audit', impressions: 60, position: 14 }],
        },
      },
    });
    expect(analytics.metadata.ruleChecks).toHaveLength(8);
    // The fall in clicks (High, 10) and the missing key events (Medium, 3) are
    // site-level and cost in full; the crawled pages without impressions add a
    // Low share on top.
    expect(analytics.score).toBeLessThanOrEqual(87);
    expect(analytics.score).toBeGreaterThanOrEqual(86);
    // A side score (§15): it carries no weight in the overall score.
    const dashboard = await agent.get(`/scans/${scanId}/dashboard`).set('Cookie', account.cookie);
    expect(dashboard.status).toBe(200);
    expect(
      dashboard.body.data.overall.moduleWeights.map((weight: { module: string }) => weight.module),
    ).not.toContain('Analytics');

    const issues = await agent
      .get(`/scans/${scanId}/issues?limit=100&module=Analytics`)
      .set('Cookie', account.cookie);
    expect(issues.status).toBe(200);
    const trend = issues.body.data.find(
      (issue: { ruleId: string }) => issue.ruleId === 'ANALYTICS-SC-001',
    );
    expect(trend).toMatchObject({ module: 'Analytics', severity: 'High' });
    expect(trend.localized.uk.evidenceExcerpt).toContain('Органічні кліки впали');
    expect(
      issues.body.data.some((issue: { ruleId: string }) => issue.ruleId === 'ANALYTICS-GA-001'),
    ).toBe(true);

    const exportScan = await db.prisma.scan.findUniqueOrThrow({
      where: { id: scanId },
      include: { modules: true, issues: true, aiResponses: true },
    });
    const validation = validateExportRecords(buildExportRecords(exportScan));
    expect(validation).toMatchObject({ ok: true });
  }, 20_000);

  it('degrades an unavailable AI provider and still completes Performance', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'ux-provider-timeout@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await agent
      .post('/billing/dev-checkout')
      .set('Cookie', account.cookie)
      .send({
        siteProfileId: profile.id,
        plan: 'Complete',
        scope: { includeSubdomains: false, maxPages: 1, maxDepth: 0 },
        aiConsent: {
          providers: ['anthropic'],
          noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
        },
      });

    expect(checkout.status).toBe(201);
    const scanId = checkout.body.data.scanId as string;
    const result = await processScan(
      {
        prisma: db.prisma,
        logger: silentLogger,
        createAiProvider: () => ({
          config: AI_CONFIG,
          send: () => {
            throw new UnavailableError('Anthropic request timed out');
          },
        }),
        createPerformanceRunner: () => async (origin, strategy) => ({
          source: 'pagespeed',
          origin,
          strategy,
          performanceScore: 71,
          metrics: { lcpMs: 2_400 },
          fetchedAt: '2026-09-10T23:00:00.000Z',
        }),
        crawl: { originOverride: () => fixture.origin, dangerouslyAllowLoopback: true },
      },
      scanId,
    );

    expect(result.outcome).not.toBe('Failed');
    const scan = await agent.get(`/scans/${scanId}`).set('Cookie', account.cookie);
    expect(scan.body.data.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module: 'UX/Conversion',
          status: 'Partial',
          statusReason: 'UxAiProviderUnavailable',
          usableOutput: true,
        }),
        expect.objectContaining({
          module: 'Performance',
          status: 'Completed',
          score: 71,
          usableOutput: true,
        }),
      ]),
    );
  }, 15_000);

  it('terminalizes incomplete modules after an exhausted platform retry so export stays valid', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'ux-platform-failure@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await agent
      .post('/billing/dev-checkout')
      .set('Cookie', account.cookie)
      .send({
        siteProfileId: profile.id,
        plan: 'Complete',
        scope: { includeSubdomains: false, maxPages: 1, maxDepth: 0 },
        aiConsent: {
          providers: ['anthropic'],
          noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
        },
      });

    expect(checkout.status).toBe(201);
    const scanId = checkout.body.data.scanId as string;
    const result = await runScan(scanId, () => ({
      config: AI_CONFIG,
      send: () => {
        throw new Error('unexpected adapter bug');
      },
    }));

    expect(result.outcome).toBe('Failed');
    const modules = await db.prisma.scanModule.findMany({ where: { scanId } });
    expect(modules.some((module) => ['Pending', 'Running'].includes(module.runtimeStatus))).toBe(
      false,
    );
    expect(
      modules
        .filter((module) => module.runtimeStatus !== 'Completed')
        .every((module) => module.statusReason === 'PlatformFailureBeforeCompletion'),
    ).toBe(true);

    const exportScan = await db.prisma.scan.findUniqueOrThrow({
      where: { id: scanId },
      include: { modules: true, issues: true, aiResponses: true },
    });
    const validation = validateExportRecords(buildExportRecords(exportScan));
    expect(validation.ok).toBe(true);

    const jsonExport = await agent
      .get(`/scans/${scanId}/export?format=json`)
      .set('Cookie', account.cookie);
    expect(jsonExport.status).toBe(200);
    expect(jsonExport.body.data.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          record_type: 'module',
          module_status: 'Unavailable',
          status_reason: 'PlatformFailureBeforeCompletion',
        }),
      ]),
    );
  }, 15_000);

  it('treats an obsolete AI notice as no consent and never calls the provider', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      createPerformanceRunner: () => undefined,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'ux-obsolete-consent-e2e@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await agent
      .post('/billing/dev-checkout')
      .set('Cookie', account.cookie)
      .send({
        siteProfileId: profile.id,
        plan: 'Complete',
        scope: { includeSubdomains: false, maxPages: 1, maxDepth: 0 },
        aiConsent: { providers: ['anthropic'], noticeVersion: 'v1' },
      });

    expect(checkout.status).toBe(201);
    const scanId = checkout.body.data.scanId as string;
    await runScan(scanId, () => ({
      config: AI_CONFIG,
      send: () => {
        throw new Error('obsolete consent must prevent provider calls');
      },
    }));

    const scan = await agent.get(`/scans/${scanId}`).set('Cookie', account.cookie);
    expect(scan.status).toBe(200);
    expect(scan.body.data.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module: 'AI SEO / GEO',
          status: 'Unavailable',
          statusReason: expect.stringContaining('ConsentMissing'),
          usableOutput: false,
        }),
        expect.objectContaining({
          module: 'UX/Conversion',
          status: 'Partial',
          statusReason: 'UxAiConsentMissing',
          coverage: 0.75,
          usableOutput: true,
        }),
      ]),
    );
    expect(await db.prisma.aiResponseRecord.count({ where: { scanId } })).toBe(0);
  }, 15_000);

  async function register(
    agent: TestAgent,
    email: string,
  ): Promise<{ cookie: string; id: string }> {
    const response = await agent
      .post('/auth/register')
      .send({ email, password: 'correct-horse-1' });
    expect(response.status).toBe(201);
    const cookie = response.headers['set-cookie']?.[0]?.split(';', 1)[0];
    if (cookie === undefined) throw new Error('registration did not set a session cookie');
    return { cookie, id: response.body.data.accountId as string };
  }

  async function createProfile(
    agent: TestAgent,
    cookie: string,
  ): Promise<{ id: string; name: string }> {
    const response = await agent.post('/profiles').set('Cookie', cookie).send({
      name: 'Smile Clinic',
      domain: 'https://smile.example',
      industry: 'Dental clinic',
      region: 'Kyiv',
      language: 'Ukrainian',
      businessDescription: 'A dental clinic for families in Kyiv.',
      offerings: 'Implants and emergency appointments',
      targetLanguages: 'Ukrainian, English',
      targetAudience: 'Families looking for dental care',
    });
    expect(response.status).toBe(201);
    return { id: response.body.data.id as string, name: response.body.data.name as string };
  }

  async function runScan(
    scanId: string,
    createAiProvider: AiFactory,
    origin = fixture.origin,
    createGoogleDataRunner?: WorkerDeps['createGoogleDataRunner'],
  ) {
    return processScan(
      {
        prisma: db.prisma,
        logger: silentLogger,
        createAiProvider,
        createPerformanceRunner: () => undefined,
        crawl: { originOverride: () => origin, dangerouslyAllowLoopback: true },
        ...(createGoogleDataRunner === undefined ? {} : { createGoogleDataRunner }),
      },
      scanId,
    );
  }

  /**
   * Google data for the fixture site: organic clicks fell from 100 to 40, only
   * the homepage earned impressions, and a busy GA4 property has no key events.
   */
  function connectedGoogle(origin: string): WorkerDeps['createGoogleDataRunner'] {
    const home = `${origin}/`;
    const data: GoogleScanData = {
      snapshot: {
        source: 'google',
        readOnly: true,
        fetchedAt: '2026-09-18T10:00:00.000Z',
        dateRange: { startDate: '2026-08-19', endDate: '2026-09-15' },
        searchConsole: {
          state: 'connected',
          detail: 'ok',
          data: {
            siteUrl: home,
            totals: { clicks: 40, impressions: 3000, ctr: 0.013, position: 9 },
            previousTotals: { clicks: 100, impressions: 3200, ctr: 0.031, position: 8 },
            topQueries: [],
            topPages: [{ key: home, clicks: 40, impressions: 3000, ctr: 0.013, position: 9 }],
          },
        },
        analytics: {
          state: 'connected',
          detail: 'ok',
          data: {
            propertyId: '123456',
            propertyName: 'Fixture GA4',
            users: 400,
            sessions: 520,
            pageViews: 1400,
            events: 3900,
            keyEvents: 0,
          },
        },
      },
      searchConsoleDetail: {
        queries: [{ key: 'fixture audit', clicks: 0, impressions: 60, ctr: 0, position: 14 }],
        pages: [{ key: home, clicks: 40, impressions: 3000, ctr: 0.013, position: 9 }],
        pagesComplete: true,
      },
    };
    return () => async () => data;
  }

  function uxAwareProvider(brand: string): AiProvider {
    return new MockAiProvider(
      [
        ...defaultGeoFixtures(brand, 'smile.example'),
        {
          questionIncludes: `Review ${brand}`,
          response: {
            id: 'ux-e2e-response',
            status: 'completed',
            output_text: JSON.stringify({
              findings: [
                {
                  ruleId: 'UX-CONV-AI-001',
                  targetUrl: `${fixture.origin}/`,
                  severity: 'Medium',
                  evidence:
                    'The homepage explains the audit fixture but not a primary customer offer.',
                  recommendation: 'Make the primary offer and next step visible together.',
                  confidence: 0.91,
                },
              ],
            }),
            usage: { input_tokens: 220, output_tokens: 90 },
          },
        },
      ],
      { config: AI_CONFIG },
    );
  }
});
