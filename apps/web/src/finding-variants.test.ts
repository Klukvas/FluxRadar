// One problem's findings, folded: how many pages they are on and where they
// differ. The header rules put the same sentence on every page, so the fold is
// what tells an owner whether the list below is one fix or several.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Issue } from './api';
import { developerTaskText, nothingOpen } from './developer-task';
import {
  EXPLAINED_RULE_IDS,
  findingCountsPages,
  findingExplainer,
  problemTechnicalName,
  problemTitle,
} from './finding-explainers';
import { findingEvidence, problemBreakdown } from './finding-variants';
import { findingsCopy } from './findings-copy';
import type { Language } from './i18n';

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    scanId: 'scan-1',
    ruleId: 'SEC-PASSIVE-002',
    module: 'Security',
    fingerprint: 'fp-1',
    severity: 'Medium',
    category: 'http',
    status: 'New',
    targetUrl: 'https://shop.example.com/',
    evidenceType: 'http',
    evidenceRef: 'issue/issue-1',
    evidenceExcerpt: 'The HTML response is missing security headers (1): Referrer-Policy',
    recommendation: 'Send the missing headers with HTML responses.',
    confidence: 1,
    affectedTargets: 1,
    applicableTargets: 1,
    rulePenalty: 0,
    scoreDelta: 0,
    observedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('a finding’s evidence', () => {
  it('is the reader’s language when the API rendered one', () => {
    const rendered = issue({
      localized: {
        en: { evidenceExcerpt: 'missing: Referrer-Policy', recommendation: null },
        uk: { evidenceExcerpt: 'не вистачає: Referrer-Policy', recommendation: null },
      },
    });

    expect(findingEvidence(rendered, 'uk')).toBe('не вистачає: Referrer-Policy');
  });

  it('falls back to the stored text, and to null when there is none', () => {
    expect(findingEvidence(issue({ localized: null }), 'uk')).toBe(
      'The HTML response is missing security headers (1): Referrer-Policy',
    );
    expect(findingEvidence(issue({ evidenceExcerpt: null }), 'en')).toBeNull();
  });
});

describe('the breakdown of one problem’s loaded findings', () => {
  it('counts a page once however many findings it has', () => {
    const breakdown = problemBreakdown(
      [
        issue({ id: 'a', targetUrl: 'https://shop.example.com/', evidenceExcerpt: 'cookie sid' }),
        issue({ id: 'b', targetUrl: 'https://shop.example.com/', evidenceExcerpt: 'cookie cart' }),
        issue({
          id: 'c',
          targetUrl: 'https://shop.example.com/help',
          evidenceExcerpt: 'cookie sid',
        }),
      ],
      'en',
    );

    expect(breakdown.findings).toBe(3);
    expect(breakdown.pages).toBe(2);
  });

  it('folds identical evidence and puts the most common difference first', () => {
    const breakdown = problemBreakdown(
      [
        issue({ id: 'a', targetUrl: 'https://a.example/', evidenceExcerpt: 'missing: 1 header' }),
        issue({ id: 'b', targetUrl: 'https://b.example/', evidenceExcerpt: 'missing: 3 headers' }),
        issue({ id: 'c', targetUrl: 'https://c.example/', evidenceExcerpt: 'missing: 3 headers' }),
      ],
      'en',
    );

    expect(breakdown.variants).toEqual([
      { evidence: 'missing: 3 headers', findings: 2 },
      { evidence: 'missing: 1 header', findings: 1 },
    ]);
  });

  it('reads the variants in the report language, not the stored one', () => {
    const localized = (en: string, uk: string): Partial<Issue> => ({
      localized: {
        en: { evidenceExcerpt: en, recommendation: null },
        uk: { evidenceExcerpt: uk, recommendation: null },
      },
    });
    const issues = [
      issue({ id: 'a', targetUrl: 'https://a.example/', ...localized('no CSP', 'немає CSP') }),
      issue({ id: 'b', targetUrl: 'https://b.example/', ...localized('no CSP', 'немає CSP') }),
    ];

    expect(problemBreakdown(issues, 'uk').variants).toEqual([
      { evidence: 'немає CSP', findings: 2 },
    ]);
  });

  it('lists no variant for findings that carry no evidence at all', () => {
    const breakdown = problemBreakdown(
      [
        issue({ evidenceExcerpt: null, localized: null }),
        issue({ id: 'b', evidenceExcerpt: '  ' }),
      ],
      'en',
    );

    expect(breakdown.findings).toBe(2);
    expect(breakdown.variants).toEqual([]);
  });
});

