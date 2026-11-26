import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { freePreviewCopy } from './free-preview-copy';
import { freeReportCopy } from './free-report-copy';
import { FULL_SCORE_MAX, freeScoreCopy } from './free-score-copy';
import { ResultsScreen } from './Report';
import type { GeoObservation, Scan, ScanModule } from './api';
import { BASIC_PRICE } from './tariff-prices';

// ─── The scored Free report and its AI preview (D-236) ───────────────────────
//
// Free carries a homepage score and, with the owner's opt-in, one real GEO
// answer. A separate catalog describes the checks a new paid audit can run;
// the AI block never suggests that hidden paid results already exist.
// ─────────────────────────────────────────────────────────────────────────────

const REAL_ANSWER = 'Smile Clinic is a dental practice I know little else about.';
const REAL_QUESTION = 'What do you know about Smile Clinic?';

function scanOf(plan: Scan['plan']): Scan {
  return {
    id: 'scan-free',
    profileId: 'profile-1',
    plan,
    domain: 'https://smile.example',
    status: 'Completed',
    statusReason: null,
    scope: { includeSubdomains: false },
    rulesetVersion: 'rules-v1',
    progress: { completedModules: 2, totalModules: 2 },
    startedAt: '2026-11-06T00:00:00.000Z',
    completedAt: '2026-11-06T00:01:00.000Z',
    createdAt: '2026-11-06T00:00:00.000Z',
    modules: [],
  } as unknown as Scan;
}

const SEO: ScanModule = {
  module: 'SEO',
  status: 'Completed',
  statusReason: null,
  coverage: 1,
  score: 35,
  scoreMax: 40,
  applicableChecks: 4,
  completedApplicableChecks: 4,
  usableOutput: true,
  metadata: { freeCheck: true, scope: 'homepage only', scoreScope: 'homepage' },
};

function geoModule(overrides: Partial<ScanModule> = {}): ScanModule {
  return {
    module: 'AI SEO / GEO',
    status: 'Completed',
    statusReason: null,
    coverage: 1,
    score: null,
    applicableChecks: 2,
    completedApplicableChecks: 2,
    usableOutput: true,
    metadata: { scoring: 'InformationalOnly', freePreview: true },
    ...overrides,
  };
}

const ANSWERED: GeoObservation = {
  purpose: 'closed-book',
  question: REAL_QUESTION,
  status: 'answered',
  reason: null,
  provider: 'anthropic',
  modelId: 'claude-sonnet-5',
  answer: REAL_ANSWER,
  citations: [],
  mentions: null,
  evaluation: null,
} as GeoObservation;

function freeDashboard(modules: readonly ScanModule[], observations: readonly GeoObservation[]) {
  const scan = scanOf('Free');
  return {
    scan,
    overall: {
      verdict: 'normal',
      score: 35,
      scoreMax: 40,
      weightedCoverage: 1,
      moduleWeights: [{ module: 'SEO', tariffWeight: 1, effectiveWeight: 1 }],
    },
    modules,
    geoObservations: observations,
    geoEvidence: null,
    geoVisibilitySummary: null,
  };
}

