import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { RuleFinding, SiteContext, SiteRule, SiteRuleResult } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import {
  addressKey,
  localFacts,
  observationScope,
  phoneKey,
  readable,
  record,
  referenceId,
  resolveObject,
  schemaWasRead,
  strings,
  types,
  type JsonObject,
  type LocalPageFacts,
} from '../shared/local-business.js';

const schemaDescriptor = requireDescriptor('SEO-STRUCT-003');
const reviewDescriptor = requireDescriptor('SEO-STRUCT-004');

function present(value: unknown): boolean {
  return (
    strings(value).length > 0 ||
    (Array.isArray(value) && value.some(present)) ||
    (record(value) && Object.keys(value).length > 0)
  );
}

function coordinate(value: unknown, limit: number): boolean {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return false;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit;
}

function hasGeo(business: JsonObject, facts: LocalPageFacts): boolean {
  const geo = resolveObject(business['geo'], facts.nodes, facts.page);
  return geo !== null && coordinate(geo['latitude'], 90) && coordinate(geo['longitude'], 180);
}

function hasHours(business: JsonObject, facts: LocalPageFacts): boolean {
  if (strings(business['openingHours']).length > 0) return true;
  const hours = business['openingHoursSpecification'];
  const entries = Array.isArray(hours) ? hours : [hours];
  return entries.some((value) => {
    const schedule = resolveObject(value, facts.nodes, facts.page);
    return (
      schedule !== null &&
      strings(schedule['dayOfWeek']).length > 0 &&
      strings(schedule['opens']).length > 0 &&
      strings(schedule['closes']).length > 0
    );
  });
}

function localSchemaFindings(facts: LocalPageFacts): readonly RuleFinding[] {
  const { page, businesses, nodes } = facts;
  if (!schemaWasRead(page)) return [];
  if (businesses.length === 0) {
    if (!facts.contact || !facts.visibleLocal || !readable(page)) return [];
    return [
      pageFinding(schemaDescriptor, page, {
        evidenceType: 'dom',
        evidence: findingMessage('seo-struct-003.evidence.missing', {}),
        recommendation: findingMessage('seo-struct-003.recommendation', {}),
        parameter: 'missing-local-schema',
        confidence: 0.8,
      }),
    ];
  }
  return businesses.flatMap((business, index) => {
    const address = resolveObject(business['address'], nodes, page);
    const required = [
      ...(strings(business['name']).length === 0 ? ['name'] : []),
      ...(address === null || addressKey(address, nodes, page) === ''
        ? ['address (streetAddress/addressLocality)']
        : []),
    ];
    const recommended = [
      ...(!strings(business['telephone']).some((phone) => phoneKey(phone) !== '')
        ? ['telephone']
        : []),
      ...(!hasHours(business, facts) ? ['openingHoursSpecification/openingHours'] : []),
      ...(!hasGeo(business, facts) ? ['geo (latitude/longitude)'] : []),
    ];
    if (required.length === 0 && recommended.length === 0) return [];
    const entity = strings(business['name'])[0] ?? strings(business['@id'])[0] ?? String(index + 1);
    return [
      pageFinding(schemaDescriptor, page, {
        evidenceType: 'dom',
        evidence: findingMessage('seo-struct-003.evidence.fields', {
          entity,
          types: types(business).join(', '),
          required: required.join(', ') || '—',
          recommended: recommended.join(', ') || '—',
        }),
        recommendation: findingMessage('seo-struct-003.recommendation', {}),
        parameter: referenceId(business['@id'], page) ?? `local-entity-${index}`,
        selector: 'script[type="application/ld+json"]',
      }),
    ];
  });
}

function result(ctx: SiteContext, ruleId: string): SiteRuleResult {
  const candidates = localFacts(ctx).pages.filter(
    (facts) =>
      facts.businesses.length > 0 || (facts.contact && facts.visibleLocal && readable(facts.page)),
  );
  const findings = candidates.flatMap((facts) =>
    ruleId === 'SEO-STRUCT-003' ? localSchemaFindings(facts) : reviewFindings(facts),
  );
  return {
    findings,
    applicableTargets: candidates.length,
    affectedTargets: new Set(findings.map((finding) => finding.normalizedUrl)).size,
    ...observationScope(ctx),
  };
}

export const seoStruct003LocalBusiness: SiteRule = {
  kind: 'site',
  descriptor: schemaDescriptor,
  evaluateSite: (ctx) => result(ctx, 'SEO-STRUCT-003'),
};

function reviewFindings(facts: LocalPageFacts): readonly RuleFinding[] {
  return facts.businesses.flatMap((business, index) => {
    if (!present(business['aggregateRating']) && !present(business['review'])) return [];
    // A business explicitly identifying another host may be a directory listing.
    const identity = strings(business['url'])[0] ?? strings(business['@id'])[0];
    const resolved = referenceId(identity, facts.page);
    if (resolved === null || new URL(resolved).hostname !== new URL(facts.page.finalUrl).hostname)
      return [];
    return [
      pageFinding(reviewDescriptor, facts.page, {
        evidenceType: 'dom',
        evidence: findingMessage('seo-struct-004.evidence', {
          entity: strings(business['name'])[0] ?? resolved,
        }),
        recommendation: findingMessage('seo-struct-004.recommendation', {}),
        parameter: referenceId(business['@id'], facts.page) ?? `local-entity-${index}`,
        selector: 'script[type="application/ld+json"]',
      }),
    ];
  });
}

export const seoStruct004LocalReviews: SiteRule = {
  kind: 'site',
  descriptor: reviewDescriptor,
  evaluateSite: (ctx) => result(ctx, 'SEO-STRUCT-004'),
};
