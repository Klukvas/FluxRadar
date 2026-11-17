import { describe, expect, it } from 'vitest';

import { desktopCopy } from './desktop-copy';
import { FREE_CHECK_COUNT } from './free-score-copy';
import { BASIC_PRICE } from './tariff-prices';

// D-236/D-237: the dashboard's "run the free check" step describes the Free
// check as it is now — its homepage checks (FREE_CHECK_COUNT, held to the
// contract by free-score-copy.test.ts) with a homepage score, and one AI answer
// that is on by default and can be turned off on the next screen. The "Free
// check done" upsell still sells Basic, unchanged.

describe('dashboard Free check step', () => {
  it('describes the score and the optional AI answer (en)', () => {
    expect(desktopCopy.en.nextStep.bodies.noScans('legmash.com.ua')).toBe(
      `${FREE_CHECK_COUNT} checks on the homepage of legmash.com.ua — title, description, headings, indexability, social link preview and image alt text — with a homepage score. It also includes one AI answer about your business, which you can turn off on the next screen. Free, about a minute.`,
    );
  });

  it('describes the score and the optional AI answer (uk)', () => {
    expect(desktopCopy.uk.nextStep.bodies.noScans('legmash.com.ua')).toBe(
      `${FREE_CHECK_COUNT} перевірок головної сторінки legmash.com.ua — title, опис, заголовки, індексація, превʼю посилання для соцмереж і alt-текст зображень — з оцінкою головної сторінки. Перевірка також містить одну відповідь ШІ про ваш бізнес, її можна вимкнути на наступному екрані. Безкоштовно, близько хвилини.`,
    );
  });

  it('keeps the post-Free upsell on Basic and its price', () => {
    expect(desktopCopy.en.nextStep.actions.freeDone('legmash.com.ua')).toBe(
      `Check all of legmash.com.ua for ${BASIC_PRICE}`,
    );
    expect(desktopCopy.uk.nextStep.actions.freeDone('legmash.com.ua')).toBe(
      `Перевірити весь сайт legmash.com.ua за ${BASIC_PRICE}`,
    );
    expect(desktopCopy.en.nextStep.bodies.freeDone('legmash.com.ua')).toContain(
      'Basic checks every page',
    );
  });
});
