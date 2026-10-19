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
// parentheses. There is no exception any more: the SEO card's foot, which the
// check-count parity test matches, is a plain phrase too.
describe('home page names standards after plain words', () => {
  const STANDARDS = /OWASP ASVS|ASVS|OWASP|WCAG|canonical|JSON-LD|GEO/g;

  function homeSentences(language: Language): readonly string[] {
    const home = copy[language].home;
    return [
      home.hero.title,
      home.hero.lede,
      home.hero.note,
      ...home.hero.example.findings.flatMap((finding) => [finding.problem, finding.action]),
      ...belowHeroSentences(language),
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

  // The hero lede is the first thing an owner reads under the title.
  it.each(LANGUAGES)('drops "operating picture" from the hero lede (%s)', (language) => {
    expect(copy[language].home.hero.lede).not.toMatch(/operating picture|картину/i);
  });
});

/** Every string leaf of a copy object, in source order. */
function leaves(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(leaves);
  return [];
}

/**
 * Everything the home page says below the hero and the example report: what
 * the report shows, what we check, how it works, the pricing block and the last
 * call. A persona review of salon, clinic and law-office owners still tripped
 * over each term the next test bans, all of them in these sections.
 */
function belowHeroSentences(language: Language): readonly string[] {
  const home = copy[language].home;
  return [
    ...leaves(home.capabilities),
    ...leaves(home.coverageEntry),
    ...leaves(home.workflow),
    ...leaves(home.lastCall),
    home.pricingTitle,
    home.pricingLead,
    home.pricingEyebrow,
    ...leaves(copy[language].pricing),
  ];
}

describe('home page below the hero, in an owner’s words', () => {
  // Words an owner cannot act on. Standards that still help (OWASP, WCAG) are
  // allowed, in parentheses, by the test above; these are not allowed at all.
  const JARGON =
    /canonical|JSON-LD|robots\.txt|meta description|structured data|структурован|click depth|глибин\S* клік|internal link|перелінков|deterministic|детермінован|ASVS|2\.2 AA|EN 301 549|Section 508|false certainty|фальшив|UX\/|Issue Center|crawler|краулер|AI-асистент|AI-робот|crawl/i;

  it.each(LANGUAGES)('uses none of the terms owners tripped over (%s)', (language) => {
    const hits = belowHeroSentences(language).filter((sentence) => JARGON.test(sentence));
    expect(hits).toEqual([]);
  });

  it('says “ШІ” rather than “AI” in Ukrainian', () => {
    const hits = belowHeroSentences('uk').filter((sentence) => /\bAI\b/.test(sentence));
    expect(hits).toEqual([]);
  });

  // Owner rule: a headline is a sentence, a verb or a colon, never “X — Y”.
  it.each(LANGUAGES)('keeps dash constructions out of the headlines (%s)', (language) => {
    const home = copy[language].home;
    const pricing = copy[language].pricing;
    const headlines = [
      home.capabilities.title,
      home.capabilities.seo.title,
      home.capabilities.ai.title,
      home.capabilities.integrity.title,
      home.coverageEntry.title,
      home.workflow.title,
      home.workflow.step1Title,
      home.workflow.step2Title,
      home.workflow.step3Title,
      `${home.lastCall.titleLine1} ${home.lastCall.titleEm}`,
      home.pricingTitle,
      pricing.explainer.title,
    ];
    expect(headlines.filter((headline) => /\s[—–-]\s/.test(headline))).toEqual([]);
  });

  // Each card opens with one line on who it is for, and the two lines say two
  // things; a short list of what the plan checks follows.
  it.each(LANGUAGES)('gives every plan one short line on who it is for (%s)', (language) => {
    const cards = copy[language].pricing.cards;
    const lines = [cards.basic, cards.complete].map((card) => card.description);
    // One sentence a visitor reads at a glance.
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(140);
    expect(new Set(lines).size).toBe(2);
    expect(cards.basic.description).toMatch(/Google/);
    for (const card of [cards.basic, cards.complete]) {
      expect(card.checks.length).toBeGreaterThanOrEqual(3);
      expect(card.checks.length).toBeLessThanOrEqual(6);
    }
  });

  // The coverage entry is a list now; the full technical one stays a link away.
  it.each(LANGUAGES)('lists what we check and links to every check (%s)', (language) => {
    const home = copy[language].home.coverageEntry;
    expect(home.items.length).toBeGreaterThanOrEqual(5);
    expect(copy[language].pricing.coverageLink).toMatch(/→$/);
  });

  // Prices are read from the tariff table, never written into the copy.
  it.each(LANGUAGES)('writes no price by hand below the hero (%s)', (language) => {
    const pricing = copy[language].pricing;
    const priced = new Set([pricing.cards.basic.price, pricing.cards.complete.price]);
    const handWritten = belowHeroSentences(language)
      .filter((sentence) => !priced.has(sentence))
      .flatMap((sentence) => sentence.match(/\$\d+/g) ?? [])
      .filter((price) => ![...priced].some((tariff) => tariff.startsWith(price)));
    expect(handWritten).toEqual([]);
  });
});