function renderDashboard(dashboard: { scan: Scan }, onUpgrade = vi.fn()) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, data: dashboard, error: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
  render(
    <ResultsScreen
      scan={dashboard.scan}
      language="en"
      onScan={() => {}}
      onIssues={() => {}}
      onReports={() => {}}
      onError={() => {}}
      onUpgrade={onUpgrade}
    />,
  );
  return onUpgrade;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a scored Free report', () => {
  it('shows the score as a homepage score, never as the site score', async () => {
    renderDashboard(freeDashboard([SEO, geoModule()], [ANSWERED]));
    const meter = await screen.findByRole('meter', { name: 'Homepage score' });
    expect(meter).toHaveTextContent('35 / 40');
    expect(screen.queryByText('Not scored on this plan')).toBeNull();
  });

  it('shows the one real GEO answer in the AI block, and only there', async () => {
    renderDashboard(freeDashboard([SEO, geoModule()], [ANSWERED]));
    const block = await screen.findByRole('region', { name: 'What AI says about your business' });
    // Unevaluated, so the answer is the block's content and starts open.
    expect(within(block).getByText(REAL_ANSWER)).toBeVisible();
    // The question itself is never shown on a Free report (owner decision).
    expect(screen.queryByText(REAL_QUESTION)).toBeNull();
    // The GEO card offers no checks panel that would print the answer again.
    expect(screen.queryByRole('button', { name: 'Show checks' })).toBeNull();
    expect(screen.getAllByText(REAL_ANSWER)).toHaveLength(1);
  });

  it('leads an evaluated answer with the headline and keeps quotes and the answer closed', async () => {
    const evaluated = {
      ...ANSWERED,
      evaluation: {
        status: 'Completed',
        reason: null,
        overall: 'contradicts-evidence',
        answerDescribesSubject: true,
        claims: [
          {
            claim: 'It is a dental practice',
            verdict: 'matched',
            answerQuote: 'a dental practice',
            sourceId: null,
            sourceQuote: 'Dental care in Kyiv',
          },
          {
            claim: 'It is in Lviv',
            verdict: 'contradicted',
            answerQuote: 'based in Lviv',
            sourceId: null,
            sourceQuote: 'Kyiv',
          },
        ],
        provider: 'anthropic',
        modelId: 'claude-judge-5',
      },
    } as GeoObservation;
    renderDashboard(freeDashboard([SEO, geoModule()], [evaluated]));
    const block = await screen.findByRole('region', { name: 'What AI says about your business' });
    const t = freePreviewCopy.en.preview;
    expect(within(block).getByText(t.headline.mismatch)).toBeVisible();
    const claims = within(block).getByRole('list', { name: t.claimsLabel });
    expect(within(claims).getAllByRole('listitem')[0]).toHaveTextContent('It is in Lviv');
    // The old dense layout printed these under every claim; now they wait in "Show details".
    expect(within(block).getByText(/“based in Lviv”/)).not.toBeVisible();
    expect(within(block).getByText(t.detailsScope)).not.toBeVisible();
    expect(within(block).getByText(REAL_ANSWER)).not.toBeVisible();
    expect(screen.queryByText(REAL_QUESTION)).toBeNull();
  });

  it('lists the GEO preview as a preview of the paid check, not as included in Free', async () => {
    renderDashboard(freeDashboard([SEO, geoModule()], [ANSWERED]));
    const included = await screen.findByRole('region', { name: 'Ran in this report' });
    const locked = screen.getByRole('region', { name: 'Only on paid plans' });
    expect(within(included).queryByText('AI SEO / GEO')).toBeNull();
    expect(within(included).getByText('SEO')).toBeInTheDocument();
    expect(within(locked).getByText('AI SEO / GEO')).toBeInTheDocument();
    expect(
      within(locked).getByText('Preview in this report — the full section is in the paid check'),
    ).toBeInTheDocument();
    // The preview names no plan: every upgrade on a Free report leads to Complete.
    const previewRow = within(locked).getByText('AI SEO / GEO').closest('li');
    expect(previewRow).not.toHaveTextContent(/Basic|Complete/);
    expect(freePreviewCopy.uk.scopePreview).toBe(
      'Превʼю в цьому звіті — повний розділ у платній перевірці',
    );
  });

  it('does not call a preview that asked nothing a preview in the scope list', async () => {
    const notRun = geoModule({
      status: 'Not applicable',
      statusReason: 'ConsentMissing',
      coverage: 0,
      applicableChecks: 0,
      completedApplicableChecks: 0,
      usableOutput: false,
    });
    renderDashboard(freeDashboard([SEO, notRun], []));
    const locked = await screen.findByRole('region', { name: 'Only on paid plans' });
    const included = screen.getByRole('region', { name: 'Ran in this report' });
    expect(within(included).queryByText('AI SEO / GEO')).toBeNull();
    expect(within(locked).queryByText(/Preview in this report/)).toBeNull();
    expect(within(locked).getAllByText('Included in Basic')).toHaveLength(1);
  });

  it('words an already-requested preview as a step reached, not a request made', async () => {
    const repeated = geoModule({
      status: 'Not applicable',
      statusReason: 'FreePreviewAlreadyRequested',
      coverage: 0,
      applicableChecks: 0,
      completedApplicableChecks: 0,
      usableOutput: false,
    });
    renderDashboard(freeDashboard([SEO, repeated], []));
    const block = await screen.findByRole('region', { name: 'What AI says about your business' });
    expect(within(block).getByRole('note')).toHaveTextContent(
      'an earlier run of this check already reached the AI step',
    );
  });

  it('says why an allowlisted origin got no AI answer', async () => {
    const skipped = geoModule({
      status: 'Not applicable',
      statusReason: 'FreePreviewAllowlistedOrigin',
      coverage: 0,
      applicableChecks: 0,
      completedApplicableChecks: 0,
      usableOutput: false,
    });
    renderDashboard(freeDashboard([SEO, skipped], []));
    const block = await screen.findByRole('region', { name: 'What AI says about your business' });
    expect(within(block).getByRole('note')).toHaveTextContent(
      'operator’s list for repeated free checks',
    );
    expect(screen.getByRole('meter', { name: 'Homepage score' })).toHaveTextContent('35 / 40');
  });

  it('shows no blurred teaser or unlock action for results that do not exist', async () => {
    renderDashboard(freeDashboard([SEO, geoModule()], [ANSWERED]));
    await screen.findByRole('region', { name: 'What AI says about your business' });
    expect(screen.queryByTestId('free-locked-decoys')).toBeNull();
    expect(screen.queryByRole('button', { name: /Unlock/ })).toBeNull();
  });

  it('leads Complete audit buttons to the Complete scan form', async () => {
    const onUpgrade = renderDashboard(freeDashboard([SEO, geoModule()], [ANSWERED]));
    const scoreButton = await screen.findByRole('button', {
      // From the score copy itself: its wording is owned there, not here.
      name: freeScoreCopy.en.upgrade(FULL_SCORE_MAX),
    });
    const upsellButton = await screen.findByRole('button', {
      name: /^Run the complete verification for /,
    });
    for (const button of [scoreButton, upsellButton]) {
      onUpgrade.mockClear();
      fireEvent.click(button);
      expect(onUpgrade).toHaveBeenCalledWith(expect.objectContaining({ plan: 'Free' }), 'Complete');
    }
  });

  it('says the AI question was not asked when the owner did not opt in', async () => {
    const notRun = geoModule({
      status: 'Not applicable',
      statusReason: 'ConsentMissing',
      coverage: 0,
      applicableChecks: 0,
      completedApplicableChecks: 0,
      usableOutput: false,
    });
    renderDashboard(freeDashboard([SEO, notRun], []));
    const block = await screen.findByRole('region', { name: 'What AI says about your business' });
    expect(within(block).getByRole('note')).toHaveTextContent(
      'you chose not to include the AI answer',
    );
    // The score is still there, and the card's reason is the owner's choice,
    // not a missing purchase notice.
    expect(screen.getByRole('meter', { name: 'Homepage score' })).toHaveTextContent('35 / 40');
    expect(
      screen.getByText(/the AI answer was not included when this free check/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/New paid audits record it automatically/)).toBeNull();
  });
});

