import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  Dashboard,
  GeoEvaluatedClaim,
  GeoEvaluation,
  GeoEvidence,
  GeoObservation,
  Scan,
  ScanModule,
} from './api';
import { freePreviewCopy } from './free-preview-copy';
import { GeoObservationCard } from './GeoObservationCard';
import { copy, type Language } from './i18n';
import { PrintReport } from './PrintReport';
import { ResultsScreen } from './Report';

// ─── The Free report's GEO block, verdict first (D-237) ──────────────────────
//
// The owner asked that a Free report show the verdict and the checked claims,
// never the question or the provider/model, and keep the model's own answer
// behind a disclosure the reader opens. Closed <details> content is still in
// the DOM, so answer assertions use toBeVisible() and open the disclosure
// first — a plain getByText would pass on a hidden answer.
// ─────────────────────────────────────────────────────────────────────────────

const REAL_ANSWER = 'Smile Clinic is a dental practice in Kyiv, as far as I know.';
const REAL_QUESTION = 'What do you know about Smile Clinic?';
const PROVIDER = 'anthropic';
const MODEL_ID = 'claude-sonnet-5';
const CLAIM_TEXT = 'Smile Clinic is a dental practice';
const CITATION = 'https://smile.example/about';

const HEADING: Readonly<Record<Language, string>> = {
  en: 'What AI says about your business',
  uk: 'Що ШІ каже про ваш бізнес',
};
const SHOW_ANSWER: Readonly<Record<Language, string>> = {
  en: 'Show the AI’s full answer',
  uk: 'Показати повну відповідь ШІ',
};
const ANSWER_HEADING: Readonly<Record<Language, string>> = {
  en: 'The AI’s answer',
  uk: 'Відповідь ШІ',
};
const SHOW_DETAILS: Readonly<Record<Language, string>> = {
  en: 'Show details',
  uk: 'Показати подробиці',
};
const CONFIRMED: Readonly<Record<Language, string>> = { en: 'Confirmed', uk: 'Підтверджено' };
const CONTRADICTS: Readonly<Record<Language, string>> = { en: 'Contradicts', uk: 'Суперечить' };
const NOT_CONFIRMED: Readonly<Record<Language, string>> = {
  en: 'Not confirmed',
  uk: 'Не підтверджено',
};
const PROVIDER_LABEL: Readonly<Record<Language, string>> = {
  en: 'Provider/model',
  uk: 'Постачальник/модель',
};

