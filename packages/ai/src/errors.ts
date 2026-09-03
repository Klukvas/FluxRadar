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

/** Consent отсутствует или не покрывает провайдера — запрос блокируется (§5). */
export class ConsentMissingError extends AiModuleError {
  readonly provider: string;

  constructor(provider: string, reason: string) {
    super(`ai: consent missing for provider "${provider}" — ${reason}`);
    this.provider = provider;
  }
}
