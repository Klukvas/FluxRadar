// Which language the Free AI question is asked in (D-237, owner decision).
//
// The site's own language comes first: a Ukrainian business is asked about in
// Ukrainian even when its owner reads the app in English. A site whose profile
// names no supported language (Russian, Polish, nothing at all) falls back to
// the UI language at launch. The owner's explicit choice beats both.
//
// The AI is asked only in Ukrainian or English. Russian is an interface
// language (the UI can be read in it) but not an AI language: a Russian UI
// with no supported site language preselects English, and the hint says why.

import type { Language } from './i18n';
import { parseTargetLanguages, targetLanguageCodes } from './target-languages';

/** The languages the Free AI question can be asked in (the API's `reportLanguageSchema`). */
export type AiLanguage = 'uk' | 'en';

export const AI_LANGUAGES: readonly AiLanguage[] = ['uk', 'en'];

export function isAiLanguage(code: unknown): code is AiLanguage {
  return (AI_LANGUAGES as readonly unknown[]).includes(code);
}

/** The AI language when the interface language is not one: English. */
const AI_FALLBACK_LANGUAGE: AiLanguage = 'en';

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
): AiLanguage | null {
  if (profile === null) return null;
  const codes = [...codesOf(profile.targetLanguages), ...codesOf(profile.language)];
  return codes.find(isAiLanguage) ?? null;
}

/**
 * Why the default is what it is, said by the hint under the selector: the
 * site's language, the interface language, or English because the interface
 * language (Russian) is not an AI language.
 */
export type AiLanguageSource = 'site' | 'interface' | 'fallback';

export interface AiLanguageDefault {
  readonly language: AiLanguage;
  readonly source: AiLanguageSource;
}

/** The site's language when the profile names one, else the UI language, else English. */
export function defaultAiLanguage(
  profile: Parameters<typeof resolveSiteLanguage>[0],
  interfaceLanguage: Language,
): AiLanguageDefault {
  const site = resolveSiteLanguage(profile);
  if (site !== null) return { language: site, source: 'site' };
  return isAiLanguage(interfaceLanguage)
    ? { language: interfaceLanguage, source: 'interface' }
    : { language: AI_FALLBACK_LANGUAGE, source: 'fallback' };
}

/** The language the question is asked in: the owner's choice, else the default. */
export function effectiveAiLanguage(
  choice: AiLanguage | null,
  profile: Parameters<typeof resolveSiteLanguage>[0],
  interfaceLanguage: Language,
): AiLanguage {
  return choice ?? defaultAiLanguage(profile, interfaceLanguage).language;
}
