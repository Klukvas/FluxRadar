// The site's language from its stored profile, for the Free AI question (D-237).
//
// Defence in depth for a Free-check body that names no `language` (an older
// client, a script): the question is asked in the site's language when its
// profile names Ukrainian or English, before falling back to English. The web
// form resolves the same order itself and always sends its answer
// (apps/web/src/site-language.ts). `Accept-Language` is never read.
//
// Profiles store target languages as English names ("Ukrainian, English") but
// older free-text values may hold codes, tags ("uk-UA") or native names
// ("Українська"); each is recognised. Unsupported languages are skipped.

import type { ReportLanguage } from '@fluxradar/contracts';

const SUPPORTED: readonly ReportLanguage[] = ['uk', 'en'];

function spellingsOf(code: ReportLanguage): readonly string[] {
  const names = ['en', 'uk', code].map(
    (locale) => new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code,
  );
  return [code, ...names].map((spelling) => spelling.toLocaleLowerCase());
}

const CODE_BY_SPELLING: ReadonlyMap<string, ReportLanguage> = new Map(
  SUPPORTED.flatMap((code) => spellingsOf(code).map((spelling) => [spelling, code] as const)),
);

function codeOf(token: string): ReportLanguage | undefined {
  const lower = token.trim().toLocaleLowerCase();
  const primary = /^([a-z]{2,3})(?:[-_][a-z0-9]+)+$/.exec(lower)?.[1] ?? lower;
  return CODE_BY_SPELLING.get(primary);
}

function codesOf(value: string | null): readonly ReportLanguage[] {
  return (value ?? '').split(/[,;\n]/).flatMap((token) => {
    const code = codeOf(token);
    return code === undefined ? [] : [code];
  });
}

/**
 * The first supported language the profile's target languages name, then its
 * own `language` field; null when neither names Ukrainian or English.
 */
export function resolveSiteLanguage(profile: {
  readonly targetLanguages: string | null;
  readonly language: string | null;
}): ReportLanguage | null {
  return [...codesOf(profile.targetLanguages), ...codesOf(profile.language)][0] ?? null;
}
