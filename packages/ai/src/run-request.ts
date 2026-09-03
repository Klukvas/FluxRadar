// Оркестрация одного AI-запроса (T-10, план §5): consent → prompt → redaction →
// quota reserve → provider.send → §5-валидация → quota commit. Инварианты:
// любой pre-response отказ происходит ДО обращения к провайдеру — без ответа
// и без списания квоты; ошибка провайдера освобождает резерв; retry с тем же
// ai_request_key квоту повторно не списывает (D-015).

import { ensureConsent } from './consent.js';
import type { AiConsent } from './consent.js';
import {
  AiModuleError,
  ConsentMissingError,
  QuotaExceededError,
  RedactionBlockedError,
  UnavailableError,
} from './errors.js';
import { buildPrompt, enforceInputCap } from './prompt-builder.js';
import type { AiQuotaTracker } from './quota.js';
import { redact } from './redaction.js';
import type { RedactionOptions, RedactionType } from './redaction.js';
import { aiRequestKey } from './request-key.js';
import { validateNormalizedResponse } from './response-contract.js';
import type { AiProvider, AiRequest, NormalizedAiResponse } from './types.js';

export const AI_UNAVAILABLE_REASONS = [
  'ConsentMissing',
  'RedactionBlocked',
  'QuotaExceeded',
  'ProviderUnavailable',
  'ProviderContract',
] as const;
export type AiUnavailableReason = (typeof AI_UNAVAILABLE_REASONS)[number];

/** Успешный запрос: материал будущего ai_response record (§5, T-11/T-12). */
export interface AiResponseOutcome {
  readonly kind: 'response';
  readonly request: AiRequest;
  readonly aiRequestKey: string;
  /** Точный redacted-текст, ушедший провайдеру (хранится как redacted input). */
  readonly promptText: string;
  readonly inputTruncated: boolean;
  /** Audit redaction-а: только тип и число замен, без исходных значений (§5). */
  readonly redaction: Readonly<Record<RedactionType, number>>;
  readonly response: NormalizedAiResponse;
}

/**
 * Отказ: ai_response record НЕ создаётся, квота не списана (§5 pre-response
 * ветка; provider-ошибки освобождают резерв). GEO-METHOD-005 трактует такой
 * запрос как Unavailable без штрафа score.
 */
export interface AiUnavailableOutcome {
  readonly kind: 'unavailable';
  readonly request: AiRequest;
  readonly reason: AiUnavailableReason;
  readonly detail: string;
}

export type AiRequestOutcome = AiResponseOutcome | AiUnavailableOutcome;

export interface RunAiRequestOptions {
  readonly provider: AiProvider;
  readonly quota: AiQuotaTracker;
  readonly consent: AiConsent | null;
  readonly redaction?: RedactionOptions;
}

/** Пара «итог запроса + новое состояние квоты» (трекер иммутабелен). */
export interface RunAiRequestResult {
  readonly outcome: AiRequestOutcome;
  readonly quota: AiQuotaTracker;
}

function unavailable(
  request: AiRequest,
  quota: AiQuotaTracker,
  reason: AiUnavailableReason,
  detail: string,
): RunAiRequestResult {
  return { outcome: { kind: 'unavailable', request, reason, detail }, quota };
}

export async function runAiRequest(
  request: AiRequest,
  options: RunAiRequestOptions,
): Promise<RunAiRequestResult> {
  // Consent с чужим scanId — отсутствие записи для этого скана (§5, комментарий
  // в consent.ts: несоответствие записи блокирует запрос).
  const consent =
    options.consent !== null && options.consent.scanId === request.scanId ? options.consent : null;
  try {
    ensureConsent(consent, request.provider);
  } catch (error) {
    if (error instanceof ConsentMissingError) {
      return unavailable(request, options.quota, 'ConsentMissing', error.message);
    }
    throw error;
  }

  const prompt = buildPrompt(request);
  let redacted;
  try {
    redacted = redact(prompt.promptText, options.redaction);
  } catch (error) {
    if (error instanceof RedactionBlockedError) {
      return unavailable(request, options.quota, 'RedactionBlocked', error.message);
    }
    throw error;
  }

  // Маркеры [REDACTED:<type>] длиннее заменённых значений и могут вытолкнуть
  // prompt за input cap — повторное усечение гарантирует cap для точного
  // текста, уходящего провайдеру (D-177). Секреты уже заменены: повторный срез
  // ничего не раскрывает.
  const capped = enforceInputCap(redacted.text);

  // Ключ считается от финального redacted-текста — именно он уходит провайдеру
  // (D-015/D-175).
  const requestKey = aiRequestKey(request.scanId, request.provider, capped.text, request.sequence);
  let reservedQuota;
  try {
    reservedQuota = options.quota.reserve(requestKey);
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return unavailable(request, options.quota, 'QuotaExceeded', error.message);
    }
    throw error;
  }

  let response;
  try {
    response = await options.provider.send(request, capped.text);
  } catch (error) {
    const releasedQuota = reservedQuota.release(requestKey);
    if (error instanceof UnavailableError) {
      return unavailable(request, releasedQuota, 'ProviderUnavailable', error.message);
    }
    // Прочие ошибки — баг интеграции, не легальная ветка §5: наверх с контекстом.
    throw new AiModuleError(`ai: provider send failed for "${requestKey}"`, { cause: error });
  }

  const violations = validateNormalizedResponse(response);
  if (violations.length > 0) {
    // Ответ вне контракта §5 = Unavailable адаптера, не fail-open данные (D-175).
    return unavailable(
      request,
      reservedQuota.release(requestKey),
      'ProviderContract',
      `normalized response contract violated: ${violations.join('; ')}`,
    );
  }

  return {
    outcome: {
      kind: 'response',
      request,
      aiRequestKey: requestKey,
      promptText: capped.text,
      inputTruncated: prompt.truncated || capped.truncated,
      redaction: redacted.replacements,
      response,
    },
    quota: reservedQuota.commit(requestKey),
  };
}
