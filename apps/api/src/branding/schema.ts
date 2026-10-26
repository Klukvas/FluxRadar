import { z } from 'zod';

const forbiddenCharacters = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069\u200b-\u200f\ufeff]/u;
const plainText = (maximum: number) =>
  z
    .string()
    .refine(
      (value) => !forbiddenCharacters.test(value),
      'control and invisible characters are forbidden',
    )
    .transform((value) => value.normalize('NFC').trim())
    .refine((value) => [...value].length <= maximum, `at most ${maximum} characters`);

/** Same WCAG luminance formula used by footer-attribution.test.tsx. */
export function contrastRatio(hex: string, against = '#ffffff'): number {
  const luminance = (colour: string): number => {
    const channels = [1, 3, 5]
      .map((start) => parseInt(colour.slice(start, start + 2), 16) / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
  };
  const values = [luminance(hex), luminance(against)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

export const brandingSchema = z
  .object({
    enabled: z.boolean(),
    displayName: plainText(80).refine((value) => value.length > 0, 'name is required'),
    accentColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .transform((value) => value.toLowerCase())
      .refine((value) => contrastRatio(value) >= 3, 'accentColor: contrast with white is below 3:1')
      .nullable(),
    contactLine: plainText(160)
      .transform((value) => (value === '' ? null : value))
      .nullable(),
    logo: z
      .string()
      .max(349_528)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .nullable()
      .optional(),
  })
  .strict();
