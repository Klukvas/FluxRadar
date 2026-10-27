import { apiRequest } from './api';

export type BrandingView = Readonly<{
  enabled: boolean;
  displayName: string;
  accentColor: string | null;
  contactLine: string | null;
  logo: Readonly<{ dataUrl: string; width: number; height: number; byteLength: number }> | null;
  updatedAt: string;
}>;
export type BrandingInput = Omit<BrandingView, 'logo' | 'updatedAt'> & {
  readonly logo?: string | null;
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export function readBrandingView(value: unknown): BrandingView | null | 'invalid' {
  if (value === null) return null;
  if (
    !record(value) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.displayName !== 'string' ||
    value.displayName.trim() === ''
  )
    return 'invalid';
  if (!(
    value.accentColor === null ||
    (typeof value.accentColor === 'string' && /^#[0-9a-f]{6}$/.test(value.accentColor))
  ))
    return 'invalid';
  if (
    !(value.contactLine === null || typeof value.contactLine === 'string') ||
    typeof value.updatedAt !== 'string'
  )
    return 'invalid';
  const logo = value.logo;
  if (
    logo !== null &&
    (!record(logo) ||
      typeof logo.dataUrl !== 'string' ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(logo.dataUrl) ||
      typeof logo.width !== 'number' ||
      !Number.isFinite(logo.width) ||
      logo.width <= 0 ||
      typeof logo.height !== 'number' ||
      !Number.isFinite(logo.height) ||
      logo.height <= 0 ||
      typeof logo.byteLength !== 'number')
  )
    return 'invalid';
  return value as BrandingView;
}

export async function fetchBranding(): Promise<BrandingView | null | 'invalid'> {
  return readBrandingView(await apiRequest<unknown>('/account/branding'));
}

export async function saveBranding(input: BrandingInput): Promise<BrandingView> {
  const result = readBrandingView(
    await apiRequest<unknown>('/account/branding', { method: 'PUT', body: JSON.stringify(input) }),
  );
  if (result === null || result === 'invalid') throw new Error('Invalid branding response');
  return result;
}

export async function deleteBranding(): Promise<void> {
  await apiRequest('/account/branding', { method: 'DELETE' });
}

/** Mirrors the API's WCAG contrast calculation; the API remains authoritative. */
export function brandingContrast(hex: string): number {
  const linear = [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  const luminance =
    (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
  return 1.05 / (luminance + 0.05);
}

export type BrandingField = 'displayName' | 'accentColor' | 'contactLine' | 'logo';
export type BrandingFieldErrors = Partial<Record<BrandingField, string>>;
const hiddenCharacters = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069\u200b-\u200f\ufeff]/u;

/** Mirrors the API boundary for immediate field feedback; the server validates again. */
export function invalidBrandingFields(input: BrandingInput): readonly BrandingField[] {
  const name = input.displayName.normalize('NFC').trim();
  const contact = input.contactLine?.normalize('NFC').trim() ?? '';
  return [
    ...(name.length === 0 || [...name].length > 80 || hiddenCharacters.test(input.displayName)
      ? ['displayName' as const]
      : []),
    ...(input.accentColor !== null &&
    (!/^#[0-9a-f]{6}$/i.test(input.accentColor) || brandingContrast(input.accentColor) < 3)
      ? ['accentColor' as const]
      : []),
    ...([...contact].length > 160 || hiddenCharacters.test(input.contactLine ?? '')
      ? ['contactLine' as const]
      : []),
  ];
}