// The report that prompted these: a well-built site got a full homepage score,
// no findings, and — at the very bottom, under a neutral sentence — an AI
// answer saying it had never heard of the business. The one finding that was
// about the owner was the last thing on the page.
describe('a Free report whose AI answer did not describe the business', () => {
  const UNKNOWN_ANSWER = 'I have no information about Smile Clinic.';

  function evaluated(answerDescribesSubject: boolean): GeoObservation {
    return {
      ...ANSWERED,
      answer: UNKNOWN_ANSWER,
      evaluation: {
        status: 'Completed',
        reason: null,
        overall: 'no-description',
        answerDescribesSubject,
        claims: [],
        provider: 'anthropic',
        modelId: 'claude-judge-5',
      },
    } as GeoObservation;
  }

  it('says so in the headline and shows the answer that says it', async () => {
    renderDashboard(freeDashboard([SEO, geoModule()], [evaluated(false)]));
    const block = await screen.findByRole('region', { name: 'What AI says about your business' });
    const t = freePreviewCopy.en.preview;

    expect(within(block).getByText(t.headline['not-described'])).toBeVisible();
    expect(within(block).getByText(UNKNOWN_ANSWER)).toBeVisible();
    expect(within(block).queryByText(t.headline['nothing-checkable'])).toBeNull();
  });

  it('offers the plan that runs the AI section, from inside the block', async () => {
    const onUpgrade = renderDashboard(freeDashboard([SEO, geoModule()], [evaluated(false)]));
    const block = await screen.findByRole('region', { name: 'What AI says about your business' });

    expect(within(block).getByText(freePreviewCopy.en.preview.notDescribedNext)).toBeVisible();
    fireEvent.click(
      within(block).getByRole('button', { name: freeReportCopy.en.basicAction(BASIC_PRICE) }),
    );
    expect(onUpgrade).toHaveBeenCalledWith(expect.objectContaining({ plan: 'Free' }), 'Basic');
  });

  it('keeps the neutral sentence, and sells nothing, for an answer that did describe it', async () => {
    renderDashboard(freeDashboard([SEO, geoModule()], [evaluated(true)]));
    const block = await screen.findByRole('region', { name: 'What AI says about your business' });
    const t = freePreviewCopy.en.preview;

    expect(within(block).getByText(t.headline['nothing-checkable'])).toBeVisible();
    expect(within(block).queryByText(t.notDescribedNext)).toBeNull();
    expect(within(block).queryByRole('button')).toBeNull();
  });
});

