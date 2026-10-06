// One problem, one name.
//
// The report's "Fix these first" named a rule with the rule's own technical
// title and the Issue Center named the same rule with its plain-language one,
// so "Heading structure is broken (H1–H6)" and "Headings do not form a clear
// outline" were two entries for one problem — and the first was a link to the
// second. Every owner-facing surface now headlines a rule with the plain name;
// the technical title stays in a finding's technical fold, where a developer
// reads it.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { Issue, IssueRuleGroup, IssueSummary } from './api';
import { EXPLAINED_RULE_IDS, problemTitle } from './finding-explainers';
import { FIX_FIRST_LIMIT, FixFirst } from './ReportNextSteps';
import { IssueTable } from './IssueTable';
import type { Language } from './i18n';
import { ruleTitle } from './rule-titles';

const LANGUAGES: readonly Language[] = ['en', 'uk'];

afterEach(() => {
  cleanup();
});

function group(ruleId: string): IssueRuleGroup {
  return { ruleId, module: 'SEO', severity: 'High', issues: 3, openIssues: 3 };
}

function summaryOf(ruleIds: readonly string[]): IssueSummary {
  return {
    total: ruleIds.length * 3,
    open: ruleIds.length * 3,
    bySeverity: { High: ruleIds.length * 3 },
    groups: ruleIds.map(group),
  };
}

function issueOf(ruleId: string, index: number): Issue {
  return {
    id: `issue-${index}`,
    scanId: 'scan-1',
    ruleId,
    module: 'SEO',
    fingerprint: `fp-${index}`,
    severity: 'High',
    category: 'seo',
    status: 'New',
    targetUrl: `https://bloom-nails.example/page-${index}`,
    evidenceType: 'html',
    evidenceRef: 'body',
    evidenceExcerpt: null,
    recommendation: 'Fix it.',
    confidence: 1,
    affectedTargets: 1,
    applicableTargets: 1,
    rulePenalty: 1,
    scoreDelta: -1,
    observedAt: '2026-10-01T00:00:00.000Z',
  };
}

/** The headlines "Fix these first" prints, in order. */
function fixFirstTitles(ruleIds: readonly string[], language: Language): readonly string[] {
  const view = render(
    <FixFirst
      summary={summaryOf(ruleIds)}
      language={language}
      onOpenProblem={() => undefined}
      onAll={() => undefined}
    />,
  );
  const titles = Array.from(
    view.container.querySelectorAll('.fix-first__title'),
    (node) => node.textContent ?? '',
  );
  view.unmount();
  return titles;
}

/** The headlines the Issue Center's unfiltered list prints, in order. */
function issueCenterTitles(ruleIds: readonly string[], language: Language): readonly string[] {
  const view = render(
    <IssueTable
      issues={ruleIds.map(issueOf)}
      language={language}
      soleRuleId={null}
      selectedIssue={null}
      onSelect={() => undefined}
      onStatus={() => undefined}
    />,
  );
  const titles = Array.from(
    view.container.querySelectorAll('.issue-title'),
    (node) => node.textContent ?? '',
  );
  view.unmount();
  return titles;
}

function batches<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
  return out;
}

describe('a rule has one name on every owner-facing surface', () => {
  // Table-driven over every rule that has a plain-language name, because the
  // defect was per rule: the two surfaces agreed for the rules whose technical
  // title happened to read plainly and disagreed for the rest.
  for (const language of LANGUAGES) {
    it(`names every explained rule the same way in ${language}`, () => {
      // "Fix these first" prints at most five, so the rules are fed through it
      // in pages of that size rather than being sampled.
      for (const page of batches(EXPLAINED_RULE_IDS, FIX_FIRST_LIMIT)) {
        const expected = page.map((ruleId) => problemTitle(ruleId, language));
        expect(fixFirstTitles(page, language)).toEqual(expected);
        expect(issueCenterTitles(page, language)).toEqual(expected);
      }
    });
  }

  // The guard that makes the equality above worth asserting: for most of these
  // rules the plain name and the technical title are different sentences, so a
  // surface that went back to the technical one would fail.
  it('is a different name from the rule’s own technical title for most rules', () => {
    const differing = EXPLAINED_RULE_IDS.filter(
      (ruleId) => problemTitle(ruleId, 'en') !== ruleTitle(ruleId, 'en'),
    );
    expect(differing.length).toBeGreaterThan(EXPLAINED_RULE_IDS.length / 2);
    // The two the walkthrough found, named explicitly: they are the reason this
    // file exists.
    expect(problemTitle('SEO-ONPAGE-003', 'en')).toBe('Headings do not form a clear outline');
    expect(ruleTitle('SEO-ONPAGE-003', 'en')).toBe('Heading structure is broken (H1–H6)');
    expect(problemTitle('SEO-TECH-011', 'en')).toBe('Pages only one other page links to');
    expect(ruleTitle('SEO-TECH-011', 'en')).toBe('Page held by a single internal link');
  });
});

describe('the technical title stays technical', () => {
  const src = (name: string): string =>
    readFileSync(join(resolve(process.cwd()), 'src', name), 'utf8');

  // A headline read off `ruleTitle` is how the two names got onto one report in
  // the first place. The surfaces that headline a rule must not reach for it;
  // `finding-explainers.ts` (which falls back to it for an unexplained rule)
  // and `developer-task.ts` (which quotes it to the developer, beside the rule
  // id) are the two places it belongs.
  for (const file of [
    'ReportNextSteps.tsx',
    'ActionPlan.tsx',
    'ScanComparison.tsx',
    'PrintReport.tsx',
    'IssueTable.tsx',
    'Issues.tsx',
  ]) {
    it(`does not headline a rule from ruleTitle in ${file}`, () => {
      expect(src(file)).not.toMatch(/\bruleTitle\(/);
    });
  }

  it('still quotes it for the developer, beside the rule id', () => {
    expect(src('developer-task.ts')).toMatch(/t\.check\(ruleTitle\(/);
    expect(src('finding-explainers.ts')).toMatch(/hasFindingExplainer\(ruleId\) \? ruleTitle\(/);
  });
});
