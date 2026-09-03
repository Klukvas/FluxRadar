// Consent-гейт AI-модуля (T-10, план §5): без подтверждённого согласия на
// передачу публично извлечённого контента внешним провайдерам AI-модуль
// получает Unavailable и не списывает квоту.

import { ConsentMissingError } from './errors.js';
import type { AiProviderName } from './types.js';

export interface AiConsent {
  readonly scanId: string;
  readonly providers: readonly AiProviderName[];
  readonly noticeVersion: string;
}

/**
 * Бросает ConsentMissingError, если consent отсутствует или не покрывает
 * провайдера. Соответствие consent конкретному скану проверяет вызывающий код
 * (geo-module трактует чужой scanId как отсутствие записи — §5 «несоответствие
 * записи блокирует запрос»).
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
