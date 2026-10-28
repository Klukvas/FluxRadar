// The redesigned layout's promises, read back out of the produced file: what
// page one says first, where the plan starts, how findings are grouped, when
// the index appears, and what the agency report leaves out.

import { describe, expect, it } from 'vitest';

import type { Issue } from '@prisma/client';

import {
  actionPlan,
  fakePrisma,
  issueAt,
  render,
  RENDERED_AT,
  scanWithModules,
} from '../../test-utils/pdf-report-fixtures.ts';
import { extractPdfPages } from '../../test-utils/pdf-text.ts';
import type { ReportBrand } from '../../branding/load.ts';
import { brandedCopy } from './branding.ts';
import { REPORT_COPY } from './copy.ts';
import { renderReportPdf, type ActionPlanProjection } from './render.ts';

const brand: ReportBrand = {
  displayName: 'Studio Blue',
  accent: '#445566',
  contactLine: 'hello@example.com',
  logo: null,
};

async function pagesOf(options: {
  readonly issues?: readonly Issue[];
  readonly language?: 'en' | 'uk';
  readonly branded?: boolean;
  readonly plan?: ActionPlanProjection | null;
  readonly modules?: Parameters<typeof scanWithModules>[0];
}): Promise<readonly string[]> {
  const { prisma } = fakePrisma(options.issues ?? []);
  const result = await renderReportPdf({
    prisma,
    scan: scanWithModules(options.modules ?? [{ module: 'SEO', score: 54 }]),
    language: options.language ?? 'en',
    now: RENDERED_AT,
    ...(options.branded === true ? { brand } : {}),
    ...(options.plan === undefined ? {} : { loadActionPlan: async () => options.plan ?? null }),
  });
  return extractPdfPages(result.bytes);
}

const flat = (pages: readonly string[]): string => pages.join('\n').replaceAll(/\s+/gu, ' ');

