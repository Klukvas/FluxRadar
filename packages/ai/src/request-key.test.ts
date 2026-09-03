// ai_request_key (D-015): детерминированный идемпотентный ключ
// `ai:{scan_id}:{provider}:{prompt_hash}:{sequence}`.

import { describe, expect, it } from 'vitest';

import { aiRequestKey, promptHash } from './request-key.js';

describe('promptHash', () => {
  it('первые 16 hex-символов sha256, детерминированно', () => {
    const hash = promptHash('prompt text');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(promptHash('prompt text')).toBe(hash);
    expect(promptHash('prompt text!')).not.toBe(hash);
  });
});

describe('aiRequestKey', () => {
  it('следует контракту D-015', () => {
    const key = aiRequestKey('scan-1', 'openai', 'prompt text', 3);
    expect(key).toBe(`ai:scan-1:openai:${promptHash('prompt text')}:3`);
  });

  it('одинаковый вход → одинаковый ключ (retry идемпотентен)', () => {
    expect(aiRequestKey('scan-1', 'openai', 'p', 1)).toBe(aiRequestKey('scan-1', 'openai', 'p', 1));
  });

  it('scan/provider/prompt/sequence различают ключи', () => {
    const base = aiRequestKey('scan-1', 'openai', 'p', 1);
    expect(aiRequestKey('scan-2', 'openai', 'p', 1)).not.toBe(base);
    expect(aiRequestKey('scan-1', 'google', 'p', 1)).not.toBe(base);
    expect(aiRequestKey('scan-1', 'openai', 'q', 1)).not.toBe(base);
    expect(aiRequestKey('scan-1', 'openai', 'p', 2)).not.toBe(base);
  });
});
