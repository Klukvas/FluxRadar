// Типизированные HTTP-ошибки API. Каждая несёт статус и машиночитаемый код —
// error-handler превращает их в envelope без потери типа; всё, что не ApiError
// и не BillingError, считается внутренней ошибкой и наружу не раскрывается.

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
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

export const rateLimited = (message: string): ApiError =>
  new ApiError(429, 'RATE_LIMITED', message);
