import type { HTMLElement } from 'node-html-parser';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { RuleFinding, SiteContext, SiteRule, SiteRuleResult } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import { hasObservedHours, telephoneValues, visibleAddresses } from '../shared/contact-signals.js';
import {
  addressKey,
  addressTextKey,
  localFacts,
  observationScope,
  phoneKey,
  readable,
  referenceId,
  resolveObject,
  strings,
  textKey,
  type LocalPageFacts,
} from '../shared/local-business.js';

const descriptor = requireDescriptor('SEO-ADV-001');

type IdentityObservation = {
  readonly facts: LocalPageFacts;
  readonly id: string;
  readonly language: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly anchorTargets: readonly string[];
  readonly address: string;
  readonly building: string | null;
  readonly phones: readonly string[];
};

function observedPhones(values: readonly string[]): readonly string[] {
  // A switchboard and its extensions are valid alternatives, not contradictions.
  return [
    ...new Set(
      values
        .map(phoneKey)
        .map((phone) => phone.split('x')[0] ?? '')
        .filter(Boolean),
    ),
  ].sort();
}

function buildingNumber(street: string): string | null {
  const numbers = street.match(/\b\d+[a-zа-яіїєґ]?\b/giu) ?? [];
  return numbers.length === 1 ? (numbers[0] ?? null) : null;
}

function schemaObservations(facts: LocalPageFacts): readonly IdentityObservation[] {
  return facts.businesses.flatMap((business) => {
    const id = referenceId(business['@id'], facts.page);
    if (id === null) return [];
    const address = resolveObject(business['address'], facts.nodes, facts.page);
    return [
      {
        facts,
        id,
        language:
          facts.root.querySelector('html')?.getAttribute('lang')?.toLowerCase().split('-')[0] ?? '',
        name: textKey(strings(business['name'])[0] ?? ''),
        aliases: [...strings(business['name']), ...strings(business['alternateName'])].map(textKey),
        anchorTargets: [facts.page.normalizedUrl],
        address: addressKey(business['address'], facts.nodes, facts.page),
        building: buildingNumber(strings(address?.['streetAddress'])[0] ?? ''),
        phones: observedPhones(strings(business['telephone'])),
      },
    ];
  });
}

function visibleObservations(facts: LocalPageFacts): readonly IdentityObservation[] {
  // Only an explicit shared entity identifier anchors visible contacts to schema.
  // A random footer on a multi-branch site is not evidence of the same location.
  return facts.root.querySelectorAll('[itemid]').flatMap((element) => {
    const id = referenceId(element.getAttribute('itemid'), facts.page);
    if (id === null) return [];
    const property = (name: string): readonly string[] =>
      element
        .querySelectorAll(`[itemprop="${name}"]`)
        .map(
          (item) => item.getAttribute('content') ?? item.getAttribute('href') ?? item.text.trim(),
        );
    const street = property('streetAddress')[0] ?? '';
    const city = property('addressLocality')[0] ?? '';
    return [
      {
        facts,
        id,
        language:
          facts.root.querySelector('html')?.getAttribute('lang')?.toLowerCase().split('-')[0] ?? '',
        name: textKey(property('name')[0] ?? ''),
        aliases: property('name').map(textKey),
        anchorTargets: [facts.page.normalizedUrl],
        address: street && city ? addressTextKey(`${street} ${city}`) : '',
        building: buildingNumber(street),
        phones: observedPhones(property('telephone')),
      },
    ];
  });
}

type IdentityIndex = ReadonlyMap<string, ReadonlyMap<string, IdentityObservation>>;

function identityIndex(observations: readonly IdentityObservation[]): IdentityIndex {
  const index = new Map<string, Map<string, IdentityObservation>>();
  for (const observation of observations) {
    if (!observation.address || !observation.language) continue;
    const key = `${observation.language}:${observation.address}`;
    const bucket = index.get(key) ?? new Map<string, IdentityObservation>();
    if (!bucket.has(observation.id)) bucket.set(observation.id, observation);
    index.set(key, bucket);
  }
  return index;
}

function anchoredRegion(
  facts: LocalPageFacts,
  region: HTMLElement,
  index: IdentityIndex,
): readonly IdentityObservation[] {
  const language =
    facts.root.querySelector('html')?.getAttribute('lang')?.toLowerCase().split('-')[0] ?? '';
  const text = textKey(region.text);
  return visibleAddresses(region, facts.contact).flatMap((address) => {
    const bucket = index.get(`${language}:${addressTextKey(address)}`);
    // A crowded shared address cannot safely identify a business from prose.
    if (bucket === undefined || bucket.size > 32) return [];
    const matches = [...bucket.values()].filter((business) =>
      business.aliases.some((name) => name !== '' && text.includes(name)),
    );
    const [match] = matches;
    if (match === undefined || matches.length !== 1) return [];
    return [{ ...match, facts, phones: observedPhones(telephoneValues(region)) }];
  });
}

function ordinaryObservations(
  facts: LocalPageFacts,
  index: IdentityIndex,
): readonly IdentityObservation[] {
  const footers = facts.root.querySelectorAll('footer, [role="contentinfo"]');
  const regions = facts.contact
    ? [
        ...footers,
        facts.root.querySelector('main') ?? facts.root.querySelector('body') ?? facts.root,
      ]
    : footers;
  return regions.flatMap((region) => anchoredRegion(facts, region, index));
}

