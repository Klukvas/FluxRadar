// What the API and the web app have to agree on about the Action Plan: the
// languages a plan can be written in, and the version of the notice shown under
// its Generate and Regenerate buttons.
//
// `apps/web` has no workspace dependencies, so it declares both a second time
// (`target-languages.ts`, `action-plan-notice.ts`). An API contract test reads
// those files and fails when either copy drifts.

import { z } from 'zod';

/**
 * ISO 639-1 codes a plan can be written in: the site-profile target-language
 * picker's list, in the picker's order.
 */
export const ACTION_PLAN_LANGUAGES = [
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
export type ActionPlanLanguage = (typeof ACTION_PLAN_LANGUAGES)[number];

export const actionPlanLanguageSchema = z.enum(ACTION_PLAN_LANGUAGES);

/** The plan language, as POST sends it in the body and GET in the query string. */
export const actionPlanLanguageInputSchema = z.object({ language: actionPlanLanguageSchema });

/**
 * The notice under the Generate and Regenerate buttons says that rule names,
 * counts and page addresses from the report are sent to Anthropic. The click is
 * the consent, and this version is stored with every plan it produced.
 *
 * It is not the pre-purchase AI processing notice and does not move with it.
 */
export const ACTION_PLAN_NOTICE_VERSION = 'action-plan-notice-v1';
