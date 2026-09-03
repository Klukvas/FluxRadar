import { describe, expect, it } from 'vitest';

import type { FingerprintFields } from './fingerprint.js';
import { FINGERPRINT_VERSION, buildFingerprintPayload, computeFingerprint } from './fingerprint.js';
import { normalizeUrl } from './normalize-url.js';

// Golden-векторы fingerprint-v1 — дословно из FluxRadar-Feature-Plan.md §14.
// Хэши — эталон контракта: при расхождении чинится сериализация, не тест.

const BASE_FIELDS: FingerprintFields = {
  domain: 'https://example.com',
  ruleId: 'SEO-TECH-001',
  targetKind: 'page',
  normalizedUrl: '',
  normalizedResource: '',
  normalizedSelector: '',
  normalizedParameter: '',
  ruleVariant: 'v1',
};

// Payload V1: fluxradar-fp-v1 NUL 19:https://example.com NUL 12:SEO-TECH-001 NUL
// 4:page NUL 22:https://example.com/a/ NUL 0: NUL 0: NUL 0: NUL 2:v1 NUL
const V1_PAYLOAD_HEX =
  '666c757872616461722d66702d763100' + // "fluxradar-fp-v1" + 0x00
  '31393a68747470733a2f2f6578616d706c652e636f6d00' + // 19:https://example.com
  '31323a53454f2d544543482d30303100' + // 12:SEO-TECH-001
  '343a7061676500' + // 4:page
  '32323a68747470733a2f2f6578616d706c652e636f6d2f612f00' + // 22:https://example.com/a/
  '303a00303a00303a00' + // 0: 0: 0:
  '323a763100'; // 2:v1

describe('fingerprint-v1 golden vectors (план §14)', () => {
  it('V1: trailing slash /a/, пустые resource/selector/parameter, variant v1', () => {
    const normalized = normalizeUrl('https://Example.com/a/');
    expect(normalized).toBe('https://example.com/a/');
    expect(computeFingerprint({ ...BASE_FIELDS, normalizedUrl: normalized })).toBe(
      'fluxradar-fp-v1:cedea5e5a080e49706f18ac36d631a7606633029022b18dbe5a2eaaa3803f4a4',
    );
  });

  it('V2: /a без trailing slash — другой fingerprint', () => {
    const normalized = normalizeUrl('https://example.com/a');
    expect(normalized).toBe('https://example.com/a');
    expect(computeFingerprint({ ...BASE_FIELDS, normalizedUrl: normalized })).toBe(
      'fluxradar-fp-v1:ed5ae2f899ffa133946d371e58e2ca22c4a77efbb315be10255e6a9fe74364e0',
    );
  });

  it('V3: query ?b=2&utm_source=x&a=1 нормализуется в ?a=1&b=2', () => {
    const normalized = normalizeUrl('https://example.com/a/?b=2&utm_source=x&a=1');
    expect(normalized).toBe('https://example.com/a/?a=1&b=2');
    expect(computeFingerprint({ ...BASE_FIELDS, normalizedUrl: normalized })).toBe(
      'fluxradar-fp-v1:80378bf104df952b786b227fbecdf3b6f88ba8f7ce44406a82ba315f45e40c62',
    );
  });

  it('V4: selector div.hero при URL /a', () => {
    expect(
      computeFingerprint({
        ...BASE_FIELDS,
        normalizedUrl: normalizeUrl('https://example.com/a'),
        normalizedSelector: 'div.hero',
      }),
    ).toBe('fluxradar-fp-v1:e7d4e04573dc75bc51cdbf726bcfd6be752e52632193ecec1c248c903b2aa03b');
  });

  it('V5: настоящий NUL внутри selector (3 байта: a 0x00 b)', () => {
    const selector = 'a\u0000b';
    expect(Buffer.from(selector, 'utf8')).toHaveLength(3);
    expect(selector.charCodeAt(1)).toBe(0);
    expect(
      computeFingerprint({
        ...BASE_FIELDS,
        ruleId: 'SEC-PASSIVE-001',
        normalizedUrl: normalizeUrl('https://example.com/a'),
        normalizedSelector: selector,
      }),
    ).toBe('fluxradar-fp-v1:7835e6a2b09391bad2a24376f9b126794146746a7aada376a8765be87c018a92');
  });

  it('V6: literal шестибайтовый текст backslash-u-0-0-0-0 в selector', () => {
    const selector = '\\u0000';
    expect(Buffer.from(selector, 'utf8')).toHaveLength(6);
    expect(
      computeFingerprint({
        ...BASE_FIELDS,
        ruleId: 'SEC-PASSIVE-001',
        normalizedUrl: normalizeUrl('https://example.com/a'),
        normalizedSelector: selector,
      }),
    ).toBe('fluxradar-fp-v1:9b7c5ac89a9d4e51f78743f5aa0f5eb9c5e37b3a25a79e92d3b1db580b459164');
  });
});

