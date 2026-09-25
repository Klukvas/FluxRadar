// Идемпотентный ключ AI-запроса (D-015, план §18 ambiguous-timeout contract).
// Ключ детерминирован: retry того же запроса получает тот же ключ и не
// списывает квоту повторно; в fingerprint issue он не входит.

import { createHash } from 'node:crypto';

import type { AiProviderName } from './types.js';

/** Первые 16 hex-символов sha256 от точного текста prompt-а, ушедшего провайдеру. */
export function promptHash(promptText: string): string {
  return createHash('sha256').update(promptText, 'utf8').digest('hex').slice(0, 16);
}

/**
 * `ai:{scan_id}:{provider}:{prompt_hash}:{sequence}` — контракт D-015.
 *
 * `keyIdentity` is what this request is *about*, when the prompt alone does not
 * say it: it is folded into the hash and never sent to the provider. Two GEO
 * judge requests are the case that needs it — the same rubric, the same
 * question and the same answer text, one per provider, with the sequence
 * restarting at 1 per provider. Without an identity they hash to one key, share
 * one quota reservation and leave one `ai_response` row for two paid exchanges.
 *
 * Omitting it keeps the key exactly what it was, so no existing key moves.
 */
export function aiRequestKey(
  scanId: string,
  provider: AiProviderName,
  promptText: string,
  sequence: number,
  keyIdentity?: string,
): string {
  const payload = keyIdentity === undefined ? promptText : `${keyIdentity}\n\n${promptText}`;
  return `ai:${scanId}:${provider}:${promptHash(payload)}:${sequence}`;
}