const SCAN = {
  id: 'scan-free-geo',
  profileId: 'profile-1',
  plan: 'Free',
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

const SEO: ScanModule = {
  module: 'SEO',
  status: 'Completed',
  statusReason: null,
  coverage: 1,
  score: 35,
  scoreMax: 40,
  applicableChecks: 6,
  completedApplicableChecks: 6,
  usableOutput: true,
  metadata: { freeCheck: true, scope: 'homepage only', scoreScope: 'homepage' },
};

const GEO: ScanModule = {
  module: 'AI SEO / GEO',
  status: 'Completed',
  statusReason: null,
  coverage: 1,
  score: null,
  applicableChecks: 2,
  completedApplicableChecks: 2,
  usableOutput: true,
  metadata: { scoring: 'InformationalOnly', freePreview: true },
};

const EVIDENCE: GeoEvidence = {
  sufficiency: 'sufficient',
  limits: [],
  sources: [
    {
      id: 'src-brand',
      kind: 'profile',
      label: 'Brand name',
      url: null,
      excerpt: 'Smile Clinic',
      provenance: 'owner-entered profile field',
    },
  ],
};

const JUDGE_MODEL_ID = 'claude-judge-5';

const MATCHED_CLAIM: GeoEvaluatedClaim = {
  claim: CLAIM_TEXT,
  verdict: 'matched',
  answerQuote: 'a dental practice',
  sourceId: 'src-brand',
  sourceQuote: 'Smile Clinic',
};

const UNVERIFIED_CLAIM: GeoEvaluatedClaim = {
  claim: 'It is in Kyiv',
  verdict: 'unverified',
  answerQuote: 'in Kyiv',
  sourceId: null,
  sourceQuote: null,
};

const EVALUATED: GeoEvaluation = {
  status: 'Completed',
  reason: null,
  overall: 'partially-supported',
  answerDescribesSubject: true,
  claims: [MATCHED_CLAIM, UNVERIFIED_CLAIM],
  provider: PROVIDER,
  modelId: JUDGE_MODEL_ID,
};

const CONTRADICTED_CLAIM = 'Its brand is Northwind Digital';

/** One claim of each kind, listed with the contradiction LAST on purpose. */
const MISMATCH: GeoEvaluation = {
  ...EVALUATED,
  overall: 'contradicts-evidence',
  claims: [
    ...EVALUATED.claims,
    {
      claim: CONTRADICTED_CLAIM,
      verdict: 'contradicted',
      answerQuote: 'its brand is Northwind Digital',
      sourceId: 'src-brand',
      sourceQuote: 'Smile Clinic',
    },
  ],
};

const ALL_CONFIRMED: GeoEvaluation = {
  ...EVALUATED,
  overall: 'matches-evidence',
  claims: [MATCHED_CLAIM],
};

const EVALUATOR_FAILED: GeoEvaluation = {
  ...EVALUATED,
  status: 'Unavailable',
  reason: 'ProviderUnavailable',
  overall: null,
  claims: [],
};

function answered(evaluation: GeoEvaluation | null): GeoObservation {
  return {
    purpose: 'closed-book',
    question: REAL_QUESTION,
    status: 'answered',
    reason: null,
    provider: PROVIDER,
    modelId: MODEL_ID,
    answer: REAL_ANSWER,
    citations: [CITATION, 'javascript:alert(1)'],
    // Present on purpose: a Free block must never draw them.
    mentions: { brand: 'mentioned', domain: 'mentioned' },
    mentionContext: 'Smile Clinic is a dental practice',
    evaluation,
  };
}

const VISIBILITY_SUMMARY = {
  minMeasuredForScore: 3,
  weightBrand: 0.6,
  weightDomain: 0.4,
  providers: [
    {
      provider: 'anthropic',
      label: 'Claude · Anthropic',
      questionsAsked: 1,
      questionsAnswered: 1,
      questionsUnavailable: 0,
      brandMeasuredCount: 1,
      brandMentionedCount: 1,
      brandMentionedShare: 1,
      domainMeasuredCount: 1,
      domainCitedCount: 1,
      domainCitedShare: 1,
      visibilityScore: 77,
      scoreUnavailableReason: null,
      scoreBasis: 'brand-and-domain',
      byPurpose: {
        'closed-book': {
          asked: 1,
          answered: 1,
          brandMeasured: 1,
          domainMeasured: 1,
          brandMentioned: 1,
          domainMentioned: 1,
        },
        awareness: {
          asked: 0,
          answered: 0,
          brandMeasured: 0,
          domainMeasured: 0,
          brandMentioned: 0,
          domainMentioned: 0,
        },
        discovery: {
          asked: 0,
          answered: 0,
          brandMeasured: 0,
          domainMeasured: 0,
          brandMentioned: 0,
          domainMentioned: 0,
        },
      },
      citedInstead: [],
    },
  ],
};

function dashboardWith(
  observation: GeoObservation,
  evidence: GeoEvidence | null,
  scan: Scan = SCAN,
  geo: ScanModule = GEO,
): Dashboard {
  return {
    scan,
    overall: {
      verdict: 'normal',
      score: 35,
      scoreMax: 40,
      weightedCoverage: 1,
      moduleWeights: [{ module: 'SEO', tariffWeight: 1, effectiveWeight: 1 }],
    },
    modules: [SEO, geo],
    geoObservations: [observation],
    geoEvidence: evidence,
    geoVisibilitySummary: VISIBILITY_SUMMARY,
  } as unknown as Dashboard;
}

function envelope(data: unknown, meta?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ success: true, data, error: null, ...(meta ?? {}) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(dashboard: Dashboard): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const path = String(input);
      if (path.includes('/action-plan')) return Promise.resolve(envelope(null));
      if (path.includes('/issues/summary')) {
        return Promise.resolve(envelope({ total: 0, open: 0, bySeverity: {}, groups: [] }));
      }
      if (path.includes('/issues')) {
        return Promise.resolve(envelope([], { meta: { total: 0, page: 1, limit: 100 } }));
      }
      return Promise.resolve(envelope(dashboard));
    }),
  );
}

