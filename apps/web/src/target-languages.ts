// The languages a site profile can target, and the text the profile stores.
//
// The field was free text, so "Українська, російська" and "Ukrainian, Russian"
// asked the AI provider the same thing in different words, and a typo reached
// the prompt as written. The picker offers a fixed list and stores English
// names, the language of the prompts that read the field. A stored entry the
// list does not recognise is kept as written, so editing an older profile never
// drops what its owner typed.

import type { Language } from './i18n';

/**
 * ISO 639-1 codes, in the order the picker lists them. The Action Plan offers
 * the same list; the API declares it again as `ACTION_PLAN_LANGUAGES` in
 * `@fluxradar/contracts`, and a contract test there fails when the two drift.
 */
export const LANGUAGE_CODES = [
  'uk',
  'en',
  'ru',
  'pl',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'nl',
  'cs',
  'sk',
  'ro',
  'hu',
  'bg',
  'lt',
  'lv',
  'et',
  'fi',
  'sv',
  'no',
  'da',
  'el',
  'tr',
  'he',
  'ar',
  'hi',
  'zh',
  'ja',
  'ko',
] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];

/** Whether a code is one the picker lists — for a code read from a URL or an answer. */
export function isLanguageCode(code: unknown): code is LanguageCode {
  return (LANGUAGE_CODES as readonly unknown[]).includes(code);
}

function languageName(code: string, locale: string): string {
  return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
}

/** The stored spelling of every listed language, in picker order. */
export const TARGET_LANGUAGE_NAMES: readonly string[] = LANGUAGE_CODES.map((code) =>
  languageName(code, 'en'),
);

const CODE_BY_NAME: ReadonlyMap<string, string> = new Map(
  LANGUAGE_CODES.map((code) => [languageName(code, 'en'), code]),
);

/**
 * Every way an older free-text value may have named a listed language: its
 * code, its English and Ukrainian names, and its own name for itself.
 */
const NAME_BY_SPELLING: ReadonlyMap<string, string> = new Map(
  LANGUAGE_CODES.flatMap((code) =>
    [code, languageName(code, 'en'), languageName(code, 'uk'), languageName(code, code)].map(
      (spelling) => [spelling.toLocaleLowerCase(), languageName(code, 'en')] as const,
    ),
  ),
);

/** The stored names in a profile's value, recognised spellings normalised, duplicates dropped. */
export function parseTargetLanguages(value: string): readonly string[] {
  const names = value
    .split(/[,;\n]/)
    .map((token) => token.trim())
    .filter((token) => token !== '')
    .map((token) => NAME_BY_SPELLING.get(token.toLocaleLowerCase()) ?? token);
  return [...new Set(names)];
}

export function formatTargetLanguages(names: readonly string[]): string {
  return names.join(', ');
}

/** A listed language's code as the reader's language names it, capitalised. */
export function languageCodeLabel(code: string, language: Language): string {
  const label = languageName(code, language);
  return label.charAt(0).toLocaleUpperCase(language) + label.slice(1);
}

/** A stored name as the reader's language spells it; an unlisted entry stays as written. */
export function targetLanguageLabel(name: string, language: Language): string {
  const code = CODE_BY_NAME.get(name);
  return code === undefined ? name : languageCodeLabel(code, language);
}

/** The codes of the listed languages a profile's value names, in its order; others are skipped. */
export function targetLanguageCodes(value: string): readonly string[] {
  return parseTargetLanguages(value).flatMap((name) => {
    const code = CODE_BY_NAME.get(name);
    return code === undefined ? [] : [code];
  });
}