describe('canonical payload (план §14)', () => {
  it('payload V1 совпадает с эталонным hex байт-в-байт', () => {
    const payload = buildFingerprintPayload({
      ...BASE_FIELDS,
      normalizedUrl: 'https://example.com/a/',
    });
    expect(payload.toString('hex')).toBe(V1_PAYLOAD_HEX);
    expect(payload.toString('hex').startsWith('666c757872616461722d66702d763100')).toBe(true);
  });

  it('пустое поле сериализуется как 0: + NUL', () => {
    const payload = buildFingerprintPayload({ ...BASE_FIELDS, ruleVariant: '' });
    // Хвост payload: ...0x00 + "0:" + 0x00 (пустой ruleVariant)
    expect(payload.subarray(payload.length - 3).toString('hex')).toBe('303a00');
  });

  it('length prefix считается по UTF-8 байтам до framing', () => {
    const payload = buildFingerprintPayload({ ...BASE_FIELDS, ruleVariant: 'é' });
    // 'é' — 2 байта UTF-8 → "2:" + 0xC3 0xA9 + NUL в хвосте payload
    expect(payload.subarray(payload.length - 6).toString('hex')).toBe('00323ac3a900');
  });
});

describe('формат fingerprint', () => {
  it('возвращает fluxradar-fp-v1:<64 hex lowercase>', () => {
    const fingerprint = computeFingerprint(BASE_FIELDS);
    expect(fingerprint).toMatch(/^fluxradar-fp-v1:[0-9a-f]{64}$/);
    expect(FINGERPRINT_VERSION).toBe('fluxradar-fp-v1');
  });

  it('site-level (D-019): пустой normalized_url стабилен и отличается от page-level', () => {
    const siteLevel = computeFingerprint({ ...BASE_FIELDS, targetKind: 'site' });
    expect(siteLevel).toMatch(/^fluxradar-fp-v1:[0-9a-f]{64}$/);
    expect(siteLevel).toBe(computeFingerprint({ ...BASE_FIELDS, targetKind: 'site' }));
    expect(siteLevel).not.toBe(computeFingerprint(BASE_FIELDS));
  });

  it('изменение любого поля меняет fingerprint (collision-free framing)', () => {
    const base = computeFingerprint(BASE_FIELDS);
    expect(computeFingerprint({ ...BASE_FIELDS, ruleId: 'SEO-TECH-002' })).not.toBe(base);
    expect(computeFingerprint({ ...BASE_FIELDS, normalizedParameter: 'p' })).not.toBe(base);
    expect(computeFingerprint({ ...BASE_FIELDS, ruleVariant: 'v2' })).not.toBe(base);
  });

  it('сдвиг содержимого между соседними полями не даёт коллизию', () => {
    // Без length-prefix framing пары ('ab','') и ('a','b') слились бы.
    const left = computeFingerprint({ ...BASE_FIELDS, normalizedResource: 'ab' });
    const right = computeFingerprint({
      ...BASE_FIELDS,
      normalizedResource: 'a',
      normalizedSelector: 'b',
    });
    expect(left).not.toBe(right);
  });
});
