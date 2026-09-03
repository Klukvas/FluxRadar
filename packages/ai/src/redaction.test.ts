// Redaction v1 (T-10, §5): все типы паттернов, audit только счётчиками,
// fail-closed по timeout (инъектируемые часы) и по исключению.

import { describe, expect, it } from 'vitest';

import { RedactionBlockedError } from './errors.js';
import { redact, REDACTION_TYPES } from './redaction.js';

describe('redact — типы паттернов', () => {
  it('вырезает Authorization-заголовок целиком', () => {
    const result = redact('Authorization: Bearer super-secret-token-value\nnext line');
    expect(result.text).toContain('[REDACTED:auth-header]');
    expect(result.text).not.toContain('super-secret-token-value');
    expect(result.replacements['auth-header']).toBe(1);
  });

  it('вырезает Cookie/Set-Cookie заголовки', () => {
    const result = redact('Set-Cookie: session=deadbeefcafe; HttpOnly\nCookie: sid=12ab34cd');
    expect(result.replacements['cookie-header']).toBe(2);
    expect(result.text).not.toContain('deadbeefcafe');
  });

  it('вырезает JWT из трёх base64url-сегментов', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ';
    const result = redact(`token: ${jwt}`);
    expect(result.text).toBe('token: [REDACTED:jwt]');
    expect(result.replacements.jwt).toBe(1);
  });

  it('вырезает API-ключи: sk-, AKIA, ghp_ и 32+ hex', () => {
    const text = [
      'sk-abcdefghijklmnop1234',
      'AKIAABCDEFGHIJKLMNOP',
      `ghp_${'a1'.repeat(18)}`,
      'f'.repeat(32),
    ].join(' ');
    const result = redact(text);
    expect(result.replacements['api-key']).toBe(4);
    expect(result.text).toBe(Array(4).fill('[REDACTED:api-key]').join(' '));
  });

  it('вырезает email-адреса', () => {
    const result = redact('contact: owner@example.com, sales@sub.example.co.uk');
    expect(result.replacements.email).toBe(2);
    expect(result.text).not.toContain('example.com');
  });

  it('вырезает приватные/loopback/metadata IPv4-адреса', () => {
    const text = '10.0.0.5 192.168.1.1 172.16.0.1 127.0.0.1 169.254.169.254';
    const result = redact(text);
    expect(result.replacements['private-ip']).toBe(5);
    expect(result.text).toBe(Array(5).fill('[REDACTED:private-ip]').join(' '));
  });

  it('audit содержит счётчики всех типов, включая нулевые', () => {
    const result = redact('nothing secret here');
    expect(Object.keys(result.replacements).sort()).toEqual([...REDACTION_TYPES].sort());
    for (const type of REDACTION_TYPES) {
      expect(result.replacements[type]).toBe(0);
    }
  });

  it('чистый текст возвращается без изменений', () => {
    const text = 'Ответ провайдера про аудит сайтов без секретов.';
    expect(redact(text).text).toBe(text);
  });
});

describe('redact — fail-closed', () => {
  it('превышение deadline по инъектируемым часам блокирует запрос', () => {
    // Первый вызов — startedAt, второй (после первого паттерна) — за deadline.
    let calls = 0;
    const now = (): number => (calls++ === 0 ? 0 : 10_000);
    expect(() => redact('any text', { now })).toThrow(RedactionBlockedError);
  });

  it('кастомный timeoutMs учитывается', () => {
    let tick = 0;
    const now = (): number => (tick += 3);
    expect(() => redact('any text', { now, timeoutMs: 2 })).toThrow(RedactionBlockedError);
  });

  it('исключение внутри pipeline превращается в RedactionBlockedError с cause', () => {
    const now = (): number => {
      throw new Error('clock exploded');
    };
    let caught: unknown;
    try {
      redact('any text', { now });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RedactionBlockedError);
    expect((caught as RedactionBlockedError).cause).toBeInstanceOf(Error);
  });
});
