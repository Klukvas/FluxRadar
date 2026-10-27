import { readFileSync } from 'node:fs';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionPlanState, Dashboard, Scan } from './api';
import type { Language } from './i18n';
import type { CrawlScopeFacts, ReadableComparedScan, ScanComparison } from './comparison-api';
import { PrintReport } from './PrintReport';
import { printCopyFor, printSharedCopy } from './print-branded-copy';
import { readBrandingView, type BrandingView } from './report-branding-api';
import { reportBrandingCopy } from './report-branding-copy';

const brand: BrandingView = {
  enabled: true,
  displayName: 'Studio Blue',
  accentColor: '#123456',
  contactLine: 'hello@example.com',
  logo: { dataUrl: 'data:image/png;base64,aGVsbG8=', width: 200, height: 50, byteLength: 5 },
  updatedAt: '2026-10-26T00:00:00Z',
};
const forbidden = /fluxradar(?!bot)|fluxlab|flux-lab|FluxRadarBot/i;
function dashboard(plan: Scan['plan'] = 'Complete'): Dashboard {
  return {
    scan: {
      id: 'scan-print',
      profileId: 'profile-1',
      plan,
      domain: 'https://example.com',
      status: 'Completed',
      statusReason: null,
      scope: { includeSubdomains: false },
      rulesetVersion: 'rules-1',
      progress: { completedModules: 1, totalModules: 1 },
      startedAt: '2026-10-01T00:00:00Z',
      completedAt: '2026-10-01T00:01:00Z',
      createdAt: '2026-10-01T00:00:00Z',
      modules: [],
    },
    overall: { verdict: 'ok', score: 90, weightedCoverage: 1, moduleWeights: [] },
    modules: [
      {
        module: 'SEO',
        status: 'Completed',
        statusReason: null,
        usableOutput: true,
        coverage: 1,
        score: 90,
        applicableChecks: 1,
        completedApplicableChecks: 1,
      },
    ],
    geoObservations: [],
  };
}
const planState: ActionPlanState = {
  scanId: 'scan-print',
  languages: ['en', 'uk'],
  running: null,
  lastFailure: null,
  remaining: { successes: 2, attempts: 5 },
  windowEndsAt: null,
  plan: {
    language: 'en',
    overview: 'Useful next steps',
    actions: [
      {
        title: 'Add titles',
        why: 'Describe each page',
        steps: ['Write titles'],
        effort: 'small',
        ruleIds: ['SEO-ONPAGE-001'],
        openIssues: 1,
        totalIssues: 1,
        settled: false,
      },
    ],
    reach: { share: 1, rules: 1, addressedOpenIssues: 1, totalOpenIssues: 1 },
    caveats: ['SEO'],
    generatedAt: '2026-10-01T00:00:00Z',
    modelId: 'private-model',
    noticeVersion: 'private-prompt',
  },
};
function envelope(data: unknown, extra: object = {}): Response {
  return new Response(JSON.stringify({ success: true, data, error: null, ...extra }), {
    headers: { 'content-type': 'application/json' },
  });
}
function stub(
  options: {
    branding?: unknown;
    failed?: boolean;
    dashboard?: Dashboard;
    action?: boolean;
    comparison?: ScanComparison;
  } = {},
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const path = String(input);
      if (path.includes('/account/branding'))
        return options.failed
          ? Promise.resolve(
              new Response(
                JSON.stringify({ success: false, error: { code: 'INTERNAL', message: 'failed' } }),
                { status: 500 },
              ),
            )
          : Promise.resolve(envelope(options.branding === undefined ? brand : options.branding));
      if (path.includes('/action-plan'))
        return Promise.resolve(envelope(options.action ? planState : null));
      if (path.includes('/comparison'))
        return Promise.resolve(envelope(options.comparison ?? null));
      if (path.includes('/issues/summary'))
        return Promise.resolve(envelope({ total: 0, open: 0, bySeverity: {}, groups: [] }));
      if (path.includes('/issues'))
        return Promise.resolve(envelope([], { meta: { total: 0, page: 1, limit: 100 } }));
      return Promise.resolve(envelope(options.dashboard ?? dashboard()));
    }),
  );
}
async function show(language: Language = 'uk'): Promise<HTMLElement> {
  render(
    <PrintReport
      scanId="scan-print"
      language={language}
      onBack={() => {}}
      onError={(value) => {
        throw new Error(value);
      }}
    />,
  );
  await waitFor(() => expect(document.querySelector('.print-document')).not.toBeNull());
  return document.querySelector('.print-document') as HTMLElement;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const KYIV = {
  id: 'ua',
  countryCode: 'UA',
  city: 'Kyiv',
  label: { en: 'Ukraine, Kyiv', uk: 'Україна, Київ' },
};
function scope(): CrawlScopeFacts {
  return {
    entryUrl: 'https://smile.example',
    maxPages: 500,
    maxDepth: 5,
    includeSubdomains: false,
    queryPolicy: 'ignore',
    urlPatterns: [],
    excludePatterns: [],
    seedUrls: [],
    renderJs: false,
    respectRobots: true,
    userAgent: 'desktop',
    egressLocation: KYIV.id,
    egressLocationView: KYIV,
    scopeKey: 'scope-v3:same',
  };
}

const comparedSide = (id: string, completedAt: string): ReadableComparedScan => ({
  id,
  plan: 'Complete',
  status: 'Completed',
  completedAt,
  pagesRead: 12,
  urlsDiscovered: 12,
  urlsOverLimit: 0,
  scope: scope(),
  readable: true,
});

function comparisonOf(overrides: Partial<ScanComparison> = {}): ScanComparison {
  return {
    current: comparedSide('scan-print', '2026-09-22T00:01:00.000Z'),
    previous: comparedSide('scan-earlier', '2026-09-08T00:01:00.000Z'),
    comparable: { ok: true },
    overall: { previousScore: 61, currentScore: 90, delta: 29 },
    modules: [],
    pages: {
      comparable: { ok: true },
      identity: 'canonical-document',
      added: 2,
      removed: 0,
      kept: 10,
      currentTotal: 12,
      previousTotal: 10,
      addedSample: [],
      removedSample: [],
    },
    issues: {
      new: 1,
      resolved: 7,
      reopened: 0,
      stillOpen: 3,
      settled: 2,
      byModule: [],
      bySeverity: [],
      newSample: [],
      resolvedSample: [],
      firstChecked: {
        known: true,
        count: 0,
        byModule: [],
        bySeverity: [],
        ruleIds: [],
        sample: [],
      },
      noLongerChecked: [],
    },
    ...overrides,
  };
}

function inventory(value: unknown, path = ''): readonly [string, string | null][] {
  if (typeof value === 'string') return [[path, value]];
  if (typeof value === 'function')
    return [[path, String(Reflect.apply(value, null, ['x', 2, '2026-01-01', 2]))]];
  return typeof value === 'object' && value !== null
    ? [
        [path, null],
        ...Object.entries(value).flatMap(([key, child]) => inventory(child, `${path}.${key}`)),
      ]
    : [];
}
describe.each(['uk', 'en'] as const)('branded print copy %s', (language) => {
  it('walks every reachable copy leaf and guards references in both print components', () => {
    const walked = inventory({ ...printCopyFor(language, true), ...printSharedCopy(language) });
    for (const [, text] of walked) if (text !== null) expect(text).not.toMatch(forbidden);
    const sources = ['PrintReport.tsx', 'ScanComparisonPrint.tsx']
      .map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'))
      .join('\n');
    const references = [...sources.matchAll(/\b(?:t|f)\.([A-Za-z][\w]*(?:\.[A-Za-z][\w]*)*)/g)].map(
      (match) => match[1] ?? '',
    );
    for (const reference of references)
      expect(
        walked.some(([path]) => path.endsWith(`.${reference}`)),
        `unwalked copy reference ${reference}`,
      ).toBe(true);
  });
  it.each(['normal', 'action-plan', 'comparison', 'robots-blocked', 'nothing-checked'])(
    'sweeps the %s document, title and image alts',
    async (fixture) => {
      const original = dashboard();
      const unread = fixture === 'robots-blocked';
      const nothing = unread || fixture === 'nothing-checked';
      const scan = {
        ...original.scan,
        ...(nothing ? { status: 'Failed', statusReason: 'SiteReturnedNoReadablePage' } : {}),
        ...(unread
          ? {
              crawlSummary: {
                reach: 'blocked-by-robots' as const,
                startStatus: null,
                accessControlSignals: [],
                pagesRead: 0,
                pagesFetched: 0,
                urlsDiscovered: 0,
                urlsOverLimit: 0,
                urlsBlockedByRobots: 1,
                limitedBy: null,
                maxPages: 100,
              },
            }
          : {}),
      };
      stub({
        dashboard: {
          ...original,
          scan,
          modules: nothing
            ? original.modules.map((module) => ({
                ...module,
                status: 'Unavailable',
                usableOutput: false,
                score: null,
              }))
            : original.modules,
        },
        action: fixture === 'action-plan',
        comparison: fixture === 'comparison' ? comparisonOf() : undefined,
      });
      const article = await show(language);
      expect(article.textContent).toContain(brand.displayName);
      expect(article.textContent).not.toMatch(forbidden);
      expect(document.title).not.toMatch(forbidden);
      article.querySelectorAll('img').forEach((img) => expect(img.alt).not.toMatch(forbidden));
      expect(article.style.getPropertyValue('--print-brand')).toBe('#123456');
      expect(
        screen.getByText(reportBrandingCopy[language].brandApplied(brand.displayName), {
          exact: false,
        }),
      ).toBeInTheDocument();
      if (fixture === 'action-plan') {
        expect(article.textContent).not.toMatch(/private-model|private-prompt/);
        expect(article.textContent).toContain(printCopyFor(language, true).actionPlan.aiLabel);
      }
      if (fixture === 'comparison')
        expect(article.querySelector('.print-comparison')).not.toBeNull();
    },
  );
});
it.each([
  { accentColor: 'red;background:url(x)' },
  { logo: { ...brand.logo, dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' } },
])('rejects hostile brand styles or image source', async (patch) => {
  expect(readBrandingView({ ...brand, ...patch })).toBe('invalid');
  stub({ branding: { ...brand, ...patch } });
  const article = await show();
  expect(article.textContent).toContain('FluxRadar');
});
it('ignores a dashboard-shaped branding response without a notice', async () => {
  stub({ branding: dashboard() });
  const article = await show();
  expect(article.textContent).toContain('FluxRadar');
  expect(document.querySelector('.print-toolbar')?.textContent).not.toContain(
    reportBrandingCopy.uk.brandFailed,
  );
});
it('shows a toolbar failure and renders the original document for a rejected request', async () => {
  stub({ failed: true });
  const article = await show();
  expect(article.textContent).toContain('FluxRadar');
  expect(screen.getByText(reportBrandingCopy.uk.brandFailed)).toBeInTheDocument();
});
it('keeps Basic unbranded even when account branding is enabled', async () => {
  stub({ dashboard: dashboard('Basic') });
  const article = await show();
  expect(article.textContent).toContain('FluxRadar');
  expect(article).not.toHaveClass('print-document--branded');
});
