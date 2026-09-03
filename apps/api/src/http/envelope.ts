// Единый envelope всех ответов API: { success, data, error, meta? }.
// Дискриминированный union: success=true несёт data и error=null,
// success=false — data=null и машиночитаемую ошибку { code, message }.
// CSV-экспорт — единственный не-envelope ответ (файл, см. export/routes).

import type { Response } from 'express';

export interface EnvelopeMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

export interface EnvelopeError {
  readonly code: string;
  readonly message: string;
}

export type ApiResponseEnvelope<T> =
  | { readonly success: true; readonly data: T; readonly error: null; readonly meta?: EnvelopeMeta }
  | { readonly success: false; readonly data: null; readonly error: EnvelopeError };

export function okEnvelope<T>(data: T, meta?: EnvelopeMeta): ApiResponseEnvelope<T> {
  return meta === undefined
    ? { success: true, data, error: null }
    : { success: true, data, error: null, meta };
}

export function errorEnvelope(code: string, message: string): ApiResponseEnvelope<never> {
  return { success: false, data: null, error: { code, message } };
}

export interface SendOkOptions {
  readonly status?: number;
  readonly meta?: EnvelopeMeta;
}

export function sendOk<T>(res: Response, data: T, options: SendOkOptions = {}): void {
  res.status(options.status ?? 200).json(okEnvelope(data, options.meta));
}