async function renderFreeBlock(
  observation: GeoObservation,
  language: Language,
  evidence: GeoEvidence | null = EVIDENCE,
  geo: ScanModule = GEO,
): Promise<HTMLElement> {
  stubFetch(dashboardWith(observation, evidence, SCAN, geo));
  render(
    <ResultsScreen
      scan={SCAN}
      language={language}
      onScan={() => {}}
      onIssues={() => {}}
      onReports={() => {}}
      onError={() => {}}
      onUpgrade={() => {}}
    />,
  );
  return screen.findByRole('region', { name: HEADING[language] });
}

function disclosures(block: HTMLElement): HTMLDetailsElement[] {
  return [...block.querySelectorAll('details')].filter(
    (details): details is HTMLDetailsElement => details instanceof HTMLDetailsElement,
  );
}

/** The disclosure whose summary reads `label`. */
function disclosureNamed(block: HTMLElement, label: string): HTMLDetailsElement {
  const found = disclosures(block).find(
    (details) => details.querySelector('summary')?.textContent === label,
  );
  if (found === undefined) throw new Error(`no disclosure "${label}"`);
  return found;
}

/** Opens a native disclosure the way a reader does; jsdom may not toggle on click. */
function open(details: HTMLDetailsElement): void {
  const summary = details.querySelector('summary');
  if (summary !== null) fireEvent.click(summary);
  if (!details.open) details.open = true;
}

function headlineOf(block: HTMLElement): string | null {
  return block.querySelector('.free-geo-answer__headline')?.textContent ?? null;
}

