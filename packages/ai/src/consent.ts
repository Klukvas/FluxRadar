// Versioned processing-notice gate for paid AI modules. The persisted model is
// still named AiConsent for database/API compatibility, but the product now
// presents AI processing as an included part of the paid audit with a prominent
// pre-purchase disclosure, not as an optional checkbox.

import { ConsentMissingError } from './errors.js';
import type { AiProviderName } from './types.js';

export const CURRENT_AI_PROCESSING_NOTICE_VERSION = 'core-ai-processing-notice-v3';

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
