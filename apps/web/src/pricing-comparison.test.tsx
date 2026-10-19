// "Which one is right for you?" used to be paragraphs of prose, so a visitor
// who is not a developer had to hold one product in their head while reading
// the next. It is a comparison, so it is a table — and a table only helps if it
// is a real one: a caption that says what is being compared, a column per
// product, a row header per question, and both languages carrying the same
// grid. On a phone it stacks instead of scrolling sideways, which is a
// stylesheet decision and is pinned as one. The rendered geometry is verified
// in a real browser at 1440–360.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PricingExplainer } from './Pricing';
import { copy, type Language } from './i18n';
import { PLAN_CAPABILITIES, PLAN_MODULES } from './plan-modules';
import { BASIC_PRICE, COMPLETE_PRICE } from './tariff-prices';

const BASE_CSS = readFileSync(join(resolve(process.cwd()), 'src', 'styles', 'base.css'), 'utf8');

afterEach(() => {
  cleanup();
});

/** The declarations of one at-rule or rule, up to its matching close. */
function block(opener: string): string {
  const start = BASE_CSS.indexOf(opener);
  if (start === -1) throw new Error(`base.css has no ${opener}`);
  let depth = 0;
  for (let at = BASE_CSS.indexOf('{', start); at < BASE_CSS.length; at += 1) {
    if (BASE_CSS[at] === '{') depth += 1;
    if (BASE_CSS[at] === '}') {
      depth -= 1;
      if (depth === 0) return BASE_CSS.slice(start, at + 1);
    }
  }
  throw new Error(`base.css never closes ${opener}`);
}

function comparisonTable(language: Language): HTMLElement {
  render(<PricingExplainer language={language} />);
  return screen.getByRole('table', {
    name: copy[language].pricing.explainer.tableCaption,
  });
}

describe('the plain-language pricing comparison', () => {
  it.each<Language>(['en', 'uk'])('compares the two products on sale in %s', (language) => {
    const explainer = copy[language].pricing.explainer;
    const table = comparisonTable(language);

    // One column per product, named after the product a buyer sees on the card.
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([explainer.aspect, explainer.basicColumn, explainer.completeColumn]);

    // One row per question, each headed by the question it answers.
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual([
      explainer.rows.question.label,
      explainer.rows.included.label,
      explainer.rows.notIncluded.label,
      explainer.rows.chooseWhen.label,
      explainer.rows.price.label,
      explainer.rows.difference.label,
    ]);
  });

  it.each<Language>(['en', 'uk'])(
    'answers every row for every product in %s, from the dictionary',
    (language) => {
      const rows = copy[language].pricing.explainer.rows;
      const table = comparisonTable(language);

      for (const row of Object.values(rows)) {
        const line = within(table).getByRole('rowheader', { name: row.label }).closest('tr');
        if (line === null) throw new Error(`${row.label} has no row`);
        const cells = Array.from(line.querySelectorAll('td'));
        expect(cells).toHaveLength(2);
        const [basic, complete] = cells;
        expect(basic?.textContent).toBe(row.basic);
        expect(complete?.textContent).toBe(row.complete);
      }
    },
  );

  // Stacked on a phone the columns are gone, so each answer has to say which
  // product it belongs to; the stylesheet prints it from `data-label`.
  it.each<Language>(['en', 'uk'])('labels each %s answer with its own product', (language) => {
    const explainer = copy[language].pricing.explainer;
    const table = comparisonTable(language);
    const labels = Array.from(table.querySelectorAll('tbody td')).map((cell) =>
      cell.getAttribute('data-label'),
    );
    expect(new Set(labels)).toEqual(new Set([explainer.basicColumn, explainer.completeColumn]));
  });

  // The two things a buyer must not have to guess: this is one payment for one
  // scan, and neither product needs a password to their site.
  it.each<Language>(['en', 'uk'])(
    'keeps the pay-per-scan and public-only terms in %s',
    (language) => {
      const pricing = copy[language].pricing;
      const table = comparisonTable(language);

      const price = within(table).getByRole('rowheader', {
        name: pricing.explainer.rows.price.label,
      });
      const row = price.closest('tr') as HTMLElement;
      expect(
        within(row).getByText(new RegExp(BASIC_PRICE.replace('$', '\\$'))),
      ).toBeInTheDocument();
      expect(
        within(row).getByText(new RegExp(COMPLETE_PRICE.replace('$', '\\$'))),
      ).toBeInTheDocument();
      // Read once per row, and only once: the price is not repeated as prose.
      expect(screen.getByText(pricing.explainer.footnote)).toBeInTheDocument();
    },
  );

  // The answers are read as a commitment, so they are checked against the
  // tariff matrix the API charges from rather than proof-read by eye. Basic's
  // "not included" used to list six of the eight modules it does not run,
  // leaving out UX/Conversion and Analytics. The home page now names each
  // module in an owner's words, so the check goes through this map: every
  // module the tariff table has must have a plain name in both languages, and
  // that plain name must be in the answer.
  const PLAIN_MODULE_NAMES: Readonly<Record<string, { en: string; uk: string }>> = {
    Security: { en: 'security', uk: 'безпека' },
    Performance: { en: 'speed', uk: 'швидкість' },
    Accessibility: {
      en: 'ease of use for people with disabilities',
      uk: 'зручність для людей з інвалідністю',
    },
    Reliability: { en: 'reliability', uk: 'стабільність роботи' },
    'Content Quality': { en: 'text quality', uk: 'якість текстів' },
    Privacy: { en: 'privacy', uk: 'приватність' },
    // The module reads the entry page's heading, the path to the main action,
    // form submission, and how clear the offer and the main action are.
    'UX/Conversion': {
      en: 'whether visitors understand what to do next',
      uk: 'чи зрозуміло відвідувачу, що робити далі',
    },
    // Its rules read Google Analytics / Search Console data, so the plain name
    // has to say the owner connects it.
    Analytics: {
      en: 'visitor statistics (if you connect google)',
      uk: 'статистика відвідувань (якщо підключите google)',
    },
  };

  it.each<Language>(['en', 'uk'])(
    'names every module Basic does not run, in plain words, in %s',
    (language) => {
      const beyondBasic = PLAN_MODULES.Complete.filter(
        (module) => !PLAN_MODULES.Basic.includes(module),
      );
      const rows = copy[language].pricing.explainer.rows;
      const cards = copy[language].pricing.cards;

      expect(beyondBasic).toHaveLength(8);
      for (const module of beyondBasic) {
        const plain = PLAIN_MODULE_NAMES[module]?.[language];
        if (plain === undefined) throw new Error(`${module} has no plain ${language} name`);
        // What Basic leaves out is exactly what Complete adds, on the table
        // and on the Complete card's list.
        for (const answer of [
          rows.notIncluded.basic,
          rows.included.complete,
          cards.complete.checks.join(' '),
        ]) {
          expect(answer.toLowerCase()).toContain(plain);
        }
      }
    },
  );

  // The retired Website Audit package has no card, column or answer.
  it.each<Language>(['en', 'uk'])('offers no Website Audit anywhere in %s', (language) => {
    const pricing = copy[language].pricing;
    expect(Object.keys(pricing.cards)).toEqual(['basic', 'complete']);
    expect(JSON.stringify(pricing)).not.toMatch(/Website Audit/);
  });

  it('promises scan history, export and the Action Plan only where the tariff carries them', () => {
    expect(PLAN_CAPABILITIES.Basic).toEqual({
      export: false,
      actionPlan: false,
      issueHistory: false,
    });
    expect(PLAN_CAPABILITIES.Complete).toEqual({
      export: true,
      actionPlan: true,
      issueHistory: true,
    });

    const PROMISES = {
      en: [/scan history/i, /export to a file/i, /AI action plan/i],
      uk: [/історі\S+ перевірок/i, /вивантаже\S+ у файл/i, /план\S* дій від ШІ/i],
    } as const;
    for (const language of ['en', 'uk'] as const) {
      const rows = copy[language].pricing.explainer.rows;
      const cards = copy[language].pricing.cards;
      for (const answer of [
        rows.included.complete,
        cards.complete.checks.join(' '),
        rows.notIncluded.basic,
      ]) {
        for (const promise of PROMISES[language]) expect(answer).toMatch(promise);
      }
      // Broader than the promises above on purpose: Basic must not name any
      // of the three, in any wording.
      const NEVER_ON_BASIC = {
        en: /scan history|export|action plan/i,
        uk: /історі|вивантаж|експорт|план дій/i,
      } as const;
      for (const answer of [rows.included.basic, cards.basic.checks.join(' ')]) {
        expect(answer).not.toMatch(NEVER_ON_BASIC[language]);
      }
    }
  });

  it('keeps the links and the notes the section closed with', () => {
    render(<PricingExplainer language="en" />);
    const pricing = copy.en.pricing;
    expect(screen.getByRole('link', { name: pricing.coverageLink })).toHaveAttribute(
      'href',
      '/checks',
    );
    expect(screen.getByRole('link', { name: pricing.faqLink })).toHaveAttribute('href', '/faq');
    expect(screen.getByText(pricing.startInWorkspace)).toBeInTheDocument();
    expect(screen.getByText(pricing.freeNote)).toBeInTheDocument();
  });

  // The prose the table replaced described one product at a time, which is the
  // reading it was meant to end.
  it('no longer asks the reader to compare paragraphs', () => {
    render(<PricingExplainer language="en" />);
    expect(screen.queryByText(/Take Basic if the question is visibility/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Take Complete if you need the whole picture/),
    ).not.toBeInTheDocument();
  });
});

