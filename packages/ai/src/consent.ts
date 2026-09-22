// Versioned processing-notice gate for paid AI modules. The persisted model is
// still named AiConsent for database/API compatibility, but the product now
// presents AI processing as an included part of the paid audit with a prominent
// pre-purchase disclosure, not as an optional checkbox.

import { ConsentMissingError } from './errors.js';
import type { AiProviderName } from './types.js';

export const CURRENT_AI_PROCESSING_NOTICE_VERSION = 'core-ai-processing-notice-v4';

/**
 * Notice versions a scan may still be processed under.
 *
 * A scan bought under v3 keeps its 30-day entitlement, and a retry inside it
 * must not lose the whole GEO module over a notice the customer could not have
 * seen. Such a record lists only `anthropic`, so its OpenAI questions come back
 * ConsentMissing and the module reports Partial — v3 customers get what they
 * agreed to and nothing more. Web search does not change what they agreed to
 * send: the questions are unchanged.
 *
 * Remove 'core-ai-processing-notice-v3' on 2026-10-22, 30 days after the
 * release that introduced v4, when the last v3 entitlement has expired.
 */
export const ACCEPTED_AI_PROCESSING_NOTICE_VERSIONS: readonly string[] = [
  'core-ai-processing-notice-v3',
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
];

export function isAcceptedAiProcessingNoticeVersion(version: string): boolean {
  return ACCEPTED_AI_PROCESSING_NOTICE_VERSIONS.includes(version);
}

export interface AiConsent {
  readonly scanId: string;
  readonly providers: readonly AiProviderName[];
  readonly noticeVersion: string;
}

/**
 * Throws when the persisted processing record is absent or does not cover the
 * provider. The caller verifies that the record belongs to this scan.
 */
export function ensureConsent(consent: AiConsent | null, provider: AiProviderName): void {
  if (consent === null) {
    throw new ConsentMissingError(provider, 'no consent record for this scan');
  }
  if (!consent.providers.includes(provider)) {
    throw new ConsentMissingError(
      provider,
      `consent (notice ${consent.noticeVersion}) does not cover this provider`,
    );
  }
}