describe('the redesigned report', () => {
  it('opens a zero-finding report with the clear verdict and no severity vocabulary', async () => {
    const text = flat(await pagesOf({}));
    expect(text).toContain(REPORT_COPY.en.verdict.clear);
    expect(text).toContain(REPORT_COPY.en.noFindings);
    expect(text).toContain(REPORT_COPY.en.summaryNone);
    expect(text).not.toContain(REPORT_COPY.en.severityMeaning);
    expect(text).not.toContain(REPORT_COPY.en.findingsIndexHeading);
    expect(text).not.toContain('HIGH');
    expect(text).not.toContain(`${REPORT_COPY.en.severity.Critical} ·`);
    // Nothing is open, so no weakest section contradicts "in order".
    expect(text).not.toContain('Weakest section');
    expect(text).not.toContain(REPORT_COPY.en.bySeverityLabel.toUpperCase());
    expect(text).not.toContain(REPORT_COPY.en.glossary.heading);
  });

  it('says what to do first, with the weakest section, from the severity counts', async () => {
    const issues = Array.from({ length: 8 }, (_, index) => issueAt(index));
    const text = flat(await pagesOf({ issues, language: 'uk' }));
    expect(text).toContain(REPORT_COPY.uk.verdict.critical(2));
    expect(text).toContain(REPORT_COPY.uk.verdict.weakest('SEO', 54));
    expect(text).toContain(REPORT_COPY.uk.severityMeaning);
    // The glossary closes a report that has findings to explain.
    expect(text).toContain(REPORT_COPY.uk.glossary.heading);
    expect(text).toContain(REPORT_COPY.uk.glossary.entries[0]?.meaning ?? 'missing');
  });

  it('opens a severity group, in title case with its count, wherever the severity changes', async () => {
    const issues = Array.from({ length: 8 }, (_, index) => issueAt(index));
    const text = flat(await pagesOf({ issues }));
    for (const severity of ['Critical', 'High', 'Medium', 'Low'] as const) {
      expect(text).toContain(`${REPORT_COPY.en.severity[severity]} · 2`);
    }
    // The badge on each card stays in capitals.
    expect(text).toContain(REPORT_COPY.en.severity.High.toUpperCase());
  });

  it('never writes a spaced slash outside the page counter', async () => {
    const issues = Array.from({ length: 30 }, (_, index) => issueAt(index));
    const pages = await pagesOf({ issues, language: 'uk', plan: actionPlan() });
    pages.forEach((page, index) => {
      expect(page.match(/\d+ \/ \d+/g)).toEqual([`${index + 1} / ${pages.length}`]);
    });
  });

  it('starts the plan on page two and links each action to the rules it closes', async () => {
    const plan = actionPlan();
    const settled = {
      ...plan,
      actions: [{ ...plan.actions[0], ruleIds: ['PLAN-ONLY-9'], openIssues: 6, totalIssues: 6 }],
    } as ActionPlanProjection;
    const pages = await pagesOf({ issues: [issueAt(0)], plan: settled });
    expect(pages[0]).not.toContain(REPORT_COPY.en.actionPlanHeading);
    expect(pages[1]).toContain(REPORT_COPY.en.actionPlanHeading);
    const text = flat(pages);
    expect(text).toContain(REPORT_COPY.en.actionPlanCovers('PLAN-ONLY-9'));
    // Page one names the first step and the page the plan is on.
    expect(pages[0]).toContain(REPORT_COPY.en.firstStep('Add page titles', 2));
    // "6 of 6 still open" says nothing a reader needs.
    expect(text).not.toContain(REPORT_COPY.en.actionPlanProgress(6, 6));
    expect(text).toContain(REPORT_COPY.en.actionPlanEffort.small);
  });

  it('adds the findings index to a long report, and only to a long one', async () => {
    const long = Array.from({ length: 21 }, (_, index) => issueAt(index));
    const short = Array.from({ length: 20 }, (_, index) => issueAt(index));
    const longText = flat(await pagesOf({ issues: long }));
    expect(longText).toContain(REPORT_COPY.en.findingsIndexHeading);
    expect(longText).toContain('SEO-1 · SEO × 1');
    expect(flat(await pagesOf({ issues: short }))).not.toContain(
      REPORT_COPY.en.findingsIndexHeading,
    );
  });

  it('skips the index when there are too many distinct problems for one glance', async () => {
    const issues = Array.from({ length: 81 }, (_, index) =>
      issueAt(index, { ruleId: `SEO-MANY-${index}` }),
    );
    const { bytes } = await render(issues);
    expect(flat(extractPdfPages(bytes))).not.toContain(REPORT_COPY.en.findingsIndexHeading);
  });

  it('counts only open findings on page one, and everything listed in the chapter', async () => {
    const closed = ['Resolved', 'Acknowledged', 'Ignored'].map((status, index) =>
      issueAt(index * 4, { status }),
    );
    const open = [issueAt(1), issueAt(5)];
    const pages = await pagesOf({ issues: [...closed, ...open] });
    const first = flat(pages.slice(0, 1));
    // Two open High findings: no critical verdict from the three closed Critical ones.
    expect(first).toContain(REPORT_COPY.en.verdict.high(2));
    expect(first).not.toContain('critical findings');
    expect(first).toContain('Critical 0');
    // The chapter lists all five, and its group headers count what is listed.
    expect(flat(pages)).toContain(`${REPORT_COPY.en.severity.Critical} · 3`);
  });

  it('gives the index a page reference for every problem', async () => {
    const issues = Array.from({ length: 24 }, (_, index) => issueAt(index));
    const pages = await pagesOf({ issues });
    const indexPage = pages.find((page) => page.includes(REPORT_COPY.en.findingsIndexHeading));
    const references = indexPage?.match(/p\. \d+/g) ?? [];
    expect(references.length).toBe(new Set(issues.map((i) => `${i.ruleId}|${i.severity}`)).size);
    // References are written in row order once the cards are placed; the first
    // row is the first critical problem, SEO-1, and its page holds its card.
    const firstPage = Number(references[0]?.slice(3));
    expect(pages[firstPage - 1]).toContain('SEO-1 · SEO · on');
  });

  it('marks a provisional overall score and says when there is too little data', async () => {
    const complete = [
      'SEO',
      'AI SEO / GEO',
      'Security',
      'Performance',
      'Accessibility',
      'Reliability',
      'Content Quality',
      'Privacy',
    ];
    const provisional = flat(
      await pagesOf({ modules: complete.map((module) => ({ module, score: 70, coverage: 0.6 })) }),
    );
    expect(provisional).toContain(REPORT_COPY.en.scoreOutOf(70));
    expect(provisional).toContain(REPORT_COPY.en.overallProvisional);
    const thin = flat(await pagesOf({}));
    expect(thin).toContain(REPORT_COPY.en.overallInsufficient);
  });

  it('keeps a long domain whole in the title', async () => {
    const { prisma } = fakePrisma([]);
    const domain = 'lagoda-kava-and-friends-coffee.example';
    const result = await renderReportPdf({
      prisma,
      scan: { ...scanWithModules(), domain: `https://${domain}` },
      language: 'en',
      now: RENDERED_AT,
    });
    const lines = extractPdfPages(result.bytes)[0]?.split('\n') ?? [];
    expect(lines.some((line) => line.endsWith(domain))).toBe(true);
  });

  it('never leaves the findings heading alone at the foot of the plan page', async () => {
    const issues = Array.from({ length: 6 }, (_, index) => issueAt(index));
    for (const plan of [actionPlan(), null]) {
      const pages = await pagesOf({ issues, plan });
      const chapter = pages.find((page) =>
        page.split('\n').includes(REPORT_COPY.en.problemsHeading),
      );
      // The heading's page also holds the first group header and its first card.
      expect(chapter).toContain(`${REPORT_COPY.en.severity.Critical} · 2`);
      expect(chapter).toContain(REPORT_COPY.en.recommendation.toUpperCase());
    }
  });

  it('keeps the heading with the first group even when the first card is very tall', async () => {
    for (const words of [704, 760, 800, 840]) {
      const tall = issueAt(0, { recommendation: 'word '.repeat(words).trim() });
      const pages = await pagesOf({ issues: [tall, issueAt(1)], plan: actionPlan() });
      const chapter = pages.find((page) =>
        page.split('\n').includes(REPORT_COPY.en.problemsHeading),
      );
      expect(chapter).toContain(`${REPORT_COPY.en.severity.Critical} · 1`);
      expect(chapter).toContain(REPORT_COPY.en.severity.Critical.toUpperCase());
    }
  });

  it("counts the open tile's problems among the open findings only", async () => {
    const open = Array.from({ length: 10 }, (_, index) =>
      issueAt(index, { ruleId: 'SEO-OPEN', severity: 'High', severityRank: 1 }),
    );
    const closed = ['Resolved', 'Ignored', 'Acknowledged', 'Resolved', 'Ignored', 'Resolved'].map(
      (status, index) => issueAt(100 + index, { ruleId: `SEO-CLOSED-${index}`, status }),
    );
    const first = flat((await pagesOf({ issues: [...open, ...closed] })).slice(0, 1));
    expect(first).not.toContain('7 different problems');
    expect(first).toContain('findings in 1 different problem');
  });

  it('leaves a severity outside the scored four out of every page-one count', async () => {
    const issues = [issueAt(0), issueAt(1, { severity: 'Info', severityRank: 4 })];
    const first = flat((await pagesOf({ issues })).slice(0, 1));
    expect(first).toContain('OPEN 1 finding');
    expect(first).toContain(REPORT_COPY.en.verdict.critical(1));
  });

  it('states a site-wide finding as the whole site, not as a page count', async () => {
    const text = flat(await pagesOf({ issues: [issueAt(0, { targetKind: 'site' })] }));
    expect(text).toContain(`SEO-1 · SEO · ${REPORT_COPY.en.wholeSite}`);
    expect(text).not.toContain(REPORT_COPY.en.affectedPages(1, 1));
  });

  it('states no reach for a plan over zero open findings', async () => {
    const plan = actionPlan();
    const empty = {
      ...plan,
      reach: { ...plan.reach, addressedOpenIssues: 0, totalOpenIssues: 0 },
    } as ActionPlanProjection;
    const text = flat(await pagesOf({ plan: empty }));
    expect(text).not.toContain(REPORT_COPY.en.actionPlanReach(0, 0));
  });

  it('names the tariff in the plain report and leaves it out of the agency report', async () => {
    const plain = flat(await pagesOf({ language: 'uk' }));
    const branded = flat(await pagesOf({ language: 'uk', branded: true }));
    expect(plain).toContain(REPORT_COPY.uk.plan.toUpperCase());
    expect(plain).toContain('Complete');
    expect(branded).not.toContain(brandedCopy('uk').plan.toUpperCase());
    expect(branded).not.toContain('Complete');
  });

  it('heads every page after the first with the report and who prepared it', async () => {
    const issues = Array.from({ length: 12 }, (_, index) => issueAt(index));
    const pages = await pagesOf({ issues, branded: true, language: 'uk' });
    expect(pages.length).toBeGreaterThan(1);
    pages.slice(1).forEach((page) => {
      expect(page).toContain(REPORT_COPY.uk.preparedFor('example.com'));
      expect(page).toContain(brand.displayName);
    });
  });
});
