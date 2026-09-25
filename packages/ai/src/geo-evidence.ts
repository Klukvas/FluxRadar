// The one bounded evidence snapshot a scan's answers are judged against.
//
// Judging an answer needs something to judge it *with*, and the only honest
// material is what this scan actually observed: the fields the site's owner
// typed into the profile, and text from the public pages the crawl read. Both
// are included, but they are never mixed: an owner-entered field is a claim by
// the site's owner, a page excerpt is something the page said, and JSON-LD is
// something the page's author declared about itself. The evaluator prompt
// repeats that distinction, and every supported verdict has to point at one of
// these sources by id and quote it.
//
// The snapshot is built once per scan and handed unchanged to every evaluator,
// so two answers cannot be judged against different evidence and disagree for
// a reason nobody can see afterwards.

import { redact } from './redaction.js';
import type { RedactionOptions } from './redaction.js';

/** Where one piece of evidence came from. */
export type GeoEvidenceKind = 'profile' | 'page' | 'structured-data';

/** What a snapshot is worth: enough site material to judge a description, or not. */
export type GeoEvidenceSufficiency = 'substantive' | 'profile-only' | 'insufficient';

export interface GeoEvidenceSource {
  /** Stable within one snapshot; the evaluator must cite this exact string. */
  readonly id: string;
  readonly kind: GeoEvidenceKind;
  /** What this excerpt is — a profile field name, or a page title. */
  readonly label: string;
  /** The page it came from; null for an owner-entered profile field. */
  readonly url: string | null;
  /** Exact text, already cut to the cap — never re-cut later (see MAX_EXCERPT_CHARS). */
  readonly excerpt: string;
  /** Plain-language origin, shown to the evaluator and stored for audit. */
  readonly provenance: string;
}

export interface GeoEvidenceSnapshot {
  readonly siteDomain: string;
  readonly sources: readonly GeoEvidenceSource[];
  /** What this evidence cannot show — stated to the evaluator and to the reader. */
  readonly limits: readonly string[];
  readonly sufficiency: GeoEvidenceSufficiency;
}

/** The owner-entered profile of the scanned site. Every field is optional. */
export interface GeoEvidenceProfile {
  readonly brand?: string | null;
  readonly industry?: string | null;
  readonly region?: string | null;
  readonly language?: string | null;
  readonly businessDescription?: string | null;
  readonly offerings?: string | null;
  readonly targetLanguages?: string | null;
  readonly targetAudience?: string | null;
}

/** One crawled public page, as much of it as is worth quoting. */
export interface GeoEvidencePage {
  readonly url: string;
  readonly title?: string | null;
  readonly headings?: readonly string[];
  readonly visibleText?: string | null;
  /** Author-declared JSON-LD statements, already flattened to text. */
  readonly structuredData?: readonly string[];
}

export interface GeoEvidenceInput {
  readonly siteDomain: string;
  /** The profile's brand field; when it is just the hostname there is no brand name. */
  readonly brandIsHostname: boolean;
  readonly profile: GeoEvidenceProfile;
  readonly pages: readonly GeoEvidencePage[];
}

/**
 * Bounds. A snapshot has to fit inside one request's input cap together with a
 * question, an answer and a rubric, and it has to be cut *here* — a prompt that
 * gets truncated at the far end can drop the very excerpt a verdict rests on
 * and still come back looking valid.
 */
const MAX_PAGE_SOURCES = 6;
const MAX_STRUCTURED_SOURCES = 3;
const MAX_EXCERPT_CHARS = 700;
const MAX_PROFILE_EXCERPT_CHARS = 360;
/**
 * A label is a page's own title, which is site text like any other and just as
 * unbounded. Capping the excerpt while copying that same title into the label
 * whole left the snapshot unbounded through the back door: one page titled with
 * 40,000 characters pushed every evaluation of that scan over the input cap, so
 * each answer came back `EvidenceTruncated` although its excerpts were short.
 */
const MAX_LABEL_CHARS = 120;
const TRUNCATION_SUFFIX = '…';

const PROFILE_PROVENANCE = 'owner-entered profile field (unverified claim by the site owner)';
const PAGE_PROVENANCE = 'text read from the public page during this scan';
const STRUCTURED_PROVENANCE = 'author-declared JSON-LD on the page (unverified)';

/** Limits that hold for every snapshot, however rich it is. */
const STANDING_LIMITS: readonly string[] = [
  'This evidence is only what this scan observed: the owner-entered profile and the public pages ' +
    'the crawl could read.',
  'A fact missing from this evidence is not shown to be false — it is simply unverified here.',
  'Owner-entered fields and author-declared structured data are claims by the site, not verified ' +
    'facts about it.',
];

