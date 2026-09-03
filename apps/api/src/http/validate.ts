// Zod-валидация входных данных на границе HTTP: неуспех — ApiError 400
// с плоским перечнем нарушений (без внутренностей zod в ответе).

import type { z } from 'zod';

import { validationError } from './errors.ts';

const MAX_REPORTED_ISSUES = 5;

function summarize(error: z.ZodError): string {
  const parts = error.issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message));
  const rest = error.issues.length - MAX_REPORTED_ISSUES;
  return rest > 0 ? `${parts.join('; ')} (+${rest} more)` : parts.join('; ');
}

/** Парсит внешние данные схемой; ошибка → 400 VALIDATION через error-handler. */
export function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw validationError(summarize(result.error));
  }
  return result.data;
}
