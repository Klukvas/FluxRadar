// Reading a homepage's JSON-LD without trusting it.
//
// Structured metadata is the only place a homepage *states*, rather than
// implies, what it sells, which markets it serves and which languages it
// publishes in. Prose has to be guessed at; `areaServed` does not. So profile
// autofill reads it — and treats it as what it is: attacker-controlled text on
// somebody else's server, reached through the SSRF guard.
//
// Everything here is therefore bounded: how many blocks are read, how long a
// block may be, how deep the walk goes, how many nodes come out of it, and how
// long one value may be. A block that does not parse is skipped, never thrown —
// a malformed script must not cost the owner the rest of the page.

import type { HTMLElement } from 'node-html-parser';

const MAX_BLOCKS = 10;
const MAX_BLOCK_CHARS = 64 * 1024;
const MAX_NODES = 300;
const MAX_DEPTH = 8;
const MAX_VALUE_CHARS = 200;
const MAX_LABELS = 24;

/** One JSON-LD object, exactly as the page wrote it. Every value is `unknown`. */
export type JsonLdNode = Readonly<Record<string, unknown>>;

// The parsed objects themselves are returned to field readers, so keep this
// provenance separately rather than adding a property the publisher did not
// write. It distinguishes a graph's publisher entries from nested offers.
const graphRoots = new WeakSet<JsonLdNode>();

/** The `name`-like properties a thing states its readable label in. */
const LABEL_KEYS = [
  'name',
  'alternateName',
  'audienceType',
  'addressCountry',
  'addressRegion',
  'addressLocality',
] as const;

/** Properties whose own labels stand in for a thing that states none itself. */
const NESTED_LABEL_KEYS = ['address', 'itemOffered', 'containedInPlace'] as const;

function isJsonLdNode(value: unknown): value is JsonLdNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized === '' ? undefined : normalized.slice(0, MAX_VALUE_CHARS);
}

/**
 * Every JSON-LD object on the page, nested ones included and flattened.
 *
 * Flattening is what makes the field rules simple: an offer catalogue's
 * `itemOffered` and a graph's top-level `Organization` come out of the same
 * list, so a rule asks "which nodes are a Service" instead of walking a shape
 * each publisher nests differently.
 *
 * Must be called before the document's `script` elements are removed.
 */
export function readJsonLdNodes(root: HTMLElement): readonly JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const collect = (value: unknown, depth: number, isGraphRoot: boolean): void => {
    if (nodes.length >= MAX_NODES || depth > MAX_DEPTH) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => collect(entry, depth + 1, isGraphRoot));
      return;
    }
    if (!isJsonLdNode(value)) return;
    nodes.push(value);
    if (isGraphRoot) graphRoots.add(value);
    const isGraphContainer = isGraphRoot && !('@type' in value) && Array.isArray(value['@graph']);
    Object.entries(value).forEach(([key, entry]) =>
      collect(entry, depth + 1, isGraphContainer && key === '@graph'),
    );
  };
  for (const script of root
    .querySelectorAll('script[type="application/ld+json"]')
    .slice(0, MAX_BLOCKS)) {
    const source = script.rawText;
    if (source.length > MAX_BLOCK_CHARS) continue;
    try {
      collect(JSON.parse(source), 0, true);
    } catch {
      // A page with one broken block still has usable ones; the owner reviews
      // whatever comes out before saving either way.
      continue;
    }
  }
  return nodes;
}

/** Whether this node was a document-level JSON-LD entry, not a nested value. */
export function isJsonLdGraphRoot(node: JsonLdNode): boolean {
  return graphRoots.has(node);
}

/**
 * The readable labels a JSON-LD value carries: itself when it is a string, its
 * `name`-like properties when it is a thing, each entry when it is a list.
 */
export function jsonLdLabels(value: unknown, depth = 0): readonly string[] {
  if (depth > MAX_DEPTH) return [];
  const direct = boundedString(value);
  if (direct !== undefined) return [direct];
  if (Array.isArray(value)) {
    return value.slice(0, MAX_LABELS).flatMap((entry) => jsonLdLabels(entry, depth + 1));
  }
  if (!isJsonLdNode(value)) return [];
  const own = LABEL_KEYS.flatMap((key) => {
    const label = boundedString(value[key]);
    return label === undefined ? [] : [label];
  });
  if (own.length > 0) return own;
  return NESTED_LABEL_KEYS.flatMap((key) =>
    key in value ? jsonLdLabels(value[key], depth + 1) : [],
  );
}

/** A node's `@type` values, however the page wrote them. */
export function jsonLdTypes(node: JsonLdNode): readonly string[] {
  return jsonLdLabels(node['@type']);
}

/** The labels every node states under one property, in document order. */
export function labelsOfProperty(
  nodes: readonly JsonLdNode[],
  keys: readonly string[],
): readonly string[] {
  return nodes.flatMap((node) =>
    keys.flatMap((key) => (key in node ? jsonLdLabels(node[key]) : [])),
  );
}
