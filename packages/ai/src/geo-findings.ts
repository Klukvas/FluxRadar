// GeoFinding (T-10, D-171/D-176): informational-вывод GEO-правила. Форма
// зеркалит RuleFinding из packages/rules (normalized*-поля — вход fingerprint-v1,
// D-019: site/environment → normalizedUrl = ''), но живёт в packages/ai:
// вход GEO-правил — NormalizedAiResponse, а не PageSnapshot, и зависимость
// ai → crawler не нужна. Все GEO — informational: severity null (D-109),
// scoreDelta всегда 0 (§15/GEO-METHOD-005) — score не штрафуется по построению.

import { EVIDENCE_EXCERPT_MAX_CHARS } from '@fluxradar/contracts';
import type { EvidenceType, RuleDescriptor, TargetKind } from '@fluxradar/contracts';

import { AiModuleError } from './errors.js';

/** Единственный вариант GEO-правил v0.1 (симметрично RULE_VARIANT_V1 в rules). */
export const GEO_RULE_VARIANT_V1 = 'v1';

export interface GeoFinding {
  readonly ruleId: string;
  readonly targetKind: TargetKind;
  /** D-109: informational-правила не имеют severity. */
  readonly severity: null;
  /** D-109/GEO-METHOD-005: GEO никогда не уменьшает score. */
  readonly scoreDelta: 0;
  /** D-019: у site/environment-целей normalized_url — пустая строка. */
  readonly normalizedUrl: '';
  readonly normalizedResource: string;
  readonly normalizedSelector: '';
  /** `q<sequence>` — стабильный между сканами номер вопроса библиотеки (D-176). */
  readonly normalizedParameter: string;
  readonly ruleVariant: typeof GEO_RULE_VARIANT_V1;
  readonly targetUrl: string;
  readonly evidenceType: EvidenceType;
  /** Обрезан до EVIDENCE_EXCERPT_MAX_CHARS Unicode code points (§16). */
  readonly evidenceExcerpt: string;
  readonly recommendation: string;
  readonly confidence: number;
  /** Связь с ответом провайдера; в fingerprint НЕ входит (D-015). */
  readonly aiRequestKey: string | null;
}

/** Обрезка §16: лимит в Unicode code points (та же семантика, что в rules). */
export function truncateGeoExcerpt(text: string): string {
  const codePoints = [...text];
  if (codePoints.length <= EVIDENCE_EXCERPT_MAX_CHARS) return text;
  return codePoints.slice(0, EVIDENCE_EXCERPT_MAX_CHARS).join('');
}

interface GeoFindingDetails {
  readonly targetUrl: string;
  readonly evidenceType: EvidenceType;
  readonly evidence: string;
  readonly recommendation: string;
  readonly confidence?: number;
  /** Provider-имя и т.п.; значения уже в нормализованной форме (lowercase ASCII). */
  readonly resource?: string;
  readonly parameter?: string;
  readonly aiRequestKey?: string;
}

/** Билдер снимает boilerplate и держит инварианты D-019/D-109/§16 в одном месте. */
export function geoFinding(descriptor: RuleDescriptor, details: GeoFindingDetails): GeoFinding {
  const confidence = details.confidence ?? 1;
  if (confidence < 0 || confidence > 1) {
    throw new AiModuleError(
      `ai: finding ${descriptor.ruleId} — confidence ${confidence} вне диапазона 0..1 (§14)`,
    );
  }
  return {
    ruleId: descriptor.ruleId,
    targetKind: descriptor.targetKind,
    severity: null,
    scoreDelta: 0,
    normalizedUrl: '',
    normalizedResource: details.resource ?? '',
    normalizedSelector: '',
    normalizedParameter: details.parameter ?? '',
    ruleVariant: GEO_RULE_VARIANT_V1,
    targetUrl: details.targetUrl,
    evidenceType: details.evidenceType,
    evidenceExcerpt: truncateGeoExcerpt(details.evidence),
    recommendation: details.recommendation,
    confidence,
    aiRequestKey: details.aiRequestKey ?? null,
  };
}
