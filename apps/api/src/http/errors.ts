// Типизированные HTTP-ошибки API. Каждая несёт статус и машиночитаемый код —
// error-handler превращает их в envelope без потери типа; всё, что не ApiError
// и не BillingError, считается внутренней ошибкой и наружу не раскрывается.

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /**
   * Сколько секунд клиенту ждать перед повтором. Не часть тела ответа —
   * error-handler отдаёт это заголовком Retry-After, как того требует RFC 9110
   * для 429. Null для ошибок, у которых повтор ничего не изменит.
   */
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const validationError = (message: string): ApiError =>
  new ApiError(400, 'VALIDATION', message);

export const unauthorized = (message = 'authentication required'): ApiError =>
  new ApiError(401, 'UNAUTHORIZED', message);

export const forbidden = (code: string, message: string): ApiError =>
  new ApiError(403, code, message);

export const notFound = (message = 'resource not found'): ApiError =>
  new ApiError(404, 'NOT_FOUND', message);

export const gone = (code: string, message: string): ApiError =>
  new ApiError(410, code, message);

export const conflict = (code: string, message: string): ApiError =>
  new ApiError(409, code, message);

export const paymentRequired = (message: string): ApiError =>
  new ApiError(402, 'PAYMENT_REQUIRED', message);

export const rateLimited = (message: string, retryAfterSeconds = 60): ApiError =>
  new ApiError(429, 'RATE_LIMITED', message, Math.max(1, Math.ceil(retryAfterSeconds)));
