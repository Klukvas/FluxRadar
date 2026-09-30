// What each profile field may be filled from, and what is not evidence for it.
//
// The rule for every field is the same: propose it only where the page states
// it. The owner is asked to review a proposal, not to spot an invention — a
// plausible wrong region or audience is more expensive than an empty field,
// because it reaches the AI prompts that decide what the report says.
//
// Two distinctions are load-bearing:
//
//  * Where a business *is* is not where it *sells*. `areaServed` is the served
//    market and fills the region field; `address` is the office and never does.
//    A Kyiv studio serving the United States would otherwise be told its market
//    is Kyiv, and every GEO check downstream would follow that.
//  * A heading is not an offering. Section labels are rejected outright; see
//    `profile-suggestions-sections.ts`.
//
// Nothing here reads an AI provider, follows a link, or looks at a second page.

import type { HTMLElement } from 'node-html-parser';

import {
  isJsonLdGraphRoot,
  jsonLdTypes,
  labelsOfProperty,
  type JsonLdNode,
} from './profile-suggestions-jsonld.ts';
import { offeringsFromSections } from './profile-suggestions-sections.ts';
import { boundedText, uniqueText } from './profile-suggestions-text.ts';

const MAX_NAME_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 800;
const MAX_INDUSTRY_CHARS = 80;
const MAX_LIST_CHARS = 1200;
const MAX_OFFERING_ITEMS = 12;
const MAX_REGION_ITEMS = 8;
const MAX_AUDIENCE_ITEMS = 6;
const MAX_LANGUAGE_ITEMS = 10;
const MAX_LANGUAGE_TAG_CHARS = 40;

/** Types that say "this is a thing on offer" rather than "this is a page". */
const OFFERING_TYPES = new Set([
  'service',
  'product',
  'individualproduct',
  'someproducts',
  'productmodel',
  'creativework',
  'course',
]);

/** Types that say "an organisation" without saying which kind — not a category. */
const GENERIC_ENTITY_TYPES = new Set([
  'organization',
  'corporation',
  'localbusiness',
  'business',
  'website',
]);

/** A graph root with one of these types describes content, not its publisher. */
const NON_PUBLISHER_TYPES = new Set([
  'thing',
  'place',
  'person',
  'webpage',
  'webapplication',
  'product',
  'event',
  'creativework',
  'service',
]);

function metaContent(root: HTMLElement, selector: string): string | undefined {
  return boundedText(root.querySelector(selector)?.getAttribute('content'), MAX_DESCRIPTION_CHARS);
}

function firstOf(values: readonly (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined);
}

function joined(
  values: readonly string[],
  maxItems: number,
  maxChars = MAX_LIST_CHARS,
): string | undefined {
  const items = uniqueText(values).slice(0, maxItems);
  return items.length === 0 ? undefined : items.join(', ').slice(0, maxChars);
}

function nodesTyped(
  nodes: readonly JsonLdNode[],
  types: ReadonlySet<string>,
): readonly JsonLdNode[] {
  return nodes.filter((node) =>
    jsonLdTypes(node).some((type) => types.has(type.toLocaleLowerCase())),
  );
}

/**
 * Document-level organization nodes, plus specific business types such as
 * `Dentist` that identify themselves with an address or telephone. Nested
 * nodes never qualify, even if they carry an address or logo.
 */
function publisherNodes(nodes: readonly JsonLdNode[]): readonly JsonLdNode[] {
  return nodes.filter((node) => {
    if (!isJsonLdGraphRoot(node)) return false;
    const types = jsonLdTypes(node).map((type) => type.toLocaleLowerCase());
    if (types.some((type) => GENERIC_ENTITY_TYPES.has(type))) return true;
    return (
      types.length > 0 &&
      !types.some((type) => NON_PUBLISHER_TYPES.has(type)) &&
      ['address', 'telephone'].some((key) => key in node)
    );
  });
}

export function suggestedName(root: HTMLElement, nodes: readonly JsonLdNode[]): string | undefined {
  const fromPage = firstOf([
    metaContent(root, 'meta[property="og:site_name"]'),
    boundedText(root.querySelector('title')?.text, MAX_DESCRIPTION_CHARS),
  ]);
  const fromMarkup = labelsOfProperty(nodesTyped(nodes, new Set(['organization', 'website'])), [
    'name',
  ])[0];
  return boundedText(fromPage ?? fromMarkup, MAX_NAME_CHARS);
}

export function suggestedDescription(
  root: HTMLElement,
  nodes: readonly JsonLdNode[],
): string | undefined {
  return firstOf([
    metaContent(root, 'meta[name="description"]'),
    metaContent(root, 'meta[property="og:description"]'),
    boundedText(labelsOfProperty(nodes, ['description'])[0], MAX_DESCRIPTION_CHARS),
  ]);
}

/**
 * A type token or ontology URL as a reader's category: `ProfessionalService`
 * becomes "Professional service". A value the page already wrote as words is
 * left exactly as written — it is the publisher's own wording, not a token.
 */
