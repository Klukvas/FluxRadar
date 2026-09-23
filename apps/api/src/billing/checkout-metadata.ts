import { ACCEPTED_AI_PROCESSING_NOTICE_VERSIONS, AI_PROVIDER_NAMES } from '@fluxradar/ai';
import { z } from 'zod';

import { enumValues } from '../http/validate.ts';

// What a paid checkout carries besides the plan: the crawl scope of the request
// and the versioned AI-processing notice shown before purchase. Both are
// captured server-side when checkout starts and are applied atomically with the
// Scan the payment creates — they are never read back from a provider payload.

export const aiConsentSchema = z.object({
  providers: z.array(z.enum(AI_PROVIDER_NAMES)).min(1),
  /**
   * The notice the buyer was shown, checked against the list this release
   * publishes rather than taken on the browser's word. The stored record is an
   * authorisation to send a customer's pages to a named company, and a version
   * string nobody ever published authorises nothing — accepting one would make
   * the record unauditable exactly when it matters.
   */
  noticeVersion: z.enum(enumValues(ACCEPTED_AI_PROCESSING_NOTICE_VERSIONS, 'ai processing notice')),
});
export type AiConsentInput = z.infer<typeof aiConsentSchema>;
