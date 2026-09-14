// The merged finding-message catalog, and the typed way a rule refers to it.
//
// `findingMessage` only accepts a code that exists and exactly the values its
// English template names, so a typo in a code or a forgotten value is a compile
// error in the rule rather than a blank sentence in a customer's report.

import { truncateExcerpt } from '../engine/evidence.js';
import { ACCESSIBILITY_MESSAGES } from './accessibility.js';
import {
  renderTemplate,
  type FindingLanguage,
  type FindingMessageCatalog,
  type FindingMessageParamValue,
  type FindingMessageRef,
} from './catalog.js';
import { CONTENT_MESSAGES } from './content.js';
import { PRIVACY_MESSAGES } from './privacy.js';
import { RELIABILITY_MESSAGES } from './reliability.js';
import { SECURITY_MESSAGES } from './security.js';
import { SEO_MESSAGES } from './seo.js';
import { UX_MESSAGES } from './ux.js';

export {
  FINDING_LANGUAGES,
  placeholdersOf,
  renderTemplate,
  type FindingLanguage,
  type FindingMessageCatalog,
  type FindingMessageParamValue,
  type FindingMessageRef,
  type FindingMessageTemplate,
  type FindingMessages,
} from './catalog.js';

/** Each module's catalog on its own, so a test can prove no two share a code. */
export const MODULE_MESSAGE_CATALOGS: readonly FindingMessageCatalog[] = [
  SEO_MESSAGES,
  SECURITY_MESSAGES,
  RELIABILITY_MESSAGES,
  ACCESSIBILITY_MESSAGES,
  CONTENT_MESSAGES,
  PRIVACY_MESSAGES,
  UX_MESSAGES,
];

export const FINDING_MESSAGES = {
  ...SEO_MESSAGES,
  ...SECURITY_MESSAGES,
  ...RELIABILITY_MESSAGES,
  ...ACCESSIBILITY_MESSAGES,
  ...CONTENT_MESSAGES,
  ...PRIVACY_MESSAGES,
  ...UX_MESSAGES,
} as const;

export type FindingMessageCode = keyof typeof FINDING_MESSAGES;

type Placeholders<Template extends string> =
  Template extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholders<Rest> : never;

export type FindingMessageParams<Code extends FindingMessageCode> = Readonly<
  Record<Placeholders<(typeof FINDING_MESSAGES)[Code]['en']>, FindingMessageParamValue>
>;

declare const catalogued: unique symbol;

/**
 * A message reference that came out of `findingMessage`: its code exists, its
 * values are complete and bounded. The brand exists only in types, so a
 * hand-built `{ code, params }` cannot be passed where a finding needs one — a
 * rule cannot skip the checks `findingMessage` is there to make.
 */
export type CataloguedFindingMessage = FindingMessageRef & { readonly [catalogued]: true };

/**
 * A message reference for a finding.
 *
 * String values are bounded to the evidence-excerpt limit: they are stored with
 * the issue, and an unbounded page outline or header value would otherwise be
 * the one part of a finding with no size limit.
 */
export function findingMessage<Code extends FindingMessageCode>(
  code: Code,
  params: FindingMessageParams<Code>,
): CataloguedFindingMessage {
  const values = params as Readonly<Record<string, FindingMessageParamValue>>;
  const message: FindingMessageRef = {
    code,
    params: Object.fromEntries(
      Object.entries(values).map(([name, value]) => [
        name,
        typeof value === 'string' ? truncateExcerpt(value) : value,
      ]),
    ),
  };
  return message as CataloguedFindingMessage;
}

/** The message in one language, or null for a code this build does not know. */
export function renderFindingMessage(
  ref: FindingMessageRef,
  language: FindingLanguage,
): string | null {
  const template = (FINDING_MESSAGES as FindingMessageCatalog)[ref.code];
  return template === undefined ? null : renderTemplate(template[language], ref.params);
}
