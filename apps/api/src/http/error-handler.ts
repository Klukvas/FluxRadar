// Центральный error-handler: типизированные ошибки → envelope с кодом,
// всё неизвестное → 500 без stack/деталей (детали остаются в логе).
// Express 5 сам пробрасывает rejected promises async-хендлеров сюда.

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import {
  BillingError,
  BillingNotFoundError,
  BillingUnavailableError,
  FastSpringApiError,
  InvalidSignatureError,
  InvalidTransitionError,
  RefundPolicyError,
  WebhookValidationError,
} from '../billing/index.ts';
import { errorEnvelope } from './envelope.ts';
import { ApiError } from './errors.ts';
import type { ApiLogger } from './logger.ts';

/** Fallback для незнакомых маршрутов — тоже envelope, а не HTML Express-а. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(errorEnvelope('NOT_FOUND', 'route not found'));
};

/** BillingError-иерархия T-06 → HTTP-статусы; коды ошибок сохраняются как есть. */
function billingErrorStatus(error: BillingError): number {
  if (error instanceof InvalidSignatureError) return 400;
  if (error instanceof WebhookValidationError) return 400;
  if (error instanceof BillingNotFoundError) return 404;
  if (error instanceof InvalidTransitionError) return 409;
  if (error instanceof RefundPolicyError) return 409;
  if (error instanceof BillingUnavailableError) return 503;
  // The provider refused or was unreachable: this side of the call is healthy.
  if (error instanceof FastSpringApiError) return error.status === 429 ? 429 : 502;
  return 500;
}

export function errorHandler(
  logger: ApiLogger,
): (error: unknown, req: Request, res: Response, next: NextFunction) => void {
  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof ApiError) {
      res.status(error.status).json(errorEnvelope(error.code, error.message));
      return;
    }
    if (error instanceof BillingError) {
      // The detail explains how this deployment is wired — absent environment
      // variables, what the provider objected to. It belongs in the log, and
      // the response carries the neutral message and the code alone.
      if (error.detail !== null) {
        logger.error('billing request failed', {
          method: req.method,
          path: req.path,
          code: error.code,
          detail: error.detail,
        });
      }
      res.status(billingErrorStatus(error)).json(errorEnvelope(error.code, error.message));
      return;
    }
    // Неизвестная ошибка: полный контекст в лог, наружу — нейтральный ответ.
    logger.error('unhandled API error', {
      method: req.method,
      path: req.path,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json(errorEnvelope('INTERNAL', 'internal server error'));
  };
}
