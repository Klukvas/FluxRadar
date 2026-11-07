// The Free GEO preview's one question, in the scan's AI language (D-237: the
// owner's choice, else the site's language, else the UI language at launch).
//
// English is the paid scan's first closed-book request, byte for byte: the same
// question text, system instructions, sequence and prompt version, so a Free
// answer is the observation a paid scan would record. Ukrainian asks the same
// question in Ukrainian and adds one system line asking for a Ukrainian answer.
//
// The prompt version keeps its `-closed-book` suffix in both languages: the
// answer's purpose is read from that suffix (geo-module, geo-visibility-summary,
// geo-rules), and a language suffix would relabel the answer. The language is
// recorded in the GEO row's metadata instead.

import { brandIsHostname } from '@fluxradar/ai';
import type { AiProviderName, AiRequest, GeoAnswerLanguage } from '@fluxradar/ai';

import {
  GEO_CLOSED_BOOK_SYSTEM_INSTRUCTIONS,
  GEO_PROMPT_VERSION,
  closedBookQuestions,
} from './geo.ts';

export const UKRAINIAN_ANSWER_INSTRUCTION = 'Answer in Ukrainian.';

const UKRAINIAN_NO_GUESSING_SUFFIX =
  ' Якщо ви цього не знаєте, скажіть, що не маєте інформації, замість того щоб вгадувати.';

/** The first closed-book question in Ukrainian, chosen exactly as the English one is. */
export function ukrainianClosedBookQuestion(brand: string, siteDomain: string): string {
  return brandIsHostname(brand, siteDomain)
    ? `Що вам відомо про бізнес, повʼязаний із ${siteDomain}?${UKRAINIAN_NO_GUESSING_SUFFIX}`
    : `Що вам відомо про ${brand}?${UKRAINIAN_NO_GUESSING_SUFFIX}`;
}

function firstClosedBookQuestion(
  brand: string,
  siteDomain: string,
  language: GeoAnswerLanguage,
): string {
  if (language === 'uk') return ukrainianClosedBookQuestion(brand, siteDomain);
  const [question] = closedBookQuestions(brand, siteDomain);
  if (question === undefined) {
    throw new Error('geo: closedBookQuestions returned no question');
  }
  return question;
}

/**
 * The preview's single request: the first direct question, closed-book (no
 * search, no tools), sequence 1, to `provider`.
 *
 * Key order mirrors `buildGeoRequests`, so the English request serializes to the
 * same bytes as the paid one.
 */
export function freeGeoQuestionRequest(input: {
  readonly scanId: string;
  readonly brand: string;
  readonly siteDomain: string;
  readonly provider: AiProviderName;
  readonly language: GeoAnswerLanguage;
}): AiRequest {
  return {
    scanId: input.scanId,
    brandFacts: [],
    pageTitles: [],
    reasoningMode: 'disabled',
    provider: input.provider,
    sequence: 1,
    question: firstClosedBookQuestion(input.brand, input.siteDomain, input.language),
    systemInstructions:
      input.language === 'uk'
        ? `${GEO_CLOSED_BOOK_SYSTEM_INSTRUCTIONS} ${UKRAINIAN_ANSWER_INSTRUCTION}`
        : GEO_CLOSED_BOOK_SYSTEM_INSTRUCTIONS,
    promptVersion: `${GEO_PROMPT_VERSION}-closed-book`,
  };
}
