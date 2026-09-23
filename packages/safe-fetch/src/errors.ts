// Типизированные ошибки safe-fetch (T-05). Каждая ошибка — терминальный исход
// safeFetch; вызывающий код различает их через instanceof.

/** Базовый класс: `error instanceof SafeFetchError` покрывает все исходы пакета. */
export class SafeFetchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** URL не прошёл валидацию до любых сетевых действий (схема, длина, userinfo). */
export class UrlValidationError extends SafeFetchError {
  readonly url: string;

  constructor(url: string, reason: string, options?: ErrorOptions) {
    super(`safe-fetch: invalid URL "${truncateForMessage(url)}": ${reason}`, options);
    this.url = url;
  }
}

/** Хотя бы один resolved-адрес хоста непубличный — запрос не выполняется (fail-closed). */
export class SsrfBlockedError extends SafeFetchError {
  readonly url: string;
  readonly host: string;
  readonly ip: string;
  readonly reason: string;

  constructor(details: { url: string; host: string; ip: string; reason: string }) {
    super(
      `safe-fetch: blocked request to "${details.host}" — resolved address ${details.ip} is not public (${details.reason})`,
    );
    this.url = details.url;
    this.host = details.host;
    this.ip = details.ip;
    this.reason = details.reason;
  }
}

/** Redirect-переход после исчерпания лимита maxRedirects; цепочка — в ошибке. */
export class RedirectLimitError extends SafeFetchError {
  readonly maxRedirects: number;
  readonly redirectChain: ReadonlyArray<{ url: string; status: number; location: string }>;

  constructor(
    maxRedirects: number,
    redirectChain: ReadonlyArray<{ url: string; status: number; location: string }>,
  ) {
    super(`safe-fetch: redirect limit of ${maxRedirects} exceeded`);
    this.maxRedirects = maxRedirects;
    this.redirectChain = redirectChain;
  }
}

/** Общий дедлайн timeoutMs на весь запрос (включая redirect-цепочку) истёк. */
export class TimeoutError extends SafeFetchError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`safe-fetch: request timed out after ${timeoutMs} ms`);
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Запрос прерван вызывающим (options.signal) — например паузой или отменой скана.
 *
 * Отдельный тип, а не TimeoutError и не NetworkError: это не поломка цели и не
 * наш дедлайн, а решение вызывающего, и путать его с недоступностью сайта
 * нельзя — из такого «ответа» сделали бы вывод о сайте.
 */
export class RequestAbortedError extends SafeFetchError {
  readonly url: string;

  constructor(url: string) {
    super(`safe-fetch: request to "${truncateForMessage(url)}" was aborted by the caller`);
    this.url = url;
  }
}

/** DNS/соединение/чтение упали по причинам вне наших лимитов; детали в cause. */
export class NetworkError extends SafeFetchError {}

/**
 * Настройка egress-прокси нечитаема. Это ошибка конфигурации развёртывания, а
 * не сети: сообщение называет только причину. Ни сам URL, ни его длина в него
 * не попадают — в значении есть пароль, а длина пароля тоже подсказка.
 */
export class ProxyConfigError extends SafeFetchError {
  readonly reason: string;

  constructor(reason: string, options?: ErrorOptions) {
    super(`safe-fetch: unusable egress proxy setting: ${reason}`, options);
    this.reason = reason;
  }
}

function truncateForMessage(url: string): string {
  const limit = 200;
  return url.length > limit ? `${url.slice(0, limit)}…` : url;
}
