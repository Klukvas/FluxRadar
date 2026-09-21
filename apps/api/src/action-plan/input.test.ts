import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  planAnswer,
  planApp,
  planProvider,
  plannableScan,
  type SeedIssue,
} from '../test-utils/action-plan-fixtures.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import { buildActionPlanInput } from './input.ts';

// What a scan tells the Action Plan (D-232): open issues outside Analytics,
// one entry per rule with its highest open severity, a few page addresses
// without query string or fragment, and the rule's recommendation variants in
// the plan language when the catalogue has it.

const canonical = (variant: 'missing' | 'invalid'): string =>
  JSON.stringify({
    evidence: { code: `seo-tech-004.evidence.${variant}`, params: {} },
    recommendation: { code: `seo-tech-004.recommendation.${variant}`, params: {} },
  });

const MISSING_EN =
  'Add a <link rel="canonical"> with the absolute URL of the page itself (or of its canonical version on the same domain).';
const INVALID_EN = 'Set rel=canonical to a valid absolute http(s) URL.';

const ISSUES: readonly SeedIssue[] = [
  {
    ruleId: 'SEO-TECH-004',
    severity: 'Low',
    targetUrl: 'https://input.example.com/a?utm_source=mail#top',
    recommendation: MISSING_EN,
    messagesJson: canonical('missing'),
  },
  {
    ruleId: 'SEO-TECH-004',
    severity: 'Medium',
    targetUrl: 'https://input.example.com/a?utm_source=ads',
    recommendation: MISSING_EN,
    messagesJson: canonical('missing'),
  },
  {
    ruleId: 'SEO-TECH-004',
    severity: 'Medium',
    targetUrl: 'https://input.example.com/b',
    recommendation: INVALID_EN,
    messagesJson: canonical('invalid'),
  },
  { ruleId: 'SEO-TECH-004', severity: 'Low', targetUrl: 'https://input.example.com/c' },
  { ruleId: 'SEO-TECH-004', severity: 'Low', targetUrl: 'https://input.example.com/d' },
  // Settled: neither its severity nor its count reach the plan.
  { ruleId: 'SEO-TECH-004', severity: 'High', status: 'Ignored' },
  {
    ruleId: 'UX-CONV-AI-002',
    module: 'UX/Conversion',
    severity: 'Medium',
    recommendation: 'Put the booking button next to the price.',
  },
  { ruleId: 'ANALYTICS-SC-002', module: 'Analytics', recommendation: 'SECRET-ANALYTICS' },
];

describe('the Action Plan input', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  async function inputFor(language: 'uk' | 'de') {
    const app = planApp(db.prisma, { provider: planProvider(planAnswer([])) });
    const { scanId } = await plannableScan(db.prisma, app, `input-${language}@example.com`, {
      issues: ISSUES,
    });
    const scan = await db.prisma.scan.findUniqueOrThrow({
      where: { id: scanId },
      include: { modules: true },
    });
    return buildActionPlanInput(db.prisma, scan, language);
  }

  it('folds open issues by rule, with the highest open severity and the catalogue language', async () => {
    const input = await inputFor('uk');
    const canonicalRule = input.rules.find((rule) => rule.ruleId === 'SEO-TECH-004');

    expect(input.domain).toBe('input-uk.example.com');
    expect(input.language).toBe('uk');
    expect(input.consent).toMatchObject({
      providers: ['anthropic'],
      noticeVersion: 'action-plan-notice-v1',
    });
    expect(canonicalRule).toMatchObject({
      title: 'Canonical URL відсутній або хибний',
      module: 'SEO',
      severity: 'Medium',
      openIssues: 5,
    });
    expect(canonicalRule?.recommendations).toEqual(
      expect.arrayContaining([
        'Додайте <link rel="canonical"> з абсолютним URL самої сторінки (або її канонічної версії на тому самому домені).',
        'Вкажіть у rel=canonical коректний абсолютний http(s)-URL.',
      ]),
    );
  });

  it('sends at most three distinct pages per rule, without query string or fragment', async () => {
    const input = await inputFor('uk');
    const pages = input.rules.find((rule) => rule.ruleId === 'SEO-TECH-004')?.sampleUrls ?? [];

    expect(pages).toHaveLength(3);
    expect(new Set(pages).size).toBe(3);
    // Medium before Low: /a and /b carry the rule's most severe open findings.
    expect(pages.slice(0, 2)).toEqual([
      'https://input.example.com/a',
      'https://input.example.com/b',
    ]);
    expect(pages.join(' ')).not.toMatch(/[?#]/);
  });

  it('sends English text for a language the catalogue does not have', async () => {
    const input = await inputFor('de');
    const canonicalRule = input.rules.find((rule) => rule.ruleId === 'SEO-TECH-004');
    const ux = input.rules.find((rule) => rule.ruleId === 'UX-CONV-AI-002');

    expect(canonicalRule?.title).toBe('Canonical URL is missing or wrong');
    expect(canonicalRule?.recommendations).toEqual(
      expect.arrayContaining([MISSING_EN, INVALID_EN]),
    );
    // A model-written UX finding carries its own English text.
    expect(ux?.recommendations).toEqual(['Put the booking button next to the price.']);
  });

  it('leaves Analytics out of the rules and the sections', async () => {
    const input = await inputFor('uk');

    expect(input.rules.map((rule) => rule.ruleId).sort()).toEqual([
      'SEO-TECH-004',
      'UX-CONV-AI-002',
    ]);
    expect(input.modules.map((module) => module.module)).not.toContain('Analytics');
    expect(JSON.stringify(input)).not.toContain('SECRET-ANALYTICS');
  });
});