function collapse(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

/** Cuts on a code-point boundary so a multi-byte character is never split. */
function excerpt(text: string, maxChars: number): string {
  const codePoints = [...text];
  if (codePoints.length <= maxChars) return text;
  return `${codePoints.slice(0, maxChars - 1).join('')}${TRUNCATION_SUFFIX}`;
}

const PROFILE_FIELDS: ReadonlyArray<readonly [keyof GeoEvidenceProfile, string]> = [
  ['brand', 'Brand name'],
  ['businessDescription', 'Business description'],
  ['offerings', 'Services or products'],
  ['industry', 'Industry or site type'],
  ['region', 'Operating region'],
  ['targetAudience', 'Target audience'],
  ['language', 'Primary language'],
  ['targetLanguages', 'Target languages'],
];

/**
 * Which profile fields say something about the business itself.
 *
 * `language` and `targetLanguages` are settings for how the audit is run. A
 * profile carrying nothing else describes no business, and judging "what does
 * this company do" against "Primary language: uk" would be checking an answer
 * against a fact that can neither support nor contradict any of it.
 */
const AUDIT_SETTING_FIELDS: ReadonlyArray<keyof GeoEvidenceProfile> = [
  'language',
  'targetLanguages',
];

function hasSubstantiveProfileField(input: GeoEvidenceInput): boolean {
  return PROFILE_FIELDS.some(([field]) => {
    if (AUDIT_SETTING_FIELDS.includes(field)) return false;
    if (field === 'brand' && input.brandIsHostname) return false;
    return collapse(input.profile[field]) !== '';
  });
}

function profileSources(input: GeoEvidenceInput): readonly GeoEvidenceSource[] {
  return PROFILE_FIELDS.flatMap(([field, label]): GeoEvidenceSource[] => {
    // A profile nobody named is called after its hostname by `siteProfileNameFor`.
    // Publishing that back as "Brand name: ukrdentclub.ua" would let an evaluator
    // confirm a brand that no human ever stated, out of the domain we supplied.
    if (field === 'brand' && input.brandIsHostname) return [];
    const value = collapse(input.profile[field]);
    if (value === '') return [];
    return [
      {
        id: '',
        kind: 'profile',
        label,
        url: null,
        excerpt: excerpt(value, MAX_PROFILE_EXCERPT_CHARS),
        provenance: PROFILE_PROVENANCE,
      },
    ];
  });
}

/**
 * What one page contributes, title first.
 *
 * The title is part of the excerpt and not only the label: on a page whose body
 * the extractor could not read, "Fyno — фулфілмент для інтернет-магазинів" is
 * the one substantive thing the site said, and a verdict may only rest on text
 * a reader can find quoted in the evidence.
 */
function pageExcerpt(page: GeoEvidencePage): string {
  const parts = [
    collapse(page.title),
    (page.headings ?? []).map(collapse).filter(Boolean).join(' · '),
    collapse(page.visibleText),
  ].filter((part) => part !== '');
  return excerpt(parts.join(' — '), MAX_EXCERPT_CHARS);
}

/**
 * What a page's evidence is listed under: its title, or its address when the
 * page has no title.
 *
 * Bounded either way — both come from the site. The source's `url` stays whole:
 * that field is the provenance link a reader follows, and a cut address would
 * be a link to nowhere.
 */
function sourceLabel(page: GeoEvidencePage): string {
  const title = collapse(page.title);
  return excerpt(title === '' ? page.url : title, MAX_LABEL_CHARS);
}

function pageSources(pages: readonly GeoEvidencePage[]): readonly GeoEvidenceSource[] {
  return pages.slice(0, MAX_PAGE_SOURCES).flatMap((page): GeoEvidenceSource[] => {
    const text = pageExcerpt(page);
    if (text === '') return [];
    return [
      {
        id: '',
        kind: 'page',
        label: sourceLabel(page),
        url: page.url,
        excerpt: text,
        provenance: PAGE_PROVENANCE,
      },
    ];
  });
}

function structuredSources(pages: readonly GeoEvidencePage[]): readonly GeoEvidenceSource[] {
  return pages
    .flatMap((page) =>
      (page.structuredData ?? []).flatMap((statement): GeoEvidenceSource[] => {
        const text = collapse(statement);
        if (text === '') return [];
        return [
          {
            id: '',
            kind: 'structured-data',
            label: sourceLabel(page),
            url: page.url,
            excerpt: excerpt(text, MAX_EXCERPT_CHARS),
            provenance: STRUCTURED_PROVENANCE,
          },
        ];
      }),
    )
    .slice(0, MAX_STRUCTURED_SOURCES);
}

const ID_PREFIX: Readonly<Record<GeoEvidenceKind, string>> = {
  profile: 'profile',
  page: 'page',
  'structured-data': 'jsonld',
};

/** Ids are assigned last, per kind, so they stay stable and readable in a citation. */
function withIds(sources: readonly GeoEvidenceSource[]): readonly GeoEvidenceSource[] {
  const counters = new Map<GeoEvidenceKind, number>();
  return sources.map((source) => {
    const next = (counters.get(source.kind) ?? 0) + 1;
    counters.set(source.kind, next);
    return { ...source, id: `${ID_PREFIX[source.kind]}-${next}` };
  });
}

function sufficiencyOf(
  input: GeoEvidenceInput,
  sources: readonly GeoEvidenceSource[],
): GeoEvidenceSufficiency {
  if (sources.length === 0) return 'insufficient';
  if (sources.some((source) => source.kind !== 'profile')) return 'substantive';
  // Profile fields only — and only worth judging against if at least one of
  // them is about the business rather than about how the audit runs.
  return hasSubstantiveProfileField(input) ? 'profile-only' : 'insufficient';
}

function limitsFor(
  input: GeoEvidenceInput,
  sources: readonly GeoEvidenceSource[],
  sufficiency: GeoEvidenceSufficiency,
): readonly string[] {
  const pageCount = sources.filter((source) => source.kind === 'page').length;
  return [
    ...STANDING_LIMITS,
    ...(input.brandIsHostname
      ? [
          'The owner-entered profile states no brand name, only the domain. Any name below comes ' +
            'from the pages themselves, and no name is confirmed by the owner.',
        ]
      : []),
    ...(sufficiency === 'insufficient'
      ? [
          'Nothing about this business could be read: there is no evidence to judge an answer against.',
        ]
      : []),
    ...(sufficiency === 'profile-only'
      ? ['No public page text could be read, so only the owner-entered profile is available.']
      : []),
    ...(sufficiency === 'substantive'
      ? [`Page evidence covers ${pageCount} public page(s) of ${input.siteDomain}, not the site.`]
      : []),
  ];
}

/** Recursively frozen: one scan builds this once, and every evaluator sees that one object. */
function deepFreeze(snapshot: GeoEvidenceSnapshot): GeoEvidenceSnapshot {
  snapshot.sources.forEach((source) => Object.freeze(source));
  Object.freeze(snapshot.sources);
  Object.freeze(snapshot.limits);
  return Object.freeze(snapshot);
}

export function buildGeoEvidenceSnapshot(input: GeoEvidenceInput): GeoEvidenceSnapshot {
  const sources = withIds([
    ...profileSources(input),
    ...pageSources(input.pages),
    ...structuredSources(input.pages),
  ]);
  const sufficiency = sufficiencyOf(input, sources);
  return deepFreeze({
    siteDomain: input.siteDomain,
    sources,
    limits: limitsFor(input, sources, sufficiency),
    sufficiency,
  });
}

/**
 * The snapshot as it will really be sent, judged, quoted and stored.
 *
 * Redaction happens on the way to a provider, so an evaluator reading a raw
 * excerpt would see one text and the model another: it would quote
 * "[REDACTED:email]" and our check for that quote in the excerpt would fail,
 * turning a correct verdict into an unavailable one. Worse, the excerpt stored
 * beside the verdict would be a third text again. Redacting the snapshot once,
 * here, makes all four the same string — and it is the redacted one, so nothing
 * raw is duplicated anywhere downstream.
 *
 * Throws `RedactionBlockedError` (fail-closed, as everywhere else): a snapshot
 * that cannot be sanitised is not sent and not judged.
 */
export function redactGeoEvidenceSnapshot(
  snapshot: GeoEvidenceSnapshot,
  options?: RedactionOptions,
): GeoEvidenceSnapshot {
  const clean = (value: string): string => redact(value, options).text;
  return deepFreeze({
    ...snapshot,
    sources: snapshot.sources.map((source) => ({
      ...source,
      label: clean(source.label),
      url: source.url === null ? null : clean(source.url),
      excerpt: clean(source.excerpt),
    })),
  });
}

/** The snapshot as the evaluator reads it: one block per source, ids intact. */
export function renderGeoEvidence(snapshot: GeoEvidenceSnapshot): readonly string[] {
  return snapshot.sources.map((source) =>
    [
      `id=${source.id}`,
      `kind=${source.kind}`,
      `label=${source.label}`,
      `url=${source.url ?? '(none)'}`,
      `provenance=${source.provenance}`,
      `excerpt=<<<${source.excerpt}>>>`,
    ].join(' | '),
  );
}

/** Whether a quote the evaluator attributed to a source is really in that source. */
export function evidenceSourceById(
  snapshot: GeoEvidenceSnapshot,
  id: string,
): GeoEvidenceSource | null {
  return snapshot.sources.find((source) => source.id === id) ?? null;
}