describe('where a Free report puts the AI block', () => {
  it('shows it above the upsell and the section cards', async () => {
    renderDashboard(freeDashboard([SEO, geoModule()], [ANSWERED]));
    const block = await screen.findByRole('region', { name: 'What AI says about your business' });
    const upsell = await screen.findByRole('region', {
      name: 'Your homepage is checked. The rest of the site is not',
    });
    const catalog = screen.getByRole('region', { name: 'Ran in this report' });

    expect(block.compareDocumentPosition(upsell) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(block.compareDocumentPosition(catalog) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });
});

describe('a Free report of a site whose sitemap lists more pages', () => {
  it('counts them in the upsell instead of saying only that the rest is unchecked', async () => {
    const dashboard = freeDashboard([SEO, geoModule()], [ANSWERED]);
    const scan = {
      ...dashboard.scan,
      crawlSummary: {
        reach: 'reachable',
        startStatus: 200,
        accessControlSignals: [],
        pagesRead: 1,
        pagesFetched: 1,
        urlsDiscovered: 1,
        urlsOverLimit: 0,
        urlsBlockedByRobots: 0,
        limitedBy: null,
        maxPages: 1,
        sitemap: { urls: 15, unread: 14, capped: false },
      },
    } as Scan;
    renderDashboard({ ...dashboard, scan });
    const upsell = await screen.findByRole('region', {
      name: 'Your homepage is checked. The rest of the site is not',
    });

    expect(upsell).toHaveTextContent(freeReportCopy.en.sitemapUnread(14, false));
    expect(upsell).not.toHaveTextContent('The other pages of the site have not been checked yet.');
  });
});

describe('a Free answer asked in another language than the report', () => {
  it('says so once in the lead and marks the answer with its language', async () => {
    renderDashboard(
      freeDashboard(
        [
          SEO,
          geoModule({
            metadata: { scoring: 'InformationalOnly', freePreview: true, language: 'uk' },
          }),
        ],
        [ANSWERED],
      ),
    );
    const block = await screen.findByRole('region', { name: 'What AI says about your business' });
    const lead = block.querySelector('.free-geo-answer__lead');
    expect(lead?.textContent).toMatch(/ It was asked in Ukrainian\.$/);
    expect(block.textContent).not.toContain(REAL_QUESTION);
    expect(within(block).getByText(REAL_ANSWER)).toHaveAttribute('lang', 'uk');
  });

  it('adds nothing for a row that does not record the language', async () => {
    renderDashboard(freeDashboard([SEO, geoModule()], [ANSWERED]));
    const block = await screen.findByRole('region', { name: 'What AI says about your business' });
    expect(block.querySelector('.free-geo-answer__lead')?.textContent).not.toMatch(/asked in/);
    expect(within(block).getByText(REAL_ANSWER)).not.toHaveAttribute('lang');
  });
});

describe('a paid report', () => {
  it('shows no Free AI preview and keeps the ordinary score label', async () => {
    const scan = scanOf('Basic');
    renderDashboard({
      scan,
      overall: {
        verdict: 'normal',
        score: 90,
        weightedCoverage: 1,
        moduleWeights: [
          { module: 'SEO', tariffWeight: 0.6, effectiveWeight: 0.6 },
          { module: 'AI SEO / GEO', tariffWeight: 0.4, effectiveWeight: 0.4 },
        ],
      },
      modules: [
        { ...SEO, score: 90, scoreMax: 100, metadata: {} },
        geoModule({ metadata: { scoring: 'InformationalOnly' } }),
      ],
      geoObservations: [ANSWERED],
    } as unknown as { scan: Scan });
    expect(await screen.findByLabelText('Score 90.00')).toBeInTheDocument();
    expect(screen.queryByText('Homepage score')).toBeNull();
    expect(screen.queryByRole('region', { name: 'What AI says about your business' })).toBeNull();
    expect(screen.queryByTestId('free-locked-decoys')).toBeNull();
  });
});
