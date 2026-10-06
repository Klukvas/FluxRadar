// The home page in plain words.
//
// The example report shows three findings on a made-up site, written the way a
// report writes them. What it must never do is pass for a result about the
// visitor's own website, drop the "what to do" half of a finding, or leave
// English behind in the Ukrainian page.

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ExampleReport } from './ExampleReport';
import { homePreviewFindings, homePreviewLead, homePreviewSummary } from './example-home-preview';
import { EXAMPLE_HOME_PREVIEW, EXAMPLE_RULE_IDS } from './example-report-fixture';
import { copy, fillCopy, type Language } from './i18n';

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
    // The filled sentences, not the templates: the counts come from the
    // example report's fixture, so the raw copy still holds a `{count}`.
    homePreviewFindings(language).forEach((finding, index) => {
      const item = findings[index] as HTMLElement;
      expect(within(item).getByRole('heading', { level: 3, name: finding.title })).toBeVisible();
      expect(item).toHaveTextContent(`${t.actionLabel}: ${finding.action}`);
      expect(item).toHaveTextContent(`${t.whereLabel}: ${finding.where}`);
      expect(finding.title).not.toContain('{');
      expect(finding.where).not.toContain('{');
    });
  });

  // The preview and /example-report are one invented salon, and they described
  // it differently: four pages with no description here against seven there,
  // and twelve photos with no text description against a full example that had
  // no photo problem at all but defined "alt text" in its glossary. Every
  // number the preview prints is now read off that page's own fixture.
  it.each(LANGUAGES)('is an extract of the full example, to the number (%s)', (language) => {
    render(<ExampleReport language={language} />);
    const t = copy[language].home.example;
    const figure = screen.getByRole('figure', { name: t.windowLabel });

    // Three of six, said in the lead rather than left for the visitor to find
    // out after following the link.
    expect(homePreviewLead(language)).toContain(String(EXAMPLE_HOME_PREVIEW.problems));
    expect(EXAMPLE_HOME_PREVIEW.problems).toBe(EXAMPLE_RULE_IDS.length);
    expect(EXAMPLE_HOME_PREVIEW.lines).toHaveLength(3);
    // Every previewed problem is one of the example's own problems.
    for (const line of EXAMPLE_HOME_PREVIEW.lines) {
      expect(EXAMPLE_RULE_IDS).toContain(line.ruleId);
    }
    // And every count it prints is that problem's own count.
    const findings = within(figure).getAllByRole('listitem');
    EXAMPLE_HOME_PREVIEW.lines.forEach((line, index) => {
      expect(findings[index]).toHaveTextContent(String(line.count));
    });
    // The bar over them says how big the site is, from the same crawl.
    expect(figure.textContent).toContain(homePreviewSummary(language));
    expect(homePreviewSummary(language)).toContain(String(EXAMPLE_HOME_PREVIEW.pagesRead));
  });

  // The bar read "Problems shown: 6" over a list that draws three, under a lead
  // that says "3 of the 6". Each number now says whose it is, and all three
  // places read off the same constants.
  it.each(LANGUAGES)('agrees with itself: lead, bar and list (%s)', (language) => {
    render(<ExampleReport language={language} />);
    const figure = screen.getByRole('figure', { name: copy[language].home.example.windowLabel });
    const drawn = within(figure).getAllByRole('listitem').length;
    const numbers = (text: string): readonly number[] => (text.match(/\d+/g) ?? []).map(Number);

    expect(drawn).toBe(EXAMPLE_HOME_PREVIEW.lines.length);
    // The lead: "3 of the 6", the shown count first and the total second.
    const lead = screen.getByText(homePreviewLead(language));
    expect(numbers(lead.textContent ?? '')).toEqual([drawn, EXAMPLE_HOME_PREVIEW.problems]);
    // The bar: the full example's total, under a label that says it is that.
    const bar = figure.querySelector('.home-example__summary')?.textContent ?? '';
    expect(numbers(bar)).toEqual([EXAMPLE_HOME_PREVIEW.problems, EXAMPLE_HOME_PREVIEW.pagesRead]);
    expect(bar).toMatch(
      language === 'en'
        ? /^Problems in the full example: \d+ ·/
        : /^Проблем у повному прикладі: \d+ ·/,
    );
  });

  // Every number a line prints sits on its "Where", and the titles carry none:
  // «{count} посилання ведуть» was right for 3 and wrong for 5, «{count}
  // зображень» right for 12 and wrong for 2 to 4. So a fixture change can move
  // the numbers without touching the grammar.
  it('keeps the finding titles free of counts in both languages', () => {
    for (const language of LANGUAGES) {
      for (const finding of copy[language].home.example.findings) {
        expect(finding.title).not.toMatch(/\{count\}|\d/);
      }
    }
  });

  it.each([1, 2, 5, 11, 12, 21])(
    'fills each Ukrainian "Where" with %i and stays grammatical',
    (count) => {
      for (const finding of copy.uk.home.example.findings) {
        const filled = fillCopy(finding.where, { count });
        expect(filled).toContain(String(count));
        // A labelled count — «посилання — 5» — so no noun follows the numeral,
        // and a single colon: the line stands behind «Де:».
        expect(filled).not.toMatch(/\d+\s+\p{L}/u);
        expect(filled).not.toContain(':');
      }
    },
  );

  // English counts the noun on its "Where" — "3 links" — which is plural, so it
  // is right for every count but one. Pinned here so a fixture that previews a
  // single link fails loudly instead of printing "1 links".
  it('previews counts English can put a plural noun after', () => {
    for (const line of EXAMPLE_HOME_PREVIEW.lines) {
      expect(line.count).toBeGreaterThan(1);
    }
  });

  // «{problems} речі, які варто виправити» was filled with six, and «речі» is
  // the form a numeral ending in 1 takes: «6 речі» agreed with nothing.
  // Ukrainian wants «речей» for 5 to 20 and «речі» for 2 to 4, so the template
  // carries no counted noun at all now — in either language — and no number it
  // is filled with can disagree with the words around it. The parity tests look
  // for a leftover `{`, which this line never had.
  it.each([1, 2, 5, 11, 21])('fills the summary line with %i and stays grammatical', (problems) => {
    for (const language of LANGUAGES) {
      const filled = fillCopy(copy[language].home.example.summary, { problems, pages: problems });
      // The count really is in it, twice, and nothing is left unfilled.
      expect(filled).toContain(String(problems));
      expect(filled).not.toContain('{');
      // And no number in it is immediately followed by a word it would have to
      // agree with — which is the whole shape of the defect, in both languages.
      expect({ language, filled, counted: /\d+\s+\p{L}/u.test(filled) }).toEqual({
        language,
        filled,
        counted: false,
      });
    }
  });

  it('uses a reserved example domain, so it can never name a real site', () => {
    for (const language of LANGUAGES) {
      expect(copy[language].home.example.site).toMatch(/\.example$/);
    }
  });

  it('carries no English into the Ukrainian example beyond names it cannot translate', () => {
    const uk = copy.uk.home.example;
    // The filled sentences, because the templates hold `{count}`.
    const text = [
      uk.eyebrow,
      uk.title,
      homePreviewLead('uk'),
      uk.badge,
      uk.windowLabel,
      homePreviewSummary('uk'),
      ...homePreviewFindings('uk').flatMap((finding) => [
        finding.severity,
        finding.where,
        finding.title,
      ]),
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
