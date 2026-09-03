// fingerprint-v1 (план §14): SHA-256 от canonical serialization восьми полей.
// Контракт заморожен golden-векторами; любое изменение — только как fingerprint-v2.

import { createHash } from 'node:crypto';

import type { TargetKind } from '@fluxradar/contracts';

export const FINGERPRINT_VERSION = 'fluxradar-fp-v1';

/**
 * Восемь полей fingerprint-v1 в терминах плана §14. Все значения уже
 * нормализованы вызывающей стороной (normalizeUrl / normalizeField);
 * для site-level issue normalizedUrl — пустая строка (D-019).
 */
export interface FingerprintFields {
  readonly domain: string;
  readonly ruleId: string;
  readonly targetKind: TargetKind;
  readonly normalizedUrl: string;
  readonly normalizedResource: string;
  readonly normalizedSelector: string;
  readonly normalizedParameter: string;
  readonly ruleVariant: string;
}

/** Порядок сериализации зафиксирован планом §14 — менять нельзя. */
const FIELD_ORDER = [
  'domain',
  'ruleId',
  'targetKind',
  'normalizedUrl',
  'normalizedResource',
  'normalizedSelector',
  'normalizedParameter',
  'ruleVariant',
] as const satisfies readonly (keyof FingerprintFields)[];

const NUL_BYTE = Buffer.from([0x00]);

/**
 * Canonical payload: `UTF8("fluxradar-fp-v1") + 0x00`, затем для каждого поля
 * `ASCII(decimal byte_length) + ":" + UTF8(field) + 0x00`. Length prefix
 * считается по UTF-8 байтам поля до framing; пустое поле — `0:`. Literal NUL
 * и backslash внутри значения не экранируются — граница задаётся длиной.
 */
export function buildFingerprintPayload(fields: FingerprintFields): Buffer {
  const parts: Buffer[] = [Buffer.from(FINGERPRINT_VERSION, 'utf8'), NUL_BYTE];
  for (const key of FIELD_ORDER) {
    const valueBytes = Buffer.from(fields[key], 'utf8');
    parts.push(Buffer.from(`${valueBytes.length}:`, 'ascii'), valueBytes, NUL_BYTE);
  }
  return Buffer.concat(parts);
}

/** Хранимое значение fingerprint: `fluxradar-fp-v1:<sha256 lowercase hex>`. */
export function computeFingerprint(fields: FingerprintFields): string {
  const digest = createHash('sha256').update(buildFingerprintPayload(fields)).digest('hex');
  return `${FINGERPRINT_VERSION}:${digest}`;
}
