// Типизированные ошибки AI/GEO-модуля (T-10). Каждая — легальная ветка контракта §5:
// вызывающий код различает их через instanceof и мапит на module status.

/** Базовый класс: `error instanceof AiModuleError` покрывает все исходы пакета. */
export class AiModuleError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Провайдер недоступен по политике (D-008: real-адаптеры без AI-001 sign-off). */
export class UnavailableError extends AiModuleError {
  readonly reason: string;

  constructor(reason: string, options?: ErrorOptions) {
    super(`ai: provider unavailable — ${reason}`, options);
    this.reason = reason;
  }
}

/**
 * The caller cancelled the run (an AbortSignal it owns fired).
 *
 * Deliberately NOT an `UnavailableError`: an unavailable provider is a legal §5
 * outcome the module may retry, while a cancelled run must stop — retrying it
 * would spend another paid provider call on an answer nobody is waiting for.
 * Adapters rethrow the signal's own reason when it is an `Error`; this class is
 * the fallback for a reason that is not one.
 */
export class AiRequestCancelledError extends AiModuleError {
  constructor(options?: ErrorOptions, message = 'ai: request cancelled by the caller') {
    super(message, options);
  }
}

/** Резерв нового ai_request_key превышает план-лимит AI-запросов (TARIFFS). */
export class QuotaExceededError extends AiModuleError {
  readonly requestKey: string;
  readonly limit: number;

  constructor(requestKey: string, limit: number) {
    super(`ai: AI request quota exhausted (limit ${limit}) — cannot reserve "${requestKey}"`);
    this.requestKey = requestKey;
    this.limit = limit;
  }
}

/** Redaction fail-closed: timeout или сбой pipeline → запрос не отправляется (§5). */
export class RedactionBlockedError extends AiModuleError {
  readonly reason: string;

  constructor(reason: string, options?: ErrorOptions) {
    super(`ai: redaction blocked (fail-closed) — ${reason}`, options);
    this.reason = reason;
  }
}

/**
 * Отмена, привязанная к конкретному скану, — то, что поднимает оркестрация
 * запроса (`runAiRequest`), когда сигнал уже сработал.
 *
 * Подтип `AiRequestCancelledError`, поэтому модули ловят одну базу и не зависят
 * от того, кто именно заметил отмену — адаптер или слой вокруг него. Причина
 * отмены попадает и в `cause`, и в текст сообщения: у отменённого прогона нет
 * результата, но есть объяснение, и терять его нельзя.
 */
export class AiRequestAbortedError extends AiRequestCancelledError {
  readonly scanId: string;

  constructor(scanId: string, reason?: unknown) {
    const detail = reason instanceof Error ? `: ${reason.message}` : '';
    super(
      reason === undefined ? undefined : { cause: reason },
      `ai: request for scan "${scanId}" was cancelled by the caller${detail}`,
    );
    this.scanId = scanId;
  }
}

/** Consent отсутствует или не покрывает провайдера — запрос блокируется (§5). */
export class ConsentMissingError extends AiModuleError {
  readonly provider: string;

  constructor(provider: string, reason: string) {
    super(`ai: consent missing for provider "${provider}" — ${reason}`);
    this.provider = provider;
  }
}
