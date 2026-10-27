// Shared observations are cached once per immutable crawl/snapshot. Never infer
// a clinic from a keyword in a news article or compare unrelated branch contacts.
import { parseHtml, type CrawlResult, type PageSnapshot } from '@fluxradar/crawler';
import type { HTMLElement } from 'node-html-parser';

import { visibleText } from '../content/visible-text.js';
import type { SiteContext } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { leftCrawlScope } from '../seo/crawl-scope.js';
import { parsePage } from '../seo/dom.js';
import { linkGraphGap } from '../seo/link-graph-gap.js';
import { validJsonLdObjects } from '../seo/structured-data.js';
import { telephoneValues, visibleAddresses } from './contact-signals.js';

export type JsonObject = Readonly<Record<string, unknown>>;
export const MEDICAL_TYPES = new Set([
  'Dentist',
  'MedicalBusiness',
  'MedicalClinic',
  'Hospital',
  'Physician',
  'DiagnosticLab',
  'Pharmacy',
  'Optician',
  'Nursing',
]);
const LOCAL_TYPES = new Set([
  'LocalBusiness',
  ...MEDICAL_TYPES,
  'Store',
  'Restaurant',
  'CafeOrCoffeeShop',
  'Hotel',
  'LodgingBusiness',
  'ProfessionalService',
  'LegalService',
  'HealthAndBeautyBusiness',
  'AutomotiveBusiness',
  'RealEstateAgent',
  'SportsActivityLocation',
  'EntertainmentBusiness',
  'FoodEstablishment',
  'AutoRepair',
  'BeautySalon',
  'HairSalon',
  'Bakery',
  'DaySpa',
  'DryCleaningOrLaundry',
  'TravelAgency',
  'HomeAndConstructionBusiness',
  'Electrician',
  'Plumber',
  'RoofingContractor',
]);

export function record(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function strings(value: unknown): readonly string[] {
  if (typeof value === 'string') return value.trim() === '' ? [] : [value.trim()];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (record(value) && typeof value['@value'] === 'string') return strings(value['@value']);
  return [];
}

export function types(node: JsonObject): readonly string[] {
  return strings(node['@type']).map((type) => type.replace(/^https?:\/\/schema\.org\//i, ''));
}

export function isLocal(node: JsonObject): boolean {
  return types(node).some((type) => LOCAL_TYPES.has(type));
}

export function isMedical(node: JsonObject): boolean {
  return types(node).some((type) => MEDICAL_TYPES.has(type));
}

const nodeCache = new WeakMap<PageSnapshot, readonly JsonObject[]>();
const incompleteSchema = new WeakSet<PageSnapshot>();
const MAX_SCHEMA_NODES = 20_000;
const MAX_SCHEMA_DEPTH = 128;

/** Bounded iterative view; adversarial depth must not abort an entire scan. */
export function schemaNodes(page: PageSnapshot): readonly JsonObject[] {
  const cached = nodeCache.get(page);
  if (cached !== undefined) return cached;
  const pending = validJsonLdObjects(page).map((value) => ({ value: value as unknown, depth: 0 }));
  const nodes: JsonObject[] = [];
  let visited = 0;
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined) break;
    visited += 1;
    if (next.depth > MAX_SCHEMA_DEPTH || visited > MAX_SCHEMA_NODES) {
      incompleteSchema.add(page);
      nodeCache.set(page, []);
      return [];
    }
    if (record(next.value)) nodes.push(next.value);
    const children = Array.isArray(next.value)
      ? next.value
      : record(next.value)
        ? Object.values(next.value)
        : [];
    for (const child of children) {
      if (typeof child === 'object' && child !== null)
        pending.push({ value: child, depth: next.depth + 1 });
    }
  }
  nodeCache.set(page, nodes);
  return nodes;
}

export function schemaWasRead(page: PageSnapshot): boolean {
  schemaNodes(page);
  return !incompleteSchema.has(page);
}

function pointsToCurrentPage(value: unknown, page: PageSnapshot): boolean {
  const raw = record(value) ? (value['url'] ?? value['@id']) : value;
  const resolved = referenceId(raw, page);
  if (resolved === null) return false;
  const target = new URL(resolved);
  const current = new URL(page.finalUrl);
  return target.origin === current.origin && target.pathname === current.pathname;
}

/** Include explicit primary-page relations, never arbitrary nested related items. */
export function primarySchemaNodes(page: PageSnapshot): readonly JsonObject[] {
  if (!schemaWasRead(page)) return [];
  const roots = validJsonLdObjects(page);
  const primary = roots.flatMap((node) => [
    node,
    ...(Array.isArray(node['@graph']) ? node['@graph'].filter(record) : []),
  ]);
  const nodes = schemaNodes(page);
  const mainEntities = primary
    .filter((node) => types(node).includes('WebPage') && pointsToCurrentPage(node, page))
    .flatMap((node) => {
      const value = node['mainEntity'];
      const entities = Array.isArray(value) ? value : [value];
      return entities.flatMap((entity) => {
        const resolved = resolveObject(
          typeof entity === 'string' ? { '@id': entity } : entity,
          nodes,
          page,
        );
        return resolved === null ? [] : [resolved];
      });
    });
  const explicitlyPrimary = nodes.filter((node) =>
    pointsToCurrentPage(node['mainEntityOfPage'], page),
  );
  return [...new Set([...primary, ...mainEntities, ...explicitlyPrimary])];
}

export function referenceId(value: unknown, page: PageSnapshot): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    return new URL(value, page.finalUrl).href;
  } catch {
    return null;
  }
}

const referenceCache = new WeakMap<readonly JsonObject[], ReadonlyMap<string, JsonObject>>();

