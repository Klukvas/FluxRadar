// The public example report (/example-report) — the words on it.
//
// It exists for a stranger: somebody weighing up the product who cannot see a
// report because they have not bought one. The suite was one 1,125-line file
// and is five now, one per question it answers; the helpers they share live in
// `example-report-test-support.tsx`.

import { afterEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';

import { exampleReportCopy } from './example-report-copy';
import { EXAMPLE_RULE_IDS } from './example-report-fixture';
import {
  cleanupExamplePage,
  openExample,
  plainText,
  unfoldEveryProblem,
} from './example-report-test-support';
import { findingsCopy } from './findings-copy';
import { copy } from './i18n';

afterEach(cleanupExamplePage);

describe('the words on it', () => {
  /**
   * Terms a nail-salon owner would have to look up. They are allowed inside the
   * page's one technical fold, which exists for whoever does the work, and
   * nowhere else.
   */
  const JARGON = [
    /\bSEO\b/g,
    /robots\.txt/gi,
    /\bcrawler/gi,
    /\bH1\b/g,
    /canonical/gi,
    /JSON-LD/gi,
    /\bHTTP\b/g,
    /\bAPI\b/g,
    /\bDOM\b/g,
    /\bmeta\b/gi,
  ];

  it.each(['en', 'uk'] as const)('uses none of the jargon denylist (%s)', async (language) => {
    await openExample(language);
    const text = plainText();

    for (const term of JARGON) {
      const found = text.match(term) ?? [];
      // One exemption, and it is the useful one: the advice for two of these
      // rules names the field an owner will actually see in their own site
      // builder — "often called the SEO description". Naming that label is the
      // whole value of the sentence, so the word is allowed immediately after
      // "called the" and nowhere else.
      if (found.every((occurrence) => occurrence === 'SEO')) {
        for (const fragment of text.split('SEO').slice(0, -1)) {
          expect(fragment.slice(-30)).toMatch(language === 'en' ? /called the $/ : /зветься $/);
        }
        continue;
      }
      expect({ term: String(term), found }).toEqual({ term: String(term), found: [] });
    }
  });

  // The glossary defined "Alt text" for a report with no photo problem in it,
  // and (after the problems were realigned with the home page's preview) would
  // have gone on defining "Page title" for a report that no longer reports on
  // page names. A word is in the glossary because the page uses it.
  it.each(['en', 'uk'] as const)('defines only words the page uses (%s)', async (language) => {
    await openExample(language);
    unfoldEveryProblem();
    const t = exampleReportCopy[language];
    const glossary = document.querySelector('.example-glossary') as HTMLElement;
    const body = document.body.cloneNode(true) as HTMLElement;
    for (const inGlossary of body.querySelectorAll('.example-glossary')) inGlossary.remove();
    const rest = (body.textContent ?? '').toLowerCase();

    expect(t.glossary.length).toBeGreaterThan(0);
    for (const entry of t.glossary) {
      expect(glossary.textContent).toContain(entry.term);
      // The term as the page says it elsewhere. An entry titled for a reader
      // carries the field's own label in brackets — "Опис зображення
      // (alt-текст)" — and that bracketed label is what the explanations name
      // in running text; a Ukrainian heading would not survive the inflection.
      const word = (/\(([^)]+)\)$/.exec(entry.term)?.[1] ?? entry.term).toLowerCase();
      expect({ term: entry.term, used: rest.includes(word) }).toEqual({
        term: entry.term,
        used: true,
      });
    }
  });

  // The report's own "Findings" entry ends "Open the findings list below to
  // review them" — and below it on this page are the technical fold and the
  // footer. The list is above, and there is no Issue Center to open.
  it.each(['en', 'uk'] as const)(
    'points its last block at what is on the page (%s)',
    async (language) => {
      await openExample(language);
      const t = exampleReportCopy[language];
      const report = copy[language].report;
      const help = screen.getByRole('heading', { name: report.helpHeading }).closest('section');

      expect(help?.textContent).toContain(t.helpFindingsBody);
      expect(help?.textContent).not.toContain(report.helpFindingsBody);
      // It names the block the reader can actually reach instead.
      expect(t.helpFindingsBody).toContain(findingsCopy[language].fixFirst.heading);
    },
  );

  // "The free check needs no payment and no card" was true and was not the
  // whole price: the home page's own CTA opens registration, because a free
  // check needs an account (`HomeRoute`, `visitorHandlers.onStart`).
  it.each(['en', 'uk'] as const)('says the free check needs an account (%s)', async (language) => {
    await openExample(language);
    const t = exampleReportCopy[language];
    const cta = document.querySelector('.example-cta') as HTMLElement;

    const account = language === 'en' ? /free account/i : /безкоштовний акаунт/i;
    expect(t.ctaBody).toMatch(account);
    expect(t.ctaFree).toMatch(account);
    expect(cta.textContent).toContain(t.ctaBody);
    // And the home page's own limit on it, which the example left out.
    expect(t.ctaBody).toMatch(language === 'en' ? /per account/i : /на акаунт/i);
    // Still no price and no card: an account is free too.
    expect(cta.textContent).not.toMatch(/\$\d|\bUSD\b/);
  });

  // "Report · Complete — six of its ten sections shown here" left the one word
  // in it that is a product decision unexplained.
  it.each(['en', 'uk'] as const)(
    'says what the plan name means, with no price (%s)',
    async (language) => {
      await openExample(language);
      const t = exampleReportCopy[language];
      const notice = document.querySelector('.legal-document__notice') as HTMLElement;

      expect(notice.textContent).toContain(t.planValue);
      expect(notice.textContent).toContain(t.planNote);
      const link = within(notice).getByRole('link', { name: t.planLink });
      // The home page's pricing section, by the route that scrolls to it.
      expect(link).toHaveAttribute('href', '/plans');
      // What each report includes — not what it costs, and nothing that starts a
      // purchase. This page may not price anything.
      for (const text of [t.planNote, t.planLink]) {
        expect(text).not.toMatch(/\$|\bUSD\b|price|pay|buy|card|ціна|оплат|картк|купи/i);
      }
    },
  );

  it('keeps the technical names in the fold and nowhere else', async () => {
    await openExample();
    const fold = document.querySelector('.example-technical');
    if (fold === null) throw new Error('expected the technical fold');

    // Folded by default: the page opens on what the owner can read.
    expect(fold.hasAttribute('open')).toBe(false);
    // Every rule id is in it, and in nothing else.
    for (const ruleId of EXAMPLE_RULE_IDS) {
      expect(fold.textContent).toContain(ruleId);
      expect(plainText()).not.toContain(ruleId);
    }
  });

  it('has one heading level per step, in order', async () => {
    await openExample();
    const levels = Array.from(document.querySelectorAll('h1, h2, h3'), (node) =>
      Number(node.tagName.slice(1)),
    );
    expect(levels[0]).toBe(1);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    // No level skipped: an h3 may only follow an h2 or another h3.
    for (const [index, level] of levels.entries()) {
      if (index === 0) continue;
      expect(level - (levels[index - 1] ?? 1)).toBeLessThanOrEqual(1);
    }
  });
});
