import { describe, expect, it } from 'vitest';

import { FREE_CHECK_COUNT, FREE_SCORE_MAX, FULL_SCORE_MAX } from './free-score-copy';
import { copy } from './i18n';

// The pricing page's line about the free check is static copy; i18n.ts cannot
// import the free-score constants without a cycle, so this keeps it in step
// with them: the number of checks, the Free scale of 40 and the full scale of 100.

const COUNT_WORDS = { en: 'six checks', uk: 'шість перевірок' } as const;

describe('the pricing page free-check note', () => {
  it('counts the checks the free check runs', () => {
    expect(FREE_CHECK_COUNT).toBe(6);
    expect(copy.en.pricing.freeNote).toContain(COUNT_WORDS.en);
    expect(copy.uk.pricing.freeNote).toContain(COUNT_WORDS.uk);
  });

  it('lists the six checks as six separate items', () => {
    expect(copy.en.pricing.freeNote).toContain(
      'the page name Google shows, its description, its headings, whether Google may show the page, its link preview for social networks, and image alt text',
    );
    expect(copy.uk.pricing.freeNote).toContain(
      'назва, яку показує Google, опис сторінки, підзаголовки, чи дозволено Google показувати сторінку, превʼю посилання для соцмереж і alt-текст зображень',
    );
  });

  it('names the two newer checks', () => {
    expect(copy.en.pricing.freeNote).toMatch(/link preview for social networks/);
    expect(copy.en.pricing.freeNote).toMatch(/image alt text/);
    expect(copy.uk.pricing.freeNote).toMatch(/превʼю посилання для соцмереж/);
    expect(copy.uk.pricing.freeNote).toMatch(/alt-текст зображень/);
  });

  it('states the quick check, its scale of 40 and the full scale of 100', () => {
    expect(copy.en.pricing.freeNote).toContain(
      `It is a quick check with a homepage score out of ${FREE_SCORE_MAX}; not everything is checked. The full audit checks the whole site and scores it out of ${FULL_SCORE_MAX}.`,
    );
    expect(copy.uk.pricing.freeNote).toContain(
      `Це швидка перевірка з оцінкою головної сторінки з ${FREE_SCORE_MAX}; перевірено не все. Повний аудит перевіряє весь сайт і оцінює його за шкалою зі ${FULL_SCORE_MAX}.`,
    );
    for (const note of [copy.en.pricing.freeNote, copy.uk.pricing.freeNote]) {
      expect(note).not.toMatch(/by design|за задумом|up to 40|до 40|\b80\b/);
    }
  });
});