function readableCategory(value: string): string | undefined {
  if (value.includes(' ')) return boundedText(value, MAX_INDUSTRY_CHARS);
  const token = value.includes('/')
    ? (value
        .split(/[/#]/)
        .filter((part) => part !== '')
        .at(-1) ?? value)
    : value;
  let decoded: string;
  try {
    decoded = decodeURIComponent(token);
  } catch {
    // JSON-LD is publisher input. A stray percent sign must not discard every
    // other suggestion from an otherwise usable homepage.
    decoded = token;
  }
  const spaced = decoded.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const words = boundedText(spaced, MAX_INDUSTRY_CHARS);
  return words === undefined
    ? undefined
    : words.charAt(0).toLocaleUpperCase() + words.slice(1).toLocaleLowerCase();
}

/**
 * The business or site type, from a stated category only.
 *
 * `category` and `additionalType` are the publisher saying it outright. Failing
 * those, a `@type` more specific than "an organisation" says it too: `Dentist`
 * is a category, `Organization` is not. A page that states neither leaves the
 * field empty — guessing one out of the title is how "Software Development
 * Company in Ukraine | fluxLab.dev" becomes a business type.
 */
export function suggestedIndustry(
  root: HTMLElement,
  nodes: readonly JsonLdNode[],
): string | undefined {
  const entities = publisherNodes(nodes);
  const stated = labelsOfProperty(entities, ['category', 'additionalType']);
  const specific = entities
    .flatMap((node) => jsonLdTypes(node))
    .filter((type) => !GENERIC_ENTITY_TYPES.has(type.toLocaleLowerCase()));
  const fromMeta = metaContent(root, 'meta[name="classification"]');
  return firstOf(
    [...stated, ...specific, ...(fromMeta === undefined ? [] : [fromMeta])].map(readableCategory),
  );
}

/**
 * The services or products on offer: what the markup puts on offer, else the
 * topics it says the business works in, else the page's own services section.
 */
export function suggestedOfferings(
  root: HTMLElement,
  nodes: readonly JsonLdNode[],
): string | undefined {
  const offered = [
    ...labelsOfProperty(nodesTyped(nodes, OFFERING_TYPES), ['name']),
    ...labelsOfProperty(nodes, ['itemOffered']),
  ];
  const topics = labelsOfProperty(publisherNodes(nodes), ['knowsAbout']);
  // A declared list often mixes customer-facing phrases with a technology
  // stack. When the publisher supplied descriptive phrases, they are stronger
  // evidence of an offering than one-word topics such as a framework name.
  const descriptiveTopics = topics.filter((topic) => /\s/u.test(topic));
  const stated =
    offered.length > 0 ? offered : descriptiveTopics.length > 0 ? descriptiveTopics : topics;
  return joined(stated.length > 0 ? stated : offeringsFromSections(root), MAX_OFFERING_ITEMS);
}

/**
 * The served market — `areaServed` and nothing else. A postal address is where
 * the business sits, which is a different claim, and merging the two is the
 * mistake this rule exists to avoid.
 */
export function suggestedRegion(nodes: readonly JsonLdNode[]): string | undefined {
  return joined(
    labelsOfProperty(publisherNodes(nodes), ['areaServed', 'serviceArea']),
    MAX_REGION_ITEMS,
  );
}

/** Who the site is for, where the page says so in as many words. */
export function suggestedAudience(
  root: HTMLElement,
  nodes: readonly JsonLdNode[],
): string | undefined {
  const stated = labelsOfProperty(publisherNodes(nodes), ['audience']);
  const fromMeta = metaContent(root, 'meta[name="audience"]');
  return joined([...stated, ...(fromMeta === undefined ? [] : [fromMeta])], MAX_AUDIENCE_ITEMS);
}

/** An `en_US`, `uk-UA` or `en` tag as its primary subtag; anything else as written. */
function languageTag(value: string | null | undefined): readonly string[] {
  const text = boundedText(value, MAX_LANGUAGE_TAG_CHARS);
  if (text === undefined || text.toLocaleLowerCase() === 'x-default') return [];
  const primary = /^([a-z]{2,3})(?:[-_][a-z0-9]+)*$/i.exec(text)?.[1];
  return [primary === undefined ? text : primary.toLocaleLowerCase()];
}

/**
 * The languages the site publishes in: the page's own, then every other one it
 * declares. The profile field stores names or codes interchangeably, so a code
 * is passed through as the page wrote it rather than translated here.
 */
export function suggestedLanguages(
  root: HTMLElement,
  nodes: readonly JsonLdNode[],
): string | undefined {
  const attributes = (selector: string, attribute: string): readonly (string | undefined)[] =>
    root.querySelectorAll(selector).map((node) => node.getAttribute(attribute));
  const declared = [
    root.querySelector('html')?.getAttribute('lang'),
    metaContent(root, 'meta[property="og:locale"]'),
    ...labelsOfProperty(nodes, ['inLanguage']),
    ...attributes('meta[property="og:locale:alternate"]', 'content'),
    ...attributes('link[rel="alternate"][hreflang]', 'hreflang'),
  ];
  return joined(declared.flatMap(languageTag), MAX_LANGUAGE_ITEMS);
}
