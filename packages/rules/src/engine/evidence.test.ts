import { EVIDENCE_EXCERPT_MAX_CHARS } from '@fluxradar/contracts';
import { describe, expect, it } from 'vitest';

import { truncateExcerpt } from './evidence.js';

describe('truncateExcerpt (§16)', () => {
  it('короткий текст возвращается без изменений', () => {
    expect(truncateExcerpt('коротко')).toBe('коротко');
  });

  it('обрезает до 2048 Unicode code points, а не UTF-16 units', () => {
    // Астральные символы: 1 code point = 2 UTF-16 units — обрезка по units
    // дала бы вдвое меньше символов и порванный суррогат на границе.
    const excerpt = truncateExcerpt('😀'.repeat(EVIDENCE_EXCERPT_MAX_CHARS + 500));
    expect([...excerpt]).toHaveLength(EVIDENCE_EXCERPT_MAX_CHARS);
    expect(excerpt.endsWith('😀')).toBe(true);
  });

  it('текст ровно в лимит не обрезается', () => {
    const text = 'a'.repeat(EVIDENCE_EXCERPT_MAX_CHARS);
    expect(truncateExcerpt(text)).toBe(text);
  });
});