// ─── Plain-language coverage ────────────────────────────────────────────────
//
// The registry lives in `packages/contracts`, which `apps/web` does not depend
// on, so it is read as text — the seam `rule-titles.test.ts` uses.

const REGISTRY = readFileSync(
  resolve(process.cwd(), '..', '..', 'packages', 'contracts', 'src', 'ruleset-scanning.ts'),
  'utf8',
);
/**
 * Rules whose findings become Issue Center rows: the registry's scored rules,
 * whatever their prefix. Informational ones (D-109) never become Issue rows
 * (module-result.ts), so a rule under a new prefix is still seen here.
 */
const RULE = /ruleId: '([A-Z0-9-]+)',[\s\S]*?scoring: '(\w+)'/g;
const registryRules = [...REGISTRY.matchAll(RULE)]
  .filter((match) => match[2] === 'scored')
  .map((match) => match[1] as string);

/** Every report language; RU is not one (the launch segment is undecided). */
const LANGUAGES: readonly Language[] = ['en', 'uk'];

/**
 * The problems of the Complete report on flux-lab.dev that an owner walked
 * through and could not read: every one of them has to be in the owner's words.
 */
const REPORT_RULES = [
  'SEC-ASVS-001',
  'SEC-ASVS-002',
  'SEC-PASSIVE-002',
  'SEC-PASSIVE-005',
  'A11Y-003',
  'A11Y-007',
  'SEO-TECH-003',
  'SEO-TECH-006',
  'SEO-TECH-007',
  'SEO-TECH-011',
  'SEO-ONPAGE-003',
  'SEO-ONPAGE-004',
  'SEO-STRUCT-002',
  'PRIVACY-001',
  'CONTENT-005',
  'UX-CONV-AI-001',
  'UX-CONV-AI-002',
  'UX-CONV-AI-003',
] as const;

/**
 * Rules deliberately left to their technical title, evidence and
 * recommendation for now. Explaining one means moving it out of this list; a
 * new registry rule fails the coverage test until it is put on one side or the
 * other.
 */
const INTENTIONALLY_UNEXPLAINED = [
  'A11Y-001',
  'A11Y-002',
  'A11Y-004',
  'A11Y-005',
  'A11Y-006',
  'A11Y-008',
  'A11Y-009',
  'A11Y-010',
  'ANALYTICS-GA-001',
  'ANALYTICS-GA-002',
  'ANALYTICS-SC-001',
  'ANALYTICS-SC-002',
  'ANALYTICS-SC-004',
  'ANALYTICS-SC-005',
  'CONTENT-001',
  'CONTENT-003',
  'CONTENT-004',
  'PRIVACY-002',
  'PRIVACY-003',
  'PRIVACY-004',
  'REL-API-003',
  'REL-API-005',
  'REL-URL-001',
  'REL-URL-003',
  'REL-URL-009',
  'SEC-ASVS-003',
  'SEC-PASSIVE-003',
  'SEO-ONPAGE-005',
  'SEO-ONPAGE-006',
  'SEO-SOCIAL-001',
  'SEO-STRUCT-001',
  'SEO-TECH-001',
  'SEO-TECH-002',
  'SEO-TECH-004',
  'SEO-TECH-005',
  'SEO-TECH-008',
  'SEO-TECH-009',
  'SEO-TECH-010',
  'SEO-TECH-013',
  'UX-CONV-STATIC-001',
  'UX-CONV-STATIC-002',
  'UX-CONV-STATIC-003',
] as const;

/**
 * Header names, attribute names, markup and status codes: the developer's
 * vocabulary, which the owner-facing text leaves to the technical details.
 */
