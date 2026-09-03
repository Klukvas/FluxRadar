// Идемпотентный ключ AI-запроса (D-015, план §18 ambiguous-timeout contract).
// Ключ детерминирован: retry того же запроса получает тот же ключ и не
// списывает квоту повторно; в fingerprint issue он не входит.

import { createHash } from 'node:crypto';

import type { AiProviderName } from './types.js';

/** Первые 16 hex-символов sha256 от точного текста prompt-а, ушедшего провайдеру. */
export function promptHash(promptText: string): string {
  return createHash('sha256').update(promptText, 'utf8').digest('hex').slice(0, 16);
}

/** `ai:{scan_id}:{provider}:{prompt_hash}:{sequence}` — контракт D-015. */
export function aiRequestKey(
  scanId: string,
  provider: AiProviderName,
  promptText: string,
  sequence: number,
): string {
  return `ai:${scanId}:${provider}:${promptHash(promptText)}:${sequence}`;
}
