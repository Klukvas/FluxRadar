import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FREE_UPSELL_PLAN } from './FreeUpsell';
import { faqCopyEn, faqCopyUk } from './faq-copy';
import {
  FREE_CHECK_COUNT,
  FREE_SCORE_MAX,
  FREE_SCORE_UPGRADE_PLAN,
  FULL_SCORE_MAX,
  freeDialProps,
  freeScoreCopy,
  freeScoreHelp,
  showsRulePenalty,
} from './free-score-copy';
import { copy } from './i18n';

// The web app cannot import packages/contracts, so the Free numbers its copy
// states are mirrored and held to the contract source here, the way
// tariff-prices.test.ts holds the prices (D-237).

// Resolved from the vitest root (apps/web), as in tariff-prices.test.ts.
const CONTRACTS = resolve(process.cwd(), '../../packages/contracts/src');

/** The source with `//` line comments and block comments removed. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function contractFreeCheckCount(): number {
  const source = withoutComments(readFileSync(resolve(CONTRACTS, 'tariffs.ts'), 'utf8'));
  const list = /FREE_CHECK_RULE_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(source);
  if (list === null) throw new Error('FREE_CHECK_RULE_IDS not found in tariffs.ts');
  return (list[1]?.match(/'[A-Z0-9-]+'/g) ?? []).length;
}

function contractNumber(name: string): number {
  const source = withoutComments(readFileSync(resolve(CONTRACTS, 'free-score.ts'), 'utf8'));
  const match = new RegExp(`export const ${name} = (\\d+);`).exec(source);
  if (match === null) throw new Error(`${name} not found in free-score.ts`);
  return Number(match[1]);
}

describe('Free score mirrors of the contract', () => {
  it('states the number of Free checks the contract runs', () => {
    expect(FREE_CHECK_COUNT).toBe(contractFreeCheckCount());
  });

  it('prints the Free and the full score on the scales the contract uses', () => {
    expect(FREE_SCORE_MAX).toBe(contractNumber('FREE_SCORE_MAX'));
    expect(FULL_SCORE_MAX).toBe(contractNumber('FULL_SCORE_MAX'));
  });

  it('sends the score call to action to the primary Complete audit', () => {
    expect(FREE_SCORE_UPGRADE_PLAN).toBe(FREE_UPSELL_PLAN);
  });
});

const EN_DIAL_NOTE = 'Quick check: 6 light checks on the homepage only. Not everything is checked.';
const UK_DIAL_NOTE =
  'Швидка перевірка: 6 легких перевірок лише головної сторінки. Перевірено не все.';
const EN_RULE =
  'The free check is a quick check: 6 light checks on the homepage only, scored out of 40. Not everything is checked. The full audit checks the whole site and scores it out of 100.';
const UK_RULE =
  'Безкоштовна перевірка — це швидка перевірка: 6 легких перевірок лише головної сторінки з оцінкою з 40. Перевірено не все. Повний аудит перевіряє весь сайт і оцінює його за шкалою зі 100.';

const RU_DIAL_NOTE =
  'Быстрая проверка: 6 лёгких проверок только главной страницы. Проверено не всё.';
const RU_RULE =
  'Проверка Free быстрая: 6 лёгких проверок только главной страницы с оценкой из 40. Проверено не всё. Полный аудит проверяет весь сайт и оценивает его по шкале из 100.';

describe('the Free score disclosure', () => {
  it('states the quick check in the agreed words: one short line in the dial, the rule in help', () => {
    expect(freeScoreCopy.en.capDisclosure(6)).toBe(EN_DIAL_NOTE);
    expect(freeScoreCopy.uk.capDisclosure(6)).toBe(UK_DIAL_NOTE);
    expect(freeScoreCopy.en.capRule(6, 40, 100)).toBe(EN_RULE);
    expect(freeScoreCopy.uk.capRule(6, 40, 100)).toBe(UK_RULE);
    expect(freeScoreCopy.ru.capDisclosure(6)).toBe(RU_DIAL_NOTE);
    expect(freeScoreCopy.ru.capRule(6, 40, 100)).toBe(RU_RULE);
    expect(freeScoreCopy.ru.valueOfMax(39, 40)).toBe('39 из 40');
    expect(freeScoreCopy.ru.upgrade(100)).toBe(
      'Полная проверка: проверить весь сайт (оценка из 100)',
    );
  });

  it('counts the light checks in the right Russian form', () => {
    expect(freeScoreCopy.ru.capRule(1, 40, 100)).toContain(': 1 лёгкая проверка только');
    expect(freeScoreCopy.ru.capRule(3, 40, 100)).toContain(': 3 лёгкие проверки только');
    expect(freeScoreCopy.ru.capDisclosure(5)).toContain(': 5 лёгких проверок только');
  });

  it('counts the light checks in the right Ukrainian form', () => {
    expect(freeScoreCopy.uk.capRule(1, 40, 100)).toContain(': 1 легка перевірка лише');
    expect(freeScoreCopy.uk.capRule(3, 40, 100)).toContain(': 3 легкі перевірки лише');
    expect(freeScoreCopy.uk.capDisclosure(5)).toContain(': 5 легких перевірок лише');
    expect(freeScoreCopy.uk.capDisclosure(2)).toContain(': 2 легкі перевірки лише');
  });

  // Owner decision: the long statement under the dial was too much. The dial
  // note is one line with no scale and no full-audit sentence; those live in
  // the help's rule and on the button.
  it('keeps the dial note short: no scale, no full-audit sentence', () => {
    for (const language of ['en', 'uk', 'ru'] as const) {
      const note = freeScoreCopy[language].capDisclosure(6);
      expect(note).not.toMatch(
        /\b40\b|\b100\b|full audit|Повний аудит|Полный аудит|Homepage score|Оцінка головної|Оценка главной/,
      );
      expect(note.length).toBeLessThan(90);
      expect(note).toMatch(/Not everything is checked\.$|Перевірено не все\.$|Проверено не всё\.$/);
    }
  });

  // The quick-check wording replaced the "at most 40 points by design" rule: no
  // claimed loss, no ceiling, never 80, and 100 only as the full audit's scale.
  it('claims no loss or ceiling, and names 100 only as the full audit scale', () => {
    for (const language of ['en', 'uk', 'ru'] as const) {
      const t = freeScoreCopy[language];
      for (const text of [t.capDisclosure(6), t.capRule(6, 40, 100)]) {
        expect(text).toMatch(/Not everything is checked\.|Перевірено не все\.|Проверено не всё\./);
        expect(text).toMatch(/quick check|швидка перевірка|быстрая( проверка)?/i);
        expect(text).not.toMatch(
          /lost|втрач|потер|by design|за задумом|по замыслу|at most|щонайбільше|не более|\b80\b|\/ ?100/i,
        );
      }
      const rule = t.capRule(6, 40, 100);
      expect(rule.match(/\b100\b/g) ?? []).toHaveLength(1);
      expect(rule).toMatch(
        /scores it out of 100\.$|оцінює його за шкалою зі 100\.$|оценивает его по шкале из 100\.$/,
      );
    }
  });

  it('puts the full-audit promise on the call to action', () => {
    expect(freeScoreCopy.en.upgrade(100)).toBe(
      'Run the complete verification to check the whole site (scored out of 100)',
    );
    expect(freeScoreCopy.uk.upgrade(100)).toBe(
      'Повна перевірка: перевірити весь сайт (оцінка зі 100)',
    );
  });

  it('takes the check count from the stored Free row', () => {
    const modules = [
      {
        module: 'SEO',
        status: 'Completed',
        statusReason: null,
        coverage: 1,
        score: 28,
        scoreMax: 40,
        applicableChecks: 4,
        completedApplicableChecks: 4,
        usableOutput: true,
        metadata: { checks: [{}, {}, {}, {}] },
      },
    ];
    const dial = freeDialProps({ score: 28, scoreMax: 40 }, modules, 'en');
    expect(dial.note).toContain('4 light checks');
    expect(dial.scale).toEqual({ max: 40, suffix: '/ 40', valueText: '28 of 40' });
  });

  it('states the quick check without a number when the score is missing', () => {
    expect(freeDialProps({ score: null, scoreMax: 40 }, [], 'uk')).toEqual({
      label: 'Оцінка головної сторінки',
      note: freeScoreCopy.uk.capDisclosure(FREE_CHECK_COUNT),
    });
    expect(freeScoreHelp({ score: 39, scoreMax: 40 }, 6, 'en')).toBe(EN_RULE);
  });

  it('claims no Free scale for a response not on it (an older API)', () => {
    expect(freeDialProps({ score: 87.5, scoreMax: 100 }, [], 'en')).toEqual({
      label: 'Homepage score',
    });
    expect(freeScoreHelp({ score: 87.5 }, 6, 'en')).toBe(freeScoreCopy.en.homepageOnly);
  });

  it('hides the stored penalty only on Free findings', () => {
    expect(showsRulePenalty('Free')).toBe(false);
    expect(showsRulePenalty('Basic')).toBe(true);
    expect(showsRulePenalty('Complete')).toBe(true);
    expect(showsRulePenalty(undefined)).toBe(true);
  });
});

// D-237 F2: the two places that describe the Free check before it runs name
// every check it runs, and the FAQ states the score as a rule.
// Each entry is one check; a check may be named in more than one accepted way
// (the uk FAQ says "title сторінки" where the scan form says "заголовок сторінки").
const FREE_CHECK_NAMES: Readonly<Record<'en' | 'uk', readonly (readonly string[])[]>> = {
  en: [
    ['title'],
    ['heading'],
    ['meta description'],
    ['index'],
    ['Open Graph/Twitter'],
    ['image alt text'],
  ],
  uk: [
    ['title сторінки', 'заголовок сторінки'],
    ['структур'],
    ['meta description'],
    ['індекс'],
    ['Open Graph/Twitter'],
    ['alt-текст'],
  ],
};

function faqFreeAnswer(faq: unknown, start: string): string {
  const match = new RegExp(`"(${start}[^"]*)"`).exec(JSON.stringify(faq));
  if (match === null) throw new Error(`no FAQ answer starting "${start}"`);
  return match[1] ?? '';
}

describe('descriptions of the Free check', () => {
  it.each(['en', 'uk'] as const)('name every Free check (%s)', (language) => {
    expect(FREE_CHECK_NAMES[language]).toHaveLength(FREE_CHECK_COUNT);
    const note = copy[language].newScan.freeScopeNote;
    const faq =
      language === 'en'
        ? faqFreeAnswer(faqCopyEn, 'Yes, a homepage check')
        : faqFreeAnswer(faqCopyUk, 'Так, перевірка однієї головної');
    for (const names of FREE_CHECK_NAMES[language]) {
      expect(names.some((name) => note.includes(name))).toBe(true);
      expect(names.some((name) => faq.includes(name))).toBe(true);
    }
    // The uk FAQ no longer stutters "заголовок, заголовки".
    expect(faq).not.toMatch(/заголовок, заголовки/);
  });

  it('states the Free score in the FAQ as a quick check out of 40', () => {
    const en = faqFreeAnswer(faqCopyEn, 'Yes, a homepage check');
    const uk = faqFreeAnswer(faqCopyUk, 'Так, перевірка однієї головної');
    expect(en).toContain(
      'It is a quick check with a homepage score out of 40. Not everything is checked; the full audit checks the whole site and scores it out of 100.',
    );
    expect(uk).toContain(
      'Це швидка перевірка з оцінкою головної сторінки з 40. Перевірено не все; повний аудит перевіряє весь сайт і оцінює його за шкалою зі 100.',
    );
    for (const answer of [en, uk]) {
      expect(answer).not.toMatch(/by design|за задумом|up to 40|щонайбільше|\b80\b/);
    }
  });
});
