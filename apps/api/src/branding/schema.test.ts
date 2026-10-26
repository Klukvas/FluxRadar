import { describe, expect, it } from 'vitest';
import { brandingSchema, contrastRatio } from './schema.ts';
const input = { enabled: true, displayName: 'Studio', accentColor: null, contactLine: null };

describe('report branding fields', () => {
  it('requires strict hex or null and stores lowercase', () => {
    expect(brandingSchema.parse({ ...input, accentColor: '#1F4FD8' }).accentColor).toBe('#1f4fd8');
    for (const accentColor of ['red', '#fff', 'red;background:url(x)', '#gg1234'])
      expect(brandingSchema.safeParse({ ...input, accentColor }).success).toBe(false);
    expect(brandingSchema.parse(input).accentColor).toBeNull();
  });
  it('uses known WCAG contrast pairs and the 3:1 boundary', () => {
    expect(contrastRatio('#000000')).toBe(21);
    expect(contrastRatio('#ffffff')).toBe(1);
    expect(contrastRatio('#ff0000')).toBeCloseTo(3.998, 2);
    expect(contrastRatio('#979797')).toBeCloseTo(2.9, 1);
    expect(brandingSchema.safeParse({ ...input, accentColor: '#979797' }).success).toBe(false);
    expect(contrastRatio('#949494')).toBeCloseTo(3.0, 1);
    expect(brandingSchema.safeParse({ ...input, accentColor: '#949494' }).success).toBe(true);
  });
  it.each([
    '\u0000',
    '\u0085',
    '\u2028',
    '\u2029',
    '\u202a',
    '\u202e',
    '\u2066',
    '\u2069',
    '\u200b',
    '\u200f',
    '\ufeff',
  ])('rejects invisible/control %s in name and contact', (bad) => {
    expect(brandingSchema.safeParse({ ...input, displayName: `a${bad}` }).success).toBe(false);
    expect(brandingSchema.safeParse({ ...input, contactLine: `a${bad}` }).success).toBe(false);
  });
  it('normalises, trims and counts code points rather than UTF16 units', () => {
    expect(
      brandingSchema.parse({ ...input, displayName: '  e\u0301 ', contactLine: '  ' }),
    ).toMatchObject({ displayName: 'é', contactLine: null });
    for (const [field, length] of [
      ['displayName', 80],
      ['contactLine', 160],
    ] as const) {
      expect(brandingSchema.safeParse({ ...input, [field]: '😀'.repeat(length) }).success).toBe(
        true,
      );
      expect(brandingSchema.safeParse({ ...input, [field]: '😀'.repeat(length + 1) }).success).toBe(
        false,
      );
    }
  });
  it('rejects unknown keys, empty names and invalid base64', () => {
    expect(brandingSchema.safeParse({ ...input, accountId: 'other' }).success).toBe(false);
    expect(brandingSchema.safeParse({ ...input, displayName: ' ' }).success).toBe(false);
    expect(brandingSchema.safeParse({ ...input, logo: 'data:image/png;base64,a' }).success).toBe(
      false,
    );
  });
});
