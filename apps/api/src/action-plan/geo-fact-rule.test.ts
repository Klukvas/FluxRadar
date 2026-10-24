// GEO-VIS-009 as an Action Plan rule: a count and page addresses, never the
// statements or the quotes the digest keeps for the report.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildActionPlanRequest, buildPrompt, GEO_FACT_ADVICE } from '@fluxradar/ai';
import { describe, expect, it } from 'vitest';

import { geoFactRuleFromMetadata } from './geo-fact-rule.ts';
import { overlayFor } from './overlay.ts';

const ANSWER_QUOTE = 'implants from $2,000 at the riverside branch';
const SITE_QUOTE = 'Implants from $500.';

function group(key: string, url: string | null) {
  return {
    source: { key, kind: url === null ? 'profile' : 'page', label: 'Prices', url },
    differences: [
      {
        claim: 'Implants cost $2,000.',
        providers: ['openai'],
        answerQuote: ANSWER_QUOTE,
        sourceQuote: SITE_QUOTE,
      },
    ],
  };
}

function metadataWith(groups: readonly unknown[]): string {
  return JSON.stringify({
    providerVisibility: {
      answerDigest: { facts: { answersChecked: 4, differenceCount: groups.length, groups } },
    },
  });
}

describe('the GEO-VIS-009 plan row', () => {
  it('counts one finding per source and samples page addresses without their query', () => {
    const rule = geoFactRuleFromMetadata(
      metadataWith([
        group('page:https://acme.example/prices', 'https://acme.example/prices/?utm=x#top'),
        group('profile:offerings', null),
        group('page:https://acme.example/about', 'https://acme.example/about'),
        group('page:https://acme.example/team', 'https://acme.example/team'),
        group('page:https://acme.example/faq', 'https://acme.example/faq'),
      ]),
      'en',
    );

    expect(rule).toEqual({
      ruleId: 'GEO-VIS-009',
      title: 'AI answers differ from your site',
      module: 'AI SEO / GEO',
      severity: 'Informational',
      openIssues: 5,
      sampleUrls: [
        'https://acme.example/prices/',
        'https://acme.example/about',
        'https://acme.example/team',
      ],
      // Both kinds of source are present, so both of the report's advices go.
      recommendations: [GEO_FACT_ADVICE.page.en, GEO_FACT_ADVICE.profile.en],
    });
  });

  it('sends no statement and no quote to the provider', () => {
    const rule = geoFactRuleFromMetadata(
      metadataWith([group('page:https://acme.example/prices', 'https://acme.example/prices')]),
      'uk',
    );
    if (rule === null) throw new Error('expected a GEO-VIS-009 row');
    const prompt = buildPrompt(
      buildActionPlanRequest({
        scanId: 'scan-1',
        domain: 'acme.example',
        language: 'uk',
        modules: [{ module: 'AI SEO / GEO', status: 'Completed', score: null, coverage: 1 }],
        rules: [rule],
        consent: null,
      }),
    ).promptText;

    expect(prompt).toContain('Rule GEO-VIS-009');
    expect(prompt).toContain('openIssues=1');
    expect(prompt).not.toContain(ANSWER_QUOTE);
    expect(prompt).not.toContain(SITE_QUOTE);
    expect(prompt).not.toContain('Implants cost $2,000.');
  });

  it('has no row for a scan without differences or without a digest', () => {
    expect(geoFactRuleFromMetadata(metadataWith([]), 'en')).toBeNull();
    expect(geoFactRuleFromMetadata(JSON.stringify({ providerVisibility: {} }), 'en')).toBeNull();
    expect(geoFactRuleFromMetadata('not json', 'en')).toBeNull();
    expect(geoFactRuleFromMetadata(null, 'en')).toBeNull();
  });
});

describe('an Action that names GEO-VIS-009', () => {
  it('stays open while the differences stand, without changing Reach', () => {
    const overlay = overlayFor([{ ruleIds: ['GEO-VIS-009'] }, { ruleIds: ['SEO-TECH-001'] }], {
      open: new Map([['SEO-TECH-001', 2]]),
      total: new Map([['SEO-TECH-001', 3]]),
      totalOpen: 4,
      informational: new Map([['GEO-VIS-009', 3]]),
    });

    expect(overlay.actions[0]).toEqual({ openIssues: 3, totalIssues: 3, settled: false });
    expect(overlay.actions[1]).toEqual({ openIssues: 2, totalIssues: 3, settled: false });
    expect(overlay.reach).toMatchObject({ addressedOpenIssues: 2, totalOpenIssues: 4, share: 0.5 });
  });
});

/**
 * The report's advice as the web copy declares it, in declaration order
 * (English first, then Ukrainian). The web bundle has no workspace
 * dependencies, so this is read as text — the same seam the rule titles use.
 */
function reportAdvice(key: 'factsPageAdvice' | 'factsProfileAdvice'): readonly string[] {
  const source = readFileSync(
    resolve(process.cwd(), '..', 'web', 'src', 'geo-digest-copy.ts'),
    'utf8',
  );
  const pattern = new RegExp(`${key}:\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'g');
  return [...source.matchAll(pattern)].map((match) => match[1] ?? '');
}

describe('the GEO-VIS-009 advice', () => {
  // The Action Plan notice promises "the rule's recommendations as the report
  // shows them": one sentence in two places would drift.
  it('is the sentence the report shows, in both languages', () => {
    expect(reportAdvice('factsPageAdvice')).toEqual([
      GEO_FACT_ADVICE.page.en,
      GEO_FACT_ADVICE.page.uk,
    ]);
    expect(reportAdvice('factsProfileAdvice')).toEqual([
      GEO_FACT_ADVICE.profile.en,
      GEO_FACT_ADVICE.profile.uk,
    ]);
  });

  it('goes into the plan row in the plan’s language, as the report shows it', () => {
    const metadata = metadataWith([
      group('page:https://acme.example/prices', 'https://acme.example/prices'),
    ]);

    expect(geoFactRuleFromMetadata(metadata, 'uk')?.recommendations).toEqual([
      reportAdvice('factsPageAdvice')[1],
    ]);
    expect(geoFactRuleFromMetadata(metadata, 'en')?.recommendations).toEqual([
      reportAdvice('factsPageAdvice')[0],
    ]);
    // A plan language the report does not have gets the English text, the
    // way an issue row without that translation does.
    expect(geoFactRuleFromMetadata(metadata, 'de')?.recommendations).toEqual([
      reportAdvice('factsPageAdvice')[0],
    ]);
  });
});
