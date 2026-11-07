// Which language the Free AI question is asked in (D-237, owner decision).
//
// The site's own language comes first: a Ukrainian business is asked about in
// Ukrainian even when its owner reads the app in English. A site whose profile
// names no supported language (Russian, Polish, nothing at all) falls back to
// the UI language at launch. The owner's explicit choice beats both.

import type { Language } from './i18n';
import { parseTargetLanguages, targetLanguageCodes } from './target-languages';

const SUPPORTED: readonly Language[] = ['uk', 'en'];

function isSupported(code: string): code is Language {
  return (SUPPORTED as readonly string[]).includes(code);
}

/** "uk-UA" or "en_GB" as its primary subtag; anything else unchanged. */
function primarySubtag(token: string): string {
  return /^([a-z]{2,3})(?:[-_][a-z0-9]+)+$/i.exec(token)?.[1]?.toLowerCase() ?? token;
}

/** The codes a stored profile value names, in its order, tags like "uk-UA" included. */
function codesOf(value: string | null | undefined): readonly string[] {
  return parseTargetLanguages(value ?? '').flatMap((name) => {
    const [code] = targetLanguageCodes(primarySubtag(name));
    return code === undefined ? [] : [code];
  });
}

/**
 * The site's language from its profile: the first supported entry of its
 * target languages, then of its own `language` field. Null when neither names
 * Ukrainian or English.
 */
export function resolveSiteLanguage(
  profile: { readonly targetLanguages?: string | null; readonly language?: string | null } | null,
): Language | null {
  if (profile === null) return null;
  const codes = [...codesOf(profile.targetLanguages), ...codesOf(profile.language)];
  return codes.find(isSupported) ?? null;
}

/** Why the default is what it is: the hint under the selector says so. */
export type AiLanguageSource = 'site' | 'interface';

export interface AiLanguageDefault {
  readonly language: Language;
  readonly source: AiLanguageSource;
}

/** The site's language when the profile names one, else the UI language at launch. */
export function defaultAiLanguage(
  profile: Parameters<typeof resolveSiteLanguage>[0],
  interfaceLanguage: Language,
): AiLanguageDefault {
  const site = resolveSiteLanguage(profile);
  return site === null
    ? { language: interfaceLanguage, source: 'interface' }
    : { language: site, source: 'site' };
}

/** The language the question is asked in: the owner's choice, else the default. */
export function effectiveAiLanguage(
  choice: Language | null,
  profile: Parameters<typeof resolveSiteLanguage>[0],
  interfaceLanguage: Language,
): Language {
  return choice ?? defaultAiLanguage(profile, interfaceLanguage).language;
}