const TECHNICAL_TERM =
  /Content-Security-Policy|X-Frame|X-Content|Referrer-Policy|Strict-Transport|HSTS|HttpOnly|SameSite|Set-Cookie|\bSecure\b|ARIA|aria-|<[a-z]|\bh[1-6]\b|\bH[1-6]\b|JSON-LD|@type|@context|lang\]|canonical|meta description|\b[45]xx\b|\bHTTP\b|\b(?:200|301|302|403|404|500|503)\b/;
/** No claim that anybody attacked, broke into or exploited the site. */
const ATTACK_CLAIM = /attack|hack|exploit|breach|steal|атак|злам|викрад/i;

describe('the plain-language explanations', () => {
  it('reads a non-trivial registry', () => {
    // Every rule id is paired with its own scoring field, none skipped or merged.
    expect([...REGISTRY.matchAll(RULE)]).toHaveLength(REGISTRY.match(/ruleId: '/g)?.length ?? 0);
    // 62 scored rules of 70 at the time of writing; the rest are GEO and informational.
    expect(registryRules.length).toBeGreaterThanOrEqual(60);
    expect(registryRules).toContain('ANALYTICS-SC-001');
    expect(registryRules).not.toContain('A11Y-011');
    expect(registryRules).not.toContain('GEO-VIS-003');
  });

  it('explain every problem of the owner’s Complete report', () => {
    expect(REPORT_RULES.filter((ruleId) => !EXPLAINED_RULE_IDS.includes(ruleId))).toEqual([]);
  });

  it('cover every registry rule or list it as deliberately unexplained', () => {
    const decided = new Set<string>([...EXPLAINED_RULE_IDS, ...INTENTIONALLY_UNEXPLAINED]);
    expect(registryRules.filter((ruleId) => !decided.has(ruleId))).toEqual([]);
    // Neither list names a rule the registry does not have, and no rule is on both.
    expect([...decided].filter((ruleId) => !registryRules.includes(ruleId))).toEqual([]);
    expect(
      INTENTIONALLY_UNEXPLAINED.filter((ruleId) => EXPLAINED_RULE_IDS.includes(ruleId)),
    ).toEqual([]);
  });

  describe.each(EXPLAINED_RULE_IDS)('%s', (ruleId) => {
    it.each(LANGUAGES)('has every field in %s, in the owner’s words', (language) => {
      const explainer = findingExplainer(ruleId, language);
      expect(explainer, `${ruleId} has no ${language} explanation`).not.toBeNull();
      for (const [field, text] of Object.entries(explainer ?? {})) {
        expect(text.trim(), `${ruleId}.${language}.${field}`).not.toBe('');
        expect(text, `${ruleId}.${language}.${field}`).not.toMatch(TECHNICAL_TERM);
        expect(text, `${ruleId}.${language}.${field}`).not.toMatch(ATTACK_CLAIM);
      }
    });

    it('is written in Ukrainian for a Ukrainian report, not copied from English', () => {
      const en = findingExplainer(ruleId, 'en');
      const uk = findingExplainer(ruleId, 'uk');
      for (const field of ['title', 'what', 'why', 'fix', 'count'] as const) {
        expect(uk?.[field]).not.toBe(en?.[field]);
        expect(uk?.[field], `${ruleId}.uk.${field}`).toMatch(/[а-яіїєґ]/i);
      }
    });
  });

  it('degrades to the rule’s own title and id for a rule with no explanation', () => {
    expect(findingExplainer('A11Y-002', 'en')).toBeNull();
    expect(problemTitle('A11Y-002', 'uk')).toBe('Зображення без текстової альтернативи');
    expect(problemTechnicalName('A11Y-002', 'en')).toBe('A11Y-002');
    expect(findingCountsPages('A11Y-002')).toBe(false);
    expect(problemTitle('NEW-RULE-001', 'en')).toBe('NEW-RULE-001');
  });

  it('keeps the technical title under the plain one, for the dashboard and the developer', () => {
    expect(problemTitle('SEC-ASVS-001', 'en')).toBe(
      'Pages do not limit where they load content from',
    );
    expect(problemTechnicalName('SEC-ASVS-001', 'en')).toBe(
      'Content-Security-Policy is missing or weak',
    );
  });

  it('counts pages only for rules that report at most once per page', () => {
    expect(findingCountsPages('SEC-ASVS-001')).toBe(true);
    expect(findingCountsPages('A11Y-007')).toBe(true);
    // Per cookie, per broken link, per address group, per AI remark.
    expect(findingCountsPages('SEC-PASSIVE-005')).toBe(false);
    expect(findingCountsPages('SEO-TECH-006')).toBe(false);
    expect(findingCountsPages('SEO-TECH-007')).toBe(false);
    expect(findingCountsPages('UX-CONV-AI-002')).toBe(false);
  });
});

describe('a problem’s count in the problem list', () => {
  it('says pages where one finding is one page, and findings otherwise', () => {
    const en = findingsCopy.en.issues;
    expect(en.groupCount(61, 61, true)).toBe('On 61 pages');
    expect(en.groupCount(1, 1, true)).toBe('On 1 page');
    expect(en.groupCount(57, 59, true)).toBe('Open on 57 of 59 pages');
    expect(en.groupCount(4, 4, false)).toBe('4 open findings');
    expect(en.groupCount(3, 4, false)).toBe('3 of 4 findings open');
    expect(en.groupSettled(61, true)).toBe('Settled on 61 pages');
    expect(en.groupSettled(4, false)).toBe('All 4 findings settled');
  });

  it('declines the Ukrainian page count by its number', () => {
    const uk = findingsCopy.uk.issues;
    expect(uk.groupCount(61, 61, true)).toBe('На 61 сторінці');
    expect(uk.groupCount(11, 11, true)).toBe('На 11 сторінках');
    expect(uk.groupCount(5, 5, true)).toBe('На 5 сторінках');
    expect(uk.groupCount(57, 59, true)).toBe('Відкрито на 57 з 59 сторінок');
    expect(uk.groupCount(1, 21, true)).toBe('Відкрито на 1 з 21 сторінки');
    expect(uk.groupCount(2, 2, true)).toBe('На 2 сторінках');
    expect(uk.groupCount(1, 22, true)).toBe('Відкрито на 1 з 22 сторінок');
    expect(uk.groupCount(4, 4, false)).toBe('Відкритих знахідок: 4');
    expect(uk.groupSettled(3, true)).toBe('Закрито на 3 сторінках');
  });
});

describe('the task for a developer', () => {
  function csp(index: number, overrides: Partial<Issue> = {}): Issue {
    return issue({
      id: `issue-${index}`,
      ruleId: 'SEC-ASVS-001',
      severity: 'Critical',
      targetUrl: `https://shop.example.com/page-${index}`,
      evidenceExcerpt: 'The HTML response has no Content-Security-Policy',
      recommendation: 'Send a Content-Security-Policy header with HTML responses.',
      ...overrides,
    });
  }

  it('names the problem, its reach, three examples and the recommendation', () => {
    const text = developerTaskText({
      ruleId: 'SEC-ASVS-001',
      language: 'en',
      issues: [csp(1), csp(2), csp(3), csp(4)],
      allLoaded: true,
      openFindings: 4,
    });
    expect(text).toBe(
      [
        'Task: Pages do not limit where they load content from',
        'FluxRadar check: Content-Security-Policy is missing or weak (SEC-ASVS-001)',
        'Found on 4 pages.',
        '',
        'Example pages:',
        '- https://shop.example.com/page-1',
        '- https://shop.example.com/page-2',
        '- https://shop.example.com/page-3',
        '',
        'What was found: These pages do not tell the browser which outside sources it may load content from.',
        '',
        'What to do: Ask your website developer to set this protection up on the server and to check that the site still works as before. The specifics are in the technical details.',
        '',
        'Recommendation: Send a Content-Security-Policy header with HTML responses.',
      ].join('\n'),
    );
  });

  it('uses the localized recommendation and leaves the owner’s advice out when there is one', () => {
    const text = developerTaskText({
      ruleId: 'SEC-ASVS-001',
      language: 'uk',
      issues: [
        csp(1, {
          localized: {
            en: { evidenceExcerpt: null, recommendation: 'Send the header.' },
            uk: { evidenceExcerpt: null, recommendation: 'Надсилайте заголовок.' },
          },
        }),
      ],
      allLoaded: true,
      openFindings: 1,
    });
    expect(text).toContain('Завдання: Сторінки не обмежують, звідки завантажувати вміст');
    expect(text).toContain('Знайдено на 1 сторінці.');
    expect(text).toContain('Рекомендація: Надсилайте заголовок.');
    expect(text).not.toContain('Що зробити:');
    expect(text).not.toContain('Send the header.');
  });

  it('says the page count is the total when one finding is one page, even half loaded', () => {
    const text = developerTaskText({
      ruleId: 'SEC-ASVS-001',
      language: 'en',
      issues: [csp(1), csp(2)],
      allLoaded: false,
      openFindings: 61,
    });
    expect(text).toContain('Found on 61 pages.');
  });

  it('says which part is partial when findings are not pages', () => {
    const cookie = (index: number, page: number): Issue =>
      csp(index, { ruleId: 'SEC-PASSIVE-005', targetUrl: `https://shop.example.com/p${page}` });
    const text = developerTaskText({
      ruleId: 'SEC-PASSIVE-005',
      language: 'en',
      issues: [cookie(1, 1), cookie(2, 1), cookie(3, 2)],
      allLoaded: false,
      openFindings: 40,
    });
    expect(text).toContain('40 open findings; the 3 open ones loaded so far are on 2 pages.');
    // A page with two cookies is one example, not two.
    expect(text?.match(/^- /gm)).toHaveLength(2);
  });

  it('keeps an unexplained rule’s technical title and adds no plain-language lines', () => {
    const text = developerTaskText({
      ruleId: 'A11Y-002',
      language: 'en',
      issues: [csp(1, { ruleId: 'A11Y-002', recommendation: 'Add alt text.' })],
      allLoaded: true,
      openFindings: 1,
    });
    expect(text?.split('\n')[0]).toBe('Task: Images without a text alternative');
    expect(text).not.toContain('What was found:');
    expect(text).not.toContain('What to do:');
    expect(text).toContain('Recommendation: Add alt text.');
  });

  it('says only the count when open findings exist but none is loaded', () => {
    const text = developerTaskText({
      ruleId: 'SEC-ASVS-001',
      language: 'en',
      issues: [],
      allLoaded: false,
      openFindings: 9,
    });
    expect(text).toContain('Found on 9 pages.');
    expect(text).not.toContain('Example pages:');
    expect(text).not.toContain('Recommendation:');
  });

  it('has nothing to say when nothing is open or known to be open', () => {
    expect(
      developerTaskText({
        ruleId: 'SEC-ASVS-001',
        language: 'en',
        issues: [],
        allLoaded: false,
        openFindings: null,
      }),
    ).toBeNull();
  });

  // Regression: settled findings were counted and offered as examples, so a
  // problem the owner had partly dismissed was handed on at its full size.
  // Regression: without a summary the loaded open findings were claimed as the
  // whole problem — "Found on 3 pages." for a 61-page problem.
  it('calls the loaded part a lower bound when there is no summary', () => {
    const text = developerTaskText({
      ruleId: 'SEC-ASVS-001',
      language: 'en',
      issues: [csp(1), csp(2), csp(3)],
      allLoaded: false,
      openFindings: null,
    });
    expect(text).toContain('At least 3 open findings on 3 pages; only part of the list is loaded.');
    expect(text).not.toContain('Found on');
    const uk = developerTaskText({
      ruleId: 'SEC-ASVS-001',
      language: 'uk',
      issues: [csp(1)],
      allLoaded: false,
      openFindings: null,
    });
    expect(uk).toContain(
      'Відкритих знахідок: щонайменше 1, на 1 сторінці; завантажено лише частину списку.',
    );
  });

  // Regression: the button vanished when the open findings sat past the loaded page.
  it('still makes a task when the open findings are not loaded yet, without examples', () => {
    const settledPage = [1, 2, 3].map((index) => csp(index, { status: 'Ignored' }));
    const text = developerTaskText({
      ruleId: 'SEC-ASVS-001',
      language: 'en',
      issues: settledPage,
      allLoaded: false,
      openFindings: 12,
    });
    expect(text).toContain('Task: Pages do not limit where they load content from');
    expect(text).toContain('Found on 12 pages.');
    expect(text).not.toContain('Example pages:');
    expect(text).not.toMatch(/^- /m);
    // The loaded findings are all settled: their recommendation is not handed
    // on, and the plain advice stands in for it.
    expect(text).not.toContain('Recommendation:');
    expect(text).toContain('What to do: Ask your website developer');
    expect(
      nothingOpen({
        ruleId: 'SEC-ASVS-001',
        language: 'en',
        issues: settledPage,
        allLoaded: false,
        openFindings: 12,
      }),
    ).toBe(false);
  });

  // Regression: a summary fetched before a finding was reopened said 0 open,
  // and the task read "Found on 0 pages." beside a loaded open finding.
  it('never counts fewer open findings than are loaded', () => {
    const text = developerTaskText({
      ruleId: 'SEC-ASVS-001',
      language: 'en',
      issues: [csp(1)],
      allLoaded: false,
      openFindings: 0,
    });
    expect(text).toContain('Found on 1 page.');
  });

  // Regression: with no open finding loaded, the recommendation came from a
  // settled one — for an AI rule, advice the owner had rejected.
  it('hands on no recommendation from a settled finding', () => {
    const ai = (index: number, overrides: Partial<Issue>): Issue =>
      csp(index, { ruleId: 'UX-CONV-AI-001', module: 'UX/Conversion', ...overrides });
    const text = developerTaskText({
      ruleId: 'UX-CONV-AI-001',
      language: 'en',
      issues: [ai(1, { status: 'False Positive', recommendation: 'Rejected advice' })],
      allLoaded: false,
      openFindings: 2,
    });
    expect(text).not.toContain('Rejected advice');
    expect(text).not.toContain('Recommendation:');
    expect(text).toContain('What to do: Read the page as a first-time visitor');
    expect(text).toContain('2 open findings.');
  });

  it('words the partial count in agreement with its numbers', () => {
    expect(findingsCopy.en.task.wherePartial(40, 1, 1)).toBe(
      '40 open findings; the 1 open one loaded so far is on 1 page.',
    );
    expect(findingsCopy.uk.task.wherePartial(40, 1, 1)).toBe(
      'Відкритих знахідок: 40; серед завантажених відкрито 1 — на 1 сторінці.',
    );
    expect(findingsCopy.uk.task.wherePartial(40, 21, 3)).toBe(
      'Відкритих знахідок: 40; серед завантажених відкрито 21 — на 3 сторінках.',
    );
  });

  it('knows when nothing is open at all', () => {
    const settled = [csp(1, { status: 'Ignored' })];
    const input = {
      ruleId: 'SEC-ASVS-001',
      language: 'en' as const,
      issues: settled,
      allLoaded: true,
      openFindings: 0,
    };
    expect(developerTaskText(input)).toBeNull();
    expect(nothingOpen(input)).toBe(true);
    // Without a summary, only a fully loaded list can say nothing is open.
    expect(nothingOpen({ ...input, openFindings: null })).toBe(true);
    expect(nothingOpen({ ...input, openFindings: null, allLoaded: false })).toBe(false);
  });

  it('describes only the work still open', () => {
    const settled = (index: number, status: string): Issue => csp(index, { status });
    const loaded = [
      settled(1, 'Ignored'),
      settled(2, 'False Positive'),
      settled(3, 'Resolved'),
      settled(4, 'Ignored'),
      csp(5),
      csp(6, { status: 'Acknowledged' }),
      csp(7, { status: 'Reopened' }),
    ];
    const partial = developerTaskText({
      ruleId: 'SEC-ASVS-001',
      language: 'en',
      issues: loaded,
      allLoaded: false,
      openFindings: 57,
    });
    expect(partial).toContain('Found on 57 pages.');
    expect(partial).toContain('- https://shop.example.com/page-5');
    expect(partial).not.toMatch(/page-[1-4]$/m);

    const complete = developerTaskText({
      ruleId: 'SEC-ASVS-001',
      language: 'en',
      issues: loaded,
      allLoaded: true,
      openFindings: 3,
    });
    expect(complete).toContain('Found on 3 pages.');
    expect(
      developerTaskText({
        ruleId: 'SEC-ASVS-001',
        language: 'en',
        issues: [settled(1, 'Ignored')],
        allLoaded: true,
        openFindings: 0,
      }),
    ).toBeNull();
  });
});
