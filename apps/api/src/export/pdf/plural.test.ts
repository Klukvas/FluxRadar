import { describe, expect, it } from 'vitest';

import { REPORT_COPY } from './copy.ts';
import { ukAfterCount, ukPlural, ukPluralForm, ukStillOpen } from './plural.ts';

describe('ukPluralForm', () => {
  it.each([
    [1, 'one'],
    [21, 'one'],
    [101, 'one'],
    [2, 'few'],
    [4, 'few'],
    [23, 'few'],
    [0, 'many'],
    [5, 'many'],
    [11, 'many'],
    [12, 'many'],
    [14, 'many'],
    [111, 'many'],
    [25, 'many'],
  ] as const)('%i takes the %s form', (count, form) => {
    expect(ukPluralForm(count)).toBe(form);
  });

  it('agrees the noun with the count', () => {
    const forms = { one: 'критична', few: 'критичні', many: 'критичних' };
    expect(ukPlural(1, forms)).toBe('критична');
    expect(ukPlural(3, forms)).toBe('критичні');
    expect(ukPlural(7, forms)).toBe('критичних');
    expect(ukAfterCount(1, 'сторінки', 'сторінок')).toBe('сторінки');
    expect(ukAfterCount(18, 'сторінки', 'сторінок')).toBe('сторінок');
  });
});

describe('ukStillOpen', () => {
  it.each([
    [1, 21, '1 з 21 знахідки ще відкрита'],
    [2, 21, '2 з 21 знахідки ще відкриті'],
    [5, 22, '5 з 22 знахідок ще відкриті'],
    [11, 21, '11 з 21 знахідки ще відкриті'],
    [21, 22, '21 з 22 знахідок ще відкрита'],
    [22, 25, '22 з 25 знахідок ще відкриті'],
  ] as const)('%i of %i', (open, total, expected) => {
    expect(ukStillOpen(open, total)).toBe(expected);
    expect(REPORT_COPY.uk.actionPlanProgress(open, total)).toBe(expected);
  });
});

describe('the verdict sentences', () => {
  it('agrees the Ukrainian count with the noun', () => {
    expect(REPORT_COPY.uk.verdict.critical(1)).toBe(
      'Є 1 критична знахідка. Виправте її першою, решта може почекати.',
    );
    expect(REPORT_COPY.uk.verdict.critical(3)).toBe(
      'Є 3 критичні знахідки. Виправте їх першими, решта може почекати.',
    );
    expect(REPORT_COPY.uk.verdict.critical(5)).toBe(
      'Є 5 критичних знахідок. Виправте їх першими, решта може почекати.',
    );
    expect(REPORT_COPY.uk.verdict.high(2)).toBe(
      'Критичних знахідок немає, але 2 важливі знахідки варто виправити найближчим часом.',
    );
  });

  it('writes the weakest section without a spaced slash', () => {
    expect(REPORT_COPY.uk.verdict.weakest('SEO', 54)).toBe('Найслабший розділ: SEO (54 зі 100).');
    expect(REPORT_COPY.en.verdict.weakest('SEO', 54)).toBe('Weakest section: SEO (54 of 100).');
    expect(REPORT_COPY.en.verdict.critical(1)).toBe(
      'There is 1 critical finding. Fix it first; the rest can wait.',
    );
  });

  it('counts the checked sections with the right noun', () => {
    expect(REPORT_COPY.uk.sectionsLead(1)).toBe('Перевірено 1 напрям.');
    expect(REPORT_COPY.uk.sectionsLead(2)).toMatch(/^Перевірено 2 напрями\. /);
    expect(REPORT_COPY.uk.sectionsLead(10)).toMatch(/^Перевірено 10 напрямів\. /);
    expect(REPORT_COPY.en.sectionsLead(1)).toBe('1 area checked.');
    expect(REPORT_COPY.en.sectionsLead(2)).toMatch(/^2 areas checked\. /);
  });

  it('names distinct problems in the open tile only when there are fewer of them', () => {
    expect(REPORT_COPY.uk.openCaption(8, 3)).toBe('знахідок у 3 різних проблемах');
    // The tile's label already says "open"; the caption does not repeat it.
    expect(REPORT_COPY.uk.openCaption(3, 3)).toBe('знахідки');
    expect(REPORT_COPY.en.openCaption(1, 1)).toBe('finding');
  });

  it('states pages as «a з n» with the right case', () => {
    expect(REPORT_COPY.uk.affectedPages(5, 18)).toBe('на 5 з 18 сторінок');
    expect(REPORT_COPY.uk.affectedPages(1, 1)).toBe('на 1 з 1 сторінки');
    expect(REPORT_COPY.en.affectedPages(1, 1)).toBe('on 1 of 1 page');
  });
});
