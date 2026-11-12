import type { Language } from './i18n';
import { parseTargetLanguages, targetLanguageCodes } from './target-languages';

/** GEO supports all three interface languages, independently of report rendering. */
export type AiLanguage = 'uk' | 'en' | 'ru';

export const AI_LANGUAGES: readonly AiLanguage[] = ['en', 'ru', 'uk'];

export function isAiLanguage(code: unknown): code is AiLanguage {
  return (AI_LANGUAGES as readonly unknown[]).includes(code);
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
 * Legacy profile-language helper: the first EN/UK entry of its
 * target languages, then of its own `language` field. Null when neither names
 * Ukrainian or English.
 */
export function resolveSiteLanguage(
  profile: { readonly targetLanguages?: string | null; readonly language?: string | null } | null,
): AiLanguage | null {
  if (profile === null) return null;
  const codes = [...codesOf(profile.targetLanguages), ...codesOf(profile.language)];
  return codes.find((code): code is AiLanguage => code === 'uk' || code === 'en') ?? null;
}

/** Legacy source tags remain available; new defaults always use the interface. */
export type AiLanguageSource = 'site' | 'interface' | 'fallback';

export interface AiLanguageDefault {
  readonly language: AiLanguage;
  readonly source: AiLanguageSource;
}

/** Profile data never overrides the interface default for a new GEO request. */
export function defaultAiLanguage(
  profile: Parameters<typeof resolveSiteLanguage>[0],
  interfaceLanguage: Language,
): AiLanguageDefault {
  void profile;
  return { language: interfaceLanguage, source: 'interface' };
}

/** The language the question is asked in: the owner's choice, else the default. */
export function effectiveAiLanguage(
  choice: AiLanguage | null,
  profile: Parameters<typeof resolveSiteLanguage>[0],
  interfaceLanguage: Language,
): AiLanguage {
  return choice ?? defaultAiLanguage(profile, interfaceLanguage).language;
}
