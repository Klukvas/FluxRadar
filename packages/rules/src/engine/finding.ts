// Билдеры RuleFinding: снимают boilerplate с правил и гарантируют инварианты
// D-019 (site-level → normalizedUrl = ''), §16 (обрезка evidence_excerpt) и
// §14 (поля normalized* проходят normalizeField до записи в finding — то, что
// хранится в issue record, побайтно совпадает со входом fingerprint-v1).

import type { EvidenceType, RuleDescriptor } from '@fluxradar/contracts';
import type { PageSnapshot } from '@fluxradar/crawler';
import { normalizeField, normalizeUrl } from '@fluxradar/fingerprint';

import { truncateExcerpt } from './evidence.js';
import type { ApiCheck, RuleFinding } from './types.js';
import { RULE_VARIANT_V1 } from './types.js';

interface FindingDetails {
  readonly evidenceType: EvidenceType;
  readonly evidence: string;
  readonly recommendation: string;
  readonly confidence?: number;
  readonly resource?: string;
  readonly selector?: string;
  readonly parameter?: string;
  readonly targetUnreachable?: boolean;
  readonly evidenceGroupId?: string;
}

/** Page-level finding: цель — сама страница (normalizedUrl из снимка). */
export function pageFinding(
  descriptor: RuleDescriptor,
  page: PageSnapshot,
  details: FindingDetails,
): RuleFinding {
  return buildFinding(descriptor, page.normalizedUrl, page.finalUrl, details);
}

/** Site-level finding: normalizedUrl — пустая строка по D-019. */
export function siteFinding(
  descriptor: RuleDescriptor,
  targetUrl: string,
  details: FindingDetails,
): RuleFinding {
  return buildFinding(descriptor, '', targetUrl, details);
}

/** API-level finding: цель — URL проверки (normalizeUrl v1, как у страниц). */
export function apiFinding(
  descriptor: RuleDescriptor,
  check: ApiCheck,
  details: FindingDetails,
): RuleFinding {
  return buildFinding(descriptor, normalizeUrl(check.url), check.url, details);
}

function buildFinding(
  descriptor: RuleDescriptor,
  normalizedUrl: string,
  targetUrl: string,
  details: FindingDetails,
): RuleFinding {
  const confidence = details.confidence ?? 1;
  if (confidence < 0 || confidence > 1) {
    throw new Error(
      `finding ${descriptor.ruleId}: confidence ${confidence} вне диапазона 0..1 (§14)`,
    );
  }
  return {
    ruleId: descriptor.ruleId,
    targetKind: descriptor.targetKind,
    normalizedUrl,
    normalizedResource: normalizeField(details.resource ?? ''),
    normalizedSelector: normalizeField(details.selector ?? ''),
    normalizedParameter: normalizeField(details.parameter ?? ''),
    ruleVariant: RULE_VARIANT_V1,
    targetUrl,
    evidenceType: details.evidenceType,
    evidenceExcerpt: truncateExcerpt(details.evidence),
    recommendation: details.recommendation,
    confidence,
    ...(details.targetUnreachable === true ? { targetUnreachable: true } : {}),
    ...(details.evidenceGroupId !== undefined ? { evidenceGroupId: details.evidenceGroupId } : {}),
  };
}
