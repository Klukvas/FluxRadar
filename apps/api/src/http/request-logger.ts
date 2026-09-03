// Логгер запросов: одна строка на завершённый ответ (метод, путь, статус,
// длительность). Пишет через ApiLogger — в тестах silentLogger, поэтому
// прогон supertest не шумит.

import type { RequestHandler } from 'express';

import type { ApiLogger } from './logger.ts';

export function requestLogger(logger: ApiLogger): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.info('http request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    });
    next();
  };
}
