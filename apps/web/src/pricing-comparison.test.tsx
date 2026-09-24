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
import { BASIC_PRICE, COMPLETE_PRICE, WEBSITE_AUDIT_PRICE } from './tariff-prices';

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
  it.each<Language>(['en', 'uk'])('compares the three products in %s', (language) => {
    const explainer = copy[language].pricing.explainer;
    const table = comparisonTable(language);

    // One column per product, named after the product a buyer sees on the card.
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      explainer.aspect,
      explainer.basicColumn,
      explainer.websiteAuditColumn,
      explainer.completeColumn,
    ]);

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
        const [basic, websiteAudit, complete] = Array.from(line.querySelectorAll('td'));
        expect(basic?.textContent).toBe(row.basic);
        expect(websiteAudit?.textContent).toBe(row.websiteAudit);
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
    expect(new Set(labels)).toEqual(
      new Set([explainer.basicColumn, explainer.websiteAuditColumn, explainer.completeColumn]),
    );
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
        within(row).getByText(new RegExp(WEBSITE_AUDIT_PRICE.replace('$', '\\$'))),
      ).toBeInTheDocument();
      expect(
        within(row).getByText(new RegExp(COMPLETE_PRICE.replace('$', '\\$'))),
      ).toBeInTheDocument();
      // Read once per row, and only once: the price is not repeated as prose.
      expect(screen.getByText(pricing.explainer.footnote)).toBeInTheDocument();
    },
  );

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