describe('pricing comparison stylesheet contract', () => {
  it('sizes the table to its column instead of widening the page', () => {
    const table = block('.plan-compare {');
    expect(table).toMatch(/width: 100%;/);
    expect(table).toMatch(/table-layout: fixed;/);
    // A long word in a translation moves this frame, never the document.
    expect(block('.plan-compare-wrap {')).toMatch(/overflow-x: auto;/);
    expect(block('.plan-compare th,')).toMatch(/overflow-wrap: anywhere;/);
  });

  // The phone overrides share the one 699px block the rest of the site uses, so
  // they are read from where the stacking starts to the end of the file — the
  // base rules above it can no longer answer for them.
  const stackingStart = BASE_CSS.indexOf('.plan-compare,\n  .plan-compare thead,');
  if (stackingStart === -1) throw new Error('base.css never stacks the comparison');
  const phone = BASE_CSS.slice(stackingStart);

  it('stacks the rows on a phone rather than scrolling them sideways', () => {
    expect(phone).toMatch(/\.plan-compare td \{\s*\n\s*display: block;/);
    expect(phone).toMatch(/\.plan-compare thead \{\s*\n\s*display: none;/);
  });

  it('prints the product name on each stacked answer, since the columns are gone', () => {
    expect(phone).toMatch(/\.plan-compare td::before \{\s*\n\s*content: attr\(data-label\);/);
  });

  // Regression: the caption was left as a `table-caption` inside a parent that
  // is no longer a table, so it took an anonymous shrink-to-fit table wrapper
  // and set the sentence in 60px of a 308px phone — seventeen lines of one or
  // two words before the reader reached the first row.
  it('re-boxes the caption with the table, instead of leaving it to shrink-fit', () => {
    expect(phone).toMatch(/\.plan-compare caption \{\s*\n\s*display: block;/);
  });
});