function contactFinding(facts: LocalPageFacts): readonly RuleFinding[] {
  const { root, page } = facts;
  const hasPhone = telephoneValues(root).some((phone) => phoneKey(phone) !== '');
  const hasAddress = visibleAddresses(root, facts.contact).length > 0;
  const hasHours = hasObservedHours(root);
  const clickable = root.querySelectorAll('a[href]').some((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    return /^tel:/i.test(href) && phoneKey(href) !== '';
  });
  const checks = [
    { missing: !hasAddress, code: 'seo-adv-001.evidence.address' },
    { missing: !hasPhone, code: 'seo-adv-001.evidence.telephone' },
    { missing: !hasHours, code: 'seo-adv-001.evidence.hours' },
    { missing: hasPhone && !clickable, code: 'seo-adv-001.evidence.clickable' },
  ] as const;
  return checks
    .filter((check) => check.missing)
    .map((check) =>
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence: findingMessage(check.code, {}),
        recommendation: findingMessage('seo-adv-001.recommendation.contact', {}),
        parameter: check.code,
        confidence: 0.8,
      }),
    );
}

function differences(
  first: IdentityObservation,
  current: IdentityObservation,
): readonly RuleFinding[] {
  if (!first.language || first.language !== current.language) return [];
  const sameAddress = first.address !== '' && first.address === current.address;
  const sameName = first.aliases.some((name) => name !== '' && current.aliases.includes(name));
  const equivalentPhone = (a: string, b: string): boolean =>
    a === b ||
    (Math.min(a.length, b.length) >= 10 &&
      Math.abs(a.length - b.length) <= 3 &&
      (a.endsWith(b) || b.endsWith(a)));
  const differentPhones =
    sameAddress &&
    sameName &&
    first.phones.length > 0 &&
    current.phones.length > 0 &&
    !first.phones.some((phone) => current.phones.some((other) => equivalentPhone(phone, other)));
  const differentAddress =
    sameName &&
    first.building !== null &&
    current.building !== null &&
    first.building !== current.building;
  const alphabet = (name: string): string =>
    /\p{Script=Cyrillic}/u.test(name)
      ? 'cyrillic'
      : /\p{Script=Latin}/u.test(name)
        ? 'latin'
        : 'other';
  const differentName =
    sameAddress &&
    first.name !== '' &&
    current.name !== '' &&
    !sameName &&
    alphabet(first.name) === alphabet(current.name);
  return [
    ...(differentPhones
      ? [
          differenceFinding(
            current,
            first,
            'telephone',
            first.phones.join(', '),
            current.phones.join(', '),
          ),
        ]
      : []),
    ...(differentAddress
      ? [differenceFinding(current, first, 'address', first.address, current.address)]
      : []),
    ...(differentName ? [differenceFinding(current, first, 'name', first.name, current.name)] : []),
  ];
}

function differenceFinding(
  current: IdentityObservation,
  first: IdentityObservation,
  field: string,
  before: string,
  after: string,
): RuleFinding {
  return pageFinding(descriptor, current.facts.page, {
    evidenceType: 'dom',
    evidence: findingMessage('seo-adv-001.evidence.difference', {
      field,
      entity: current.id,
      first: before,
      second: after,
      source: first.facts.page.finalUrl,
    }),
    recommendation: findingMessage('seo-adv-001.recommendation.difference', {}),
    parameter: `${current.id}:${field}`,
    confidence: 0.8,
    dependencyTargets: [
      ...new Set([
        first.facts.page.normalizedUrl,
        ...first.anchorTargets,
        ...current.anchorTargets,
      ]),
    ].filter((url) => url !== current.facts.page.normalizedUrl),
  });
}

export const seoAdv001LocalContacts: SiteRule = {
  kind: 'site',
  descriptor,
  evaluateSite(ctx: SiteContext): SiteRuleResult {
    const crawl = localFacts(ctx);
    const schema = crawl.pages.flatMap(schemaObservations);
    const candidates = crawl.pages.filter(
      (facts) =>
        facts.businesses.length > 0 || facts.visibleLocal || (facts.contact && schema.length > 0),
    );
    const index = identityIndex(schema);
    const observations = [
      ...schema,
      ...candidates.flatMap((facts) => [
        ...visibleObservations(facts),
        ...ordinaryObservations(facts, index),
      ]),
    ];
    const firstByIdentity = new Map<string, IdentityObservation>();
    const consistency = observations.flatMap((current) => {
      const key = `${current.id}:${current.language}`;
      const first = firstByIdentity.get(key);
      if (first === undefined) {
        firstByIdentity.set(key, current);
        return [];
      }
      return differences(first, current);
    });
    const contact = crawl.complete
      ? candidates.filter((facts) => facts.contact && readable(facts.page)).flatMap(contactFinding)
      : [];
    const findings = [...contact, ...consistency];
    return {
      findings,
      applicableTargets: candidates.length,
      affectedTargets: new Set(findings.map((finding) => finding.normalizedUrl)).size,
      completedTargets: crawl.complete ? candidates.length : 0,
      ...observationScope(ctx),
    };
  },
};
