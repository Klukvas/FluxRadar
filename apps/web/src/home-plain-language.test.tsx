// The home page in plain words.
//
// The example report shows three findings on a made-up site, written the way a
// report writes them. What it must never do is pass for a result about the
// visitor's own website, drop the "what to do" half of a finding, or leave
// English behind in the Ukrainian page.

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ExampleReport } from './ExampleReport';
import { copy, type Language } from './i18n';

afterEach(() => {
  cleanup();
});

const LANGUAGES: readonly Language[] = ['en', 'uk'];

describe('example report on the home page', () => {
  it.each(LANGUAGES)('labels itself as an example, not the visitor’s site (%s)', (language) => {
    const t = copy[language].home.example;
    render(<ExampleReport language={language} />);

    const example = screen.getByRole('figure', { name: t.windowLabel });
    expect(within(example).getByText(t.badge)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: t.title })).toBeInTheDocument();
  });

  it.each(LANGUAGES)('shows three findings, each with where and what to do (%s)', (language) => {
    const t = copy[language].home.example;
    render(<ExampleReport language={language} />);

    const findings = within(screen.getByRole('figure', { name: t.windowLabel })).getAllByRole(
      'listitem',
    );
    expect(findings).toHaveLength(3);
    t.findings.forEach((finding, index) => {
      const item = findings[index] as HTMLElement;
      expect(within(item).getByRole('heading', { level: 3, name: finding.title })).toBeVisible();
      expect(item).toHaveTextContent(`${t.actionLabel}: ${finding.action}`);
      expect(item).toHaveTextContent(`${t.whereLabel}: ${finding.where}`);
    });
  });

  it('uses a reserved example domain, so it can never name a real site', () => {
    for (const language of LANGUAGES) {
      expect(copy[language].home.example.site).toMatch(/\.example$/);
    }
  });

  it('carries no English into the Ukrainian example beyond names it cannot translate', () => {
    const uk = copy.uk.home.example;
    const text = [
      uk.eyebrow,
      uk.title,
      uk.lead,
      uk.badge,
      uk.windowLabel,
      uk.summary,
      ...uk.findings.flatMap((finding) => [finding.severity, finding.where, finding.title]),
    ].join(' ');
    // "Google" is a name; the site name and the "alt-текст" field label are
    // left out of the list above for the same reason.
    expect(text.replaceAll('Google', '')).not.toMatch(/[A-Za-z]/);
  });
});

// A standard's name means nothing to an owner until it has been said in their
// words. On the home page the plain name comes first and the standard follows in
// parentheses. The SEO card's foot is the one exception: its wording is matched
// verbatim by apps/api/src/export/check-count-parity.test.ts.
describe('home page names standards after plain words', () => {
  const STANDARDS = /OWASP ASVS|ASVS|WCAG|canonical|JSON-LD|GEO/g;

  function homeSentences(language: Language): readonly string[] {
    const home = copy[language].home;
    return [
      home.hero.lede,
      home.instrument.moduleAiSeo,
      ...home.instrument.terminalLines,
      home.ticker.aiSeo,
      home.capabilities.seo.title,
      home.capabilities.seo.body,
      home.capabilities.ai.title,
      home.capabilities.ai.body,
      home.capabilities.integrity.body,
      home.coverageEntry.body,
      copy[language].pricing.cards.basic.included,
      copy[language].pricing.cards.websiteAudit.notIncluded,
      copy[language].pricing.cards.complete.included,
      copy[language].pricing.explainer.rows.included.basic,
      copy[language].pricing.explainer.rows.notIncluded.websiteAudit,
    ];
  }

  it.each(LANGUAGES)('puts every standard inside parentheses (%s)', (language) => {
    const bare = homeSentences(language).flatMap((sentence) =>
      [...sentence.matchAll(STANDARDS)]
        .filter((match) => {
          const before = sentence.slice(0, match.index);
          return before.lastIndexOf('(') <= before.lastIndexOf(')');
        })
        .map((match) => `${match[0]} in “${sentence}”`),
    );
    expect(bare).toEqual([]);
  });

  // One concept, one name: the instrument panel, the ticker and the capability
  // card all call the AI module the same thing, so an owner never wonders
  // whether they are three different checks.
  it.each(LANGUAGES)('gives the AI module one name on the home page (%s)', (language) => {
    const home = copy[language].home;
    const name = home.capabilities.ai.title;
    expect(home.instrument.moduleAiSeo).toBe(name);
    expect(home.ticker.aiSeo).toBe(name.toLocaleUpperCase(language));
  });

  // The eyebrow keeps the product's "audit station" name, which the menu bar,
  // the footer and the coverage page share; only the lede has to be plain.
  it.each(LANGUAGES)('drops "operating picture" from the hero lede (%s)', (language) => {
    expect(copy[language].home.hero.lede).not.toMatch(/operating picture|картину/i);
  });
});
