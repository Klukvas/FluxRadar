// One localized closed-book question. A missing explicit choice retains the
// historical English prompt; prompt purpose/version suffixes remain unchanged.

import type { AiProviderName, AiRequest, GeoAnswerLanguage } from '@fluxradar/ai';
import {
  GEO_CLOSED_BOOK_SYSTEM_INSTRUCTIONS,
  GEO_PROMPT_VERSION,
  closedBookQuestions,
} from './geo.ts';
import { geoAnswerInstructions, localizedClosedBookQuestions } from './geo-language.ts';

export const UKRAINIAN_ANSWER_INSTRUCTION = 'Answer in Ukrainian.';

export function ukrainianClosedBookQuestion(brand: string, siteDomain: string): string {
  return localizedClosedBookQuestions(brand, siteDomain, 'uk')[0];
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
  readonly explicitLanguage?: boolean;
}): AiRequest {
  return {
    scanId: input.scanId,
    brandFacts: [],
    pageTitles: [],
    reasoningMode: 'disabled',
    provider: input.provider,
    sequence: 1,
    question: closedBookQuestions(input.brand, input.siteDomain, input.language)[0],
    systemInstructions: geoAnswerInstructions(
      GEO_CLOSED_BOOK_SYSTEM_INSTRUCTIONS,
      input.language === 'en' && input.explicitLanguage !== true ? undefined : input.language,
    ),
    promptVersion: `${GEO_PROMPT_VERSION}-closed-book`,
  };
}
