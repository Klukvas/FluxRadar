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

/** DNS/соединение/чтение упали по причинам вне наших лимитов; детали в cause. */
export class NetworkError extends SafeFetchError {}

function truncateForMessage(url: string): string {
  const limit = 200;
  return url.length > limit ? `${url.slice(0, limit)}…` : url;
}
