// Evidence and recommendation text for findings, in every language a report is
// read in.
//
// A rule used to hand its finding a finished Russian sentence, and the Issue
// Center showed that sentence unchanged to English and Ukrainian readers alike.
// A rule now hands over a message code and the values that go into it; the
// sentence is written once per language in the module catalogs next to this
// file and rendered for whoever reads the report.
//
// Codes read `<rule id in lower case>.<evidence|recommendation>[.<variant>]`, so
// one module's codes can never collide with another's.

export const FINDING_LANGUAGES = ['en', 'uk'] as const;
export type FindingLanguage = (typeof FINDING_LANGUAGES)[number];

export interface FindingMessageTemplate {
  readonly en: string;
  readonly uk: string;
}

export type FindingMessageCatalog = Readonly<Record<string, FindingMessageTemplate>>;

export type FindingMessageParamValue = string | number;

/** A message as stored with a finding: which sentence, and the values it needs. */
export interface FindingMessageRef {
  readonly code: string;
  readonly params: Readonly<Record<string, FindingMessageParamValue>>;
}

export interface FindingMessages {
  readonly evidence: FindingMessageRef;
  readonly recommendation: FindingMessageRef;
}

/** `{name}` — a letter first, so literal braces in copy stay text rather than a lookup. */
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

export function placeholdersOf(template: string): readonly string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ''))];
}

/**
 * The template with its values filled in, or null when a value is missing.
 *
 * Null rather than a sentence with a hole in it: the caller has the English
 * text stored with the finding to fall back on, which is better than
 * "Pages with issues: {affected}".
 */
export function renderTemplate(
  template: string,
  params: FindingMessageRef['params'],
): string | null {
  if (placeholdersOf(template).some((name) => params[name] === undefined)) {
    return null;
  }
  return template.replace(PLACEHOLDER, (_match, name: string) => String(params[name]));
}