function claimListOf(block: HTMLElement, language: Language): HTMLElement {
  return within(block).getByRole('list', {
    name: freePreviewCopy[language].preview.claimsLabel,
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each<Language>(['en', 'uk'])('the Free GEO block (%s)', (language) => {
  const t = freePreviewCopy[language].preview;

  it('shows the verdict and claims, and hides the answer until it is opened', async () => {
    const block = await renderFreeBlock(answered(EVALUATED), language);
    const list = claimListOf(block, language);
    expect(within(list).getByText(CLAIM_TEXT)).toBeVisible();
    expect(within(list).getByText(CONFIRMED[language])).toBeVisible();

    const details = disclosureNamed(block, SHOW_ANSWER[language]);
    expect(details.open).toBe(false);
    expect(within(block).getByText(REAL_ANSWER)).not.toBeVisible();

    open(details);
    expect(within(block).getByText(REAL_ANSWER)).toBeVisible();
    // Only the validated web address among the citations becomes a link.
    expect(within(details).getByRole('link', { name: CITATION })).toHaveAttribute('href', CITATION);
    expect(within(details).queryByText('javascript:alert(1)')).toBeNull();
  });

  it.each<[string, GeoEvaluation | null, keyof typeof t.headline]>([
    ['a contradiction', MISMATCH, 'mismatch'],
    ['every claim confirmed', ALL_CONFIRMED, 'confirmed'],
    ['some confirmed, some not', EVALUATED, 'partial'],
    [
      'nothing confirmed',
      { ...EVALUATED, overall: 'unverified', claims: [UNVERIFIED_CLAIM] },
      'unconfirmed',
    ],
    ['nothing checkable', { ...EVALUATED, overall: 'unverified', claims: [] }, 'nothing-checkable'],
    ['the evaluator unavailable', EVALUATOR_FAILED, 'not-checked'],
    ['no evaluation', null, 'not-checked'],
  ])('leads with one plain headline: %s', async (_label, evaluation, headline) => {
    const block = await renderFreeBlock(answered(evaluation), language);
    expect(headlineOf(block)).toBe(t.headline[headline]);
    expect(within(block).getByText(t.headline[headline])).toBeVisible();
  });

  it('counts the claims by result, contradictions first, and lists them in that order', async () => {
    const block = await renderFreeBlock(answered(MISMATCH), language);
    const counts = within(block).getByRole('list', { name: t.countsLabel });
    expect(
      within(counts)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      `${CONTRADICTS[language]} 1`,
      `${CONFIRMED[language]} 1`,
      `${NOT_CONFIRMED[language]} 1`,
    ]);
    const rows = within(claimListOf(block, language)).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      `${CONTRADICTS[language]}${CONTRADICTED_CLAIM}`,
      `${CONFIRMED[language]}${CLAIM_TEXT}`,
      `${NOT_CONFIRMED[language]}It is in Kyiv`,
    ]);
  });

  it('leaves out a count that is zero', async () => {
    const block = await renderFreeBlock(answered(ALL_CONFIRMED), language);
    const counts = within(block).getByRole('list', { name: t.countsLabel });
    expect(counts.textContent).toBe(`${CONFIRMED[language]} 1`);
  });

  it('keeps quotes, evidence and the scope note behind one closed "Show details"', async () => {
    const block = await renderFreeBlock(answered(MISMATCH), language);
    const details = disclosureNamed(block, SHOW_DETAILS[language]);
    expect(details.open).toBe(false);
    // The dense layout put these under every claim; none may be visible now.
    const secondary = [
      '“a dental practice”',
      '“its brand is Northwind Digital”',
      t.detailsScope,
      t.detailsNoEvidence,
      copy[language].report.geoSourceProfile,
    ];
    for (const text of secondary) {
      for (const node of within(block).getAllByText(text, { exact: false })) {
        expect(node).not.toBeVisible();
      }
    }
    expect(within(block).getByText(t.detailsScope)).not.toBeVisible();
    expect(block.querySelector('.free-geo-detail')).not.toBeVisible();

    open(details);
    expect(within(details).getByText(t.detailsScope)).toBeVisible();
    expect(within(details).getByText(/“a dental practice”/)).toBeVisible();
    expect(within(details).getAllByText(/“Smile Clinic”/)[0]).toBeVisible();
    expect(within(details).getByText(t.detailsNoEvidence)).toBeVisible();
    // The answer stays closed in its own disclosure.
    expect(within(block).getByText(REAL_ANSWER)).not.toBeVisible();
  });

  it('names the profile field in the reader’s language inside the details', async () => {
    const block = await renderFreeBlock(answered(EVALUATED), language);
    open(disclosureNamed(block, SHOW_DETAILS[language]));
    const origin = block.querySelector('.free-geo-detail__origin')?.textContent ?? '';
    expect(origin).toContain(language === 'en' ? 'Brand name' : 'Назва бренду');
    expect(origin).toContain(copy[language].report.geoSourceProfile);
  });

  it('shows up to six claims in full and caps a longer list behind "show more"', async () => {
    const many = (count: number): GeoEvaluation => ({
      ...EVALUATED,
      claims: Array.from({ length: count }, (_, index) => ({
        claim: `Claim number ${index + 1}`,
        verdict: 'unverified' as const,
        answerQuote: `quote ${index + 1}`,
        sourceId: null,
        sourceQuote: null,
      })),
    });
    const six = await renderFreeBlock(answered(many(6)), language);
    expect(within(claimListOf(six, language)).getAllByRole('listitem')).toHaveLength(6);
    expect(within(six).queryByRole('button', { name: t.showMoreClaims(1) })).toBeNull();
    cleanup();

    const eight = await renderFreeBlock(answered(many(8)), language);
    expect(within(claimListOf(eight, language)).getAllByRole('listitem')).toHaveLength(5);
    const more = within(eight).getByRole('button', { name: t.showMoreClaims(3) });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(within(claimListOf(eight, language)).getAllByRole('listitem')).toHaveLength(8);
    expect(within(eight).getByRole('button', { name: t.showFewerClaims })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('never shows the question, the provider or the model, not even in attributes', async () => {
    const block = await renderFreeBlock(answered(MISMATCH), language);
    disclosures(block).forEach(open);
    // Markup, not only text: aria-labels, titles and data-* would leak too.
    const markup = block.innerHTML.toLowerCase();
    for (const hidden of [
      REAL_QUESTION,
      PROVIDER,
      MODEL_ID,
      JUDGE_MODEL_ID,
      'Claude · Anthropic',
      PROVIDER_LABEL[language],
    ]) {
      expect(markup).not.toContain(hidden.toLowerCase());
    }
    expect(screen.queryByText(REAL_QUESTION)).toBeNull();
  });

  it('draws no mention badges and no visibility summary', async () => {
    const block = await renderFreeBlock(answered(MISMATCH), language);
    disclosures(block).forEach(open);
    expect(block.querySelector('.geo-observation__mentions')).toBeNull();
    expect(block.querySelector('.geo-observation__signal')).toBeNull();
    const text = block.textContent ?? '';
    for (const hidden of ['Brand mentioned', 'Бренд згадано', 'Visibility by engine', '77']) {
      expect(text).not.toContain(hidden);
    }
  });

  it('names the saved brand in the lead, and words it without one when none was saved', async () => {
    const block = await renderFreeBlock(answered(EVALUATED), language);
    expect(block.querySelector('.free-geo-answer__lead')?.textContent).toContain('Smile Clinic');
    cleanup();
    const unnamed = await renderFreeBlock(answered(EVALUATED), language, null);
    const lead = unnamed.querySelector('.free-geo-answer__lead');
    expect(lead?.textContent).toMatch(language === 'en' ? /your business/ : /ваш бізнес/);
  });

  it.each<[string, GeoEvaluation | null]>([
    ['not evaluated', null],
    ['evaluation unavailable', EVALUATOR_FAILED],
    ['zero claims', { ...EVALUATED, overall: 'unverified', claims: [] }],
  ])('opens the answer when there is nothing to check (%s)', async (_label, evaluation) => {
    const block = await renderFreeBlock(answered(evaluation), language);
    const details = disclosureNamed(block, ANSWER_HEADING[language]);
    expect(details.open).toBe(true);
    // Already open, so the label names the answer instead of offering to show it.
    expect(within(details).getByText(ANSWER_HEADING[language])).toBeVisible();
    expect(within(block).queryByText(SHOW_ANSWER[language])).toBeNull();
    expect(within(block).getByText(REAL_ANSWER)).toBeVisible();
    // No claims, so no count row, no claim list and no details disclosure.
    expect(within(block).queryByRole('list', { name: t.countsLabel })).toBeNull();
    expect(within(block).queryByText(SHOW_DETAILS[language])).toBeNull();
    // The evaluation's own note still explains why there is no verdict.
    expect(block.querySelector('.geo-evaluation__note')).toBeVisible();
  });

  it('says the answer is below when the evaluator could not run', async () => {
    const block = await renderFreeBlock(answered(EVALUATOR_FAILED), language);
    const note = block.querySelector('.geo-evaluation__note');
    expect(note?.textContent).toBe(t.evaluationUnavailable);
    expect(note?.textContent).not.toMatch(/above|вище/i);
  });
});

describe('the paid GEO card', () => {
  it.each<Language>(['en', 'uk'])(
    'keeps its original evaluator-failure sentence (%s)',
    (language) => {
      render(
        <GeoObservationCard
          observation={answered(EVALUATOR_FAILED)}
          evidence={EVIDENCE}
          language={language}
        />,
      );
      expect(screen.getByText(copy[language].report.geoEvaluationUnavailable)).toBeInTheDocument();
    },
  );
});

async function renderPrint(scan: Scan): Promise<string> {
  stubFetch(dashboardWith(answered(EVALUATED), EVIDENCE, scan));
  render(<PrintReport scanId={scan.id} language="en" onBack={() => {}} onError={() => {}} />);
  await screen.findByRole('heading', { level: 1 });
  return document.body.innerHTML;
}

describe('the printed report', () => {
  it('omits the AI engine table and provider on a Free report', async () => {
    const markup = await renderPrint(SCAN);
    expect((await screen.findAllByText('35 / 40')).length).toBeGreaterThan(0);
    expect(markup).not.toContain('Visibility by engine');
    expect(markup).not.toContain('Claude · Anthropic');
  });

  it('still prints them on a paid report with the same GEO data (control)', async () => {
    await renderPrint({ ...SCAN, plan: 'Complete' } as Scan);
    expect(await screen.findByText('Visibility by engine')).toBeInTheDocument();
    expect(screen.getByText('Claude · Anthropic')).toBeInTheDocument();
  });
});

// D-237 follow-up: the answer may be in another language than the report (the
// question follows the site's language). The lead says so in one clause, and
// the model-written text carries `lang` so a screen reader voices it right.
describe('the language the AI question was asked in', () => {
  const askedIn = (language: Language): ScanModule => ({
    ...GEO,
    metadata: { ...GEO.metadata, language },
  });
  const leadOf = (block: HTMLElement): string =>
    block.querySelector('.free-geo-answer__lead')?.textContent ?? '';

  it.each<[Language, Language, string]>([
    ['en', 'uk', 'It was asked in Ukrainian.'],
    ['uk', 'en', 'Запитали англійською.'],
  ])('a %s report of a %s answer says so in the lead', async (reader, asked, clause) => {
    const block = await renderFreeBlock(answered(MISMATCH), reader, EVIDENCE, askedIn(asked));
    expect(leadOf(block).endsWith(` ${clause}`)).toBe(true);
    // The clause names a language, never the question.
    expect(leadOf(block)).not.toContain(REAL_QUESTION);
    expect(block.textContent).not.toContain(REAL_QUESTION);
  });

  it.each<Language>(['en', 'uk'])('says nothing when the languages match (%s)', async (lang) => {
    const block = await renderFreeBlock(answered(MISMATCH), lang, EVIDENCE, askedIn(lang));
    expect(leadOf(block)).not.toMatch(/asked in|Запитали/);
  });

  it('says nothing and guesses no lang when the row does not record the language', async () => {
    const block = await renderFreeBlock(answered(MISMATCH), 'en');
    expect(leadOf(block)).not.toMatch(/asked in/);
    expect(block.querySelectorAll('[lang]')).toHaveLength(0);
  });

  it('marks exactly the model-written text with the answer language', async () => {
    const block = await renderFreeBlock(answered(MISMATCH), 'en', EVIDENCE, askedIn('uk'));
    const marked = [...block.querySelectorAll('[lang]')];
    expect(marked.every((node) => node.getAttribute('lang') === 'uk')).toBe(true);
    const claims = MISMATCH.claims.length;
    // A claim in the list and again in "Show details", each answer quote, the
    // full answer and the citation list.
    expect(marked).toHaveLength(claims * 3 + 2);
    expect(block.querySelectorAll('.free-geo-claims__text[lang]')).toHaveLength(claims);
    expect(block.querySelector('.free-geo-answer__text')).toHaveAttribute('lang', 'uk');
    expect(block.querySelector('.free-geo-answer__citations ul')).toHaveAttribute('lang', 'uk');
    // UI copy keeps the reader's language: chips, headline, lead, summaries.
    for (const selector of [
      '.geo-claim__verdict',
      '.free-geo-answer__headline',
      '.free-geo-answer__lead',
      'summary',
      '.free-geo-counts',
    ]) {
      for (const node of block.querySelectorAll(selector)) {
        expect(node.closest('[lang]')).toBeNull();
      }
    }
    // The evidence it was compared with is the site's own text, not the model's.
    for (const line of block.querySelectorAll('.free-geo-detail__line')) {
      if (line.textContent?.includes(freePreviewCopy.en.preview.detailsComparedWith)) {
        expect(line.querySelector('[lang]')).toBeNull();
      }
    }
  });
});