export function resolveObject(
  value: unknown,
  nodes: readonly JsonObject[],
  page: PageSnapshot,
): JsonObject | null {
  if (!record(value)) return null;
  const id = referenceId(value['@id'], page);
  if (id === null) return value;
  let references = referenceCache.get(nodes);
  if (references === undefined) {
    references = new Map(
      nodes.flatMap((node) => {
        const key = referenceId(node['@id'], page);
        return key !== null && Object.keys(node).length > 1 ? [[key, node] as const] : [];
      }),
    );
    referenceCache.set(nodes, references);
  }
  return references.get(id) ?? value;
}

export function textKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, '');
}

export function addressTextKey(value: string): string {
  const words = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]+/gu, ' ')
    .trim()
    .split(' ');
  const aliases: Readonly<Record<string, string>> = {
    street: 'st',
    str: 'st',
    вулиця: 'вул',
    улица: 'ул',
    avenue: 'ave',
    road: 'rd',
    проспект: 'просп',
  };
  return words
    .map((word) => aliases[word] ?? word)
    .sort()
    .join('|');
}

export function phoneKey(value: string): string {
  const [number = '', extension = ''] = value
    .replace(/^tel:/i, '')
    .split(/(?:;ext=|\bext\.?\s*|\bx\s*|доб\.?\s*)/i);
  const digits = number.replace(/\D/g, '').replace(/^00/, '');
  // Ukraine's national trunk 0 and country prefix 380 are equivalent.
  const canonical = /^0\d{9}$/.test(digits) ? `38${digits}` : digits;
  return canonical.length >= 7 && canonical.length <= 15
    ? `${canonical}${extension ? `x${extension.replace(/\D/g, '')}` : ''}`
    : '';
}

export function addressKey(
  value: unknown,
  nodes: readonly JsonObject[],
  page: PageSnapshot,
): string {
  if (typeof value === 'string') return addressTextKey(value);
  const address = resolveObject(value, nodes, page);
  if (address === null) return '';
  // Require physical street + locality. Formatting/country/postcode differences
  // alone do not prove that two contact blocks name different locations.
  const street = strings(address['streetAddress'])[0] ?? '';
  const city = strings(address['addressLocality'])[0] ?? '';
  return street && city ? addressTextKey(`${street} ${city}`) : '';
}

export function readable(page: PageSnapshot): boolean {
  if (!isSuccessfulHtmlPage(page) || page.truncated || page.rendering?.status === 'Unavailable')
    return false;
  if (page.rendering?.status === 'Rendered' && page.rendering.blocked.length > 0) return false;
  const root = parsePage(page);
  const mount = root.querySelector('#app, #root, #__next, #__nuxt');
  if (
    mount !== null &&
    mount.text.trim() === '' &&
    root.querySelector('script[src], script[type="module"]') !== null
  ) {
    const content = parseHtml((root.querySelector('body') ?? root).outerHTML);
    content
      .querySelectorAll(
        'nav, header, footer, aside, script, style, noscript, template, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]',
      )
      .forEach((element) => element.remove());
    if (content.text.replace(/\s+/g, ' ').trim().length < 80) return false;
  }
  return visibleText(page).length >= 80 && schemaWasRead(page);
}

export type LocalPageFacts = {
  readonly page: PageSnapshot;
  readonly root: HTMLElement;
  readonly nodes: readonly JsonObject[];
  readonly businesses: readonly JsonObject[];
  readonly text: string;
  readonly contact: boolean;
  readonly visibleLocal: boolean;
};

export type LocalCrawlFacts = {
  readonly pages: readonly LocalPageFacts[];
  readonly byPage: ReadonlyMap<PageSnapshot, LocalPageFacts>;
  readonly complete: boolean;
};

const crawlCache = new WeakMap<CrawlResult, LocalCrawlFacts>();

export function localFacts(ctx: SiteContext): LocalCrawlFacts {
  const cached = crawlCache.get(ctx.crawl);
  if (cached !== undefined) return cached;
  const inScopeSnapshots = ctx.crawl.pages.filter((page) => !leftCrawlScope(page, ctx.crawl));
  const pages = inScopeSnapshots.filter(isSuccessfulHtmlPage).map((page) => {
    const root = parsePage(page);
    const nodes = schemaNodes(page);
    const contact =
      /(?:^|[\s/\-_])(contact|contacts|контакти|контакты)(?:[\s/.\-_]|$)/iu.test(
        `${new URL(page.finalUrl).pathname} ${root.querySelector('h1')?.text ?? ''}`,
      ) || nodes.some((node) => types(node).includes('ContactPage'));
    const text = visibleText(page);
    const visibleLocal =
      visibleAddresses(root, contact).length > 0 &&
      telephoneValues(root).some((phone) => phoneKey(phone) !== '');
    return { page, root, nodes, businesses: nodes.filter(isLocal), text, contact, visibleLocal };
  });
  const result = {
    pages,
    byPage: new Map(pages.map((facts) => [facts.page, facts])),
    complete:
      linkGraphGap(ctx) === null &&
      ctx.crawl.blockedByRobots.length === 0 &&
      pages.length > 0 &&
      inScopeSnapshots.every(readable),
  };
  crawlCache.set(ctx.crawl, result);
  return result;
}

/** Only complete observations can close findings from a previous crawl. */
export function observationScope(ctx: SiteContext): {
  readonly checkedTargets: readonly string[];
  readonly inputTargets: readonly string[];
} {
  const facts = localFacts(ctx);
  const targets = facts.pages.map(({ page }) => page.normalizedUrl);
  return { checkedTargets: facts.complete ? targets : [], inputTargets: targets };
}
