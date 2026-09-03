// Auth-middleware: превращает сессионную куку в res.locals.accountId.
// Tenant isolation (D-011): каждый защищённый маршрут обязан скоупить
// запросы к БД этим accountId; чужие сущности отвечают 404, не раскрывая
// сам факт их существования.

import type { RequestHandler, Response } from 'express';
import type { PrismaClient } from '@prisma/client';

import { readCookie } from '../http/cookies.ts';
import { unauthorized } from '../http/errors.ts';
import { SESSION_COOKIE_NAME, findSessionAccountId } from './sessions.ts';

export function requireAuth(prisma: PrismaClient, now: () => Date): RequestHandler {
  return async (req, res, next) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
    if (token === null) {
      next(unauthorized());
      return;
    }
    const accountId = await findSessionAccountId(prisma, token, now());
    if (accountId === null) {
      next(unauthorized('session is invalid or expired'));
      return;
    }
    res.locals['accountId'] = accountId;
    next();
  };
}

/** Типобезопасный доступ к accountId; вызов вне requireAuth — баг маршрута. */
export function accountIdFrom(res: Response): string {
  const accountId = res.locals['accountId'];
  if (typeof accountId !== 'string' || accountId === '') {
    throw new Error('accountIdFrom called on a route without requireAuth');
  }
  return accountId;
}
