// Redaction pipeline v1 (T-10, план §5). Fail-closed: любое исключение или
// превышение общего deadline блокирует отправку запроса провайдеру
// (RedactionBlockedError). В audit попадают только тип и количество замен —
// исходные значения не возвращаются и не логируются.

import { RedactionBlockedError } from './errors.js';

export const REDACTION_TIMEOUT_MS = 1000;

export const REDACTION_TYPES = [
  'auth-header',
  'cookie-header',
  'jwt',
  'api-key',
  'email',
  'private-ip',
] as const;
export type RedactionType = (typeof REDACTION_TYPES)[number];

interface RedactionPattern {
  readonly type: RedactionType;
  readonly pattern: RegExp;
}

// Порядок фиксирован: сначала целые значения заголовков (внутри них живут JWT
// и ключи — считаются одной заменой заголовка), затем формы токенов, затем адреса.
const PATTERNS: readonly RedactionPattern[] = [
  { type: 'auth-header', pattern: /(?:authorization|proxy-authorization)\s*:\s*[^\r\n]+/gi },
  { type: 'cookie-header', pattern: /(?:set-cookie|cookie)\s*:\s*[^\r\n]+/gi },
  // JWT: три base64url-сегмента через точки; короткие доменные сегменты не проходят.
  { type: 'jwt', pattern: /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  // sk-…, AKIA…, ghp_… и generic 32+ hex (потенциальный секрет — fail-closed позиция).
  {
    type: 'api-key',
    pattern: /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|[A-Fa-f0-9]{32,})\b/g,
  },
  { type: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g },
  {
    type: 'private-ip',
    pattern:
      /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})\b/g,
  },
];

export interface RedactionResult {
  readonly text: string;
  /** Счётчики замен по каждому типу (нули включены) — для audit log. */
  readonly replacements: Readonly<Record<RedactionType, number>>;
}

export interface RedactionOptions {
  /** Инъектируемые часы (мс) для детерминированных тестов timeout-ветки. */
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

/** Заменяет секреты на `[REDACTED:<type>]`; fail-closed по timeout и исключениям. */
export function redact(text: string, options: RedactionOptions = {}): RedactionResult {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? REDACTION_TIMEOUT_MS;
  try {
    const startedAt = now();
    let current = text;
    const entries: Array<[RedactionType, number]> = [];
    for (const { type, pattern } of PATTERNS) {
      let count = 0;
      current = current.replace(pattern, () => {
        count += 1;
        return `[REDACTED:${type}]`;
      });
      entries.push([type, count]);
      if (now() - startedAt > timeoutMs) {
        throw new RedactionBlockedError(`pipeline exceeded ${timeoutMs} ms deadline`);
      }
    }
    return {
      text: current,
      replacements: Object.freeze(Object.fromEntries(entries)) as Record<RedactionType, number>,
    };
  } catch (error) {
    if (error instanceof RedactionBlockedError) throw error;
    throw new RedactionBlockedError('pipeline failed with an exception', { cause: error });
  }
}
