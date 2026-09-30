import { parse } from 'node-html-parser';
import { safeFetch } from '@fluxradar/safe-fetch';

import {
  suggestedAudience,
  suggestedDescription,
  suggestedIndustry,
  suggestedLanguages,
  suggestedName,
  suggestedOfferings,
  suggestedRegion,
} from './profile-suggestions-fields.ts';
import { readJsonLdNodes } from './profile-suggestions-jsonld.ts';
import {
  createProfileSuggestionsAi,
  ProfileSuggestionsAiUnavailableError,
  type SuggestedHumanContext,
} from './profile-suggestions-ai.ts';

const EVIDENCE_TEXT_LIMIT = 700;
const EVIDENCE_METADATA_LIMIT = 600;
const EVIDENCE_STRUCTURED_LIMIT = 1_000;
const EVIDENCE_NODE_LIMIT = 16;
const EVIDENCE_VALUE_LIMIT = 160;
const EVIDENCE_ARRAY_LIMIT = 8;
const EVIDENCE_KEYS = new Set([
  '@type',
  'name',
  'alternateName',
  'description',
  'category',
  'knowsAbout',
  'areaServed',
  'audience',
  'inLanguage',
  'addressCountry',
  'addressRegion',
  'addressLocality',
]);

type EvidenceValue = string | readonly unknown[] | Readonly<Record<string, unknown>>;

function boundedEvidenceValue(value: unknown, depth = 0): EvidenceValue | undefined {
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim().slice(0, EVIDENCE_VALUE_LIMIT);
    return normalized === '' ? undefined : normalized;
  }
  if (Array.isArray(value)) {
    const values = value.slice(0, EVIDENCE_ARRAY_LIMIT).flatMap((entry) => {
      const normalized = boundedEvidenceValue(entry, depth + 1);
      return normalized === undefined ? [] : [normalized];
    });
    return values.length === 0 ? undefined : values;
  }
  if (typeof value !== 'object' || value === null || depth >= 2) return undefined;
  const fields = Object.entries(value).flatMap(([key, entry]) => {
    if (!EVIDENCE_KEYS.has(key)) return [];
    const normalized = boundedEvidenceValue(entry, depth + 1);
    return normalized === undefined ? [] : [[key, normalized] as const];
  });
  return fields.length === 0 ? undefined : Object.fromEntries(fields);
}

function structuredEvidence(
  nodes: readonly Readonly<Record<string, unknown>>[],
): readonly EvidenceValue[] {
  return nodes.slice(0, EVIDENCE_NODE_LIMIT).reduce<readonly EvidenceValue[]>((selected, node) => {
    const shaped = boundedEvidenceValue(node);
    if (shaped === undefined) return selected;
    const next = [...selected, shaped];
    return JSON.stringify(next).length <= EVIDENCE_STRUCTURED_LIMIT ? next : selected;
  }, []);
}

/**
 * A proposal for the profile form. Every field is optional on purpose: the page
 * decides how much of it can be filled, and a field with no evidence behind it
 * is left out so the form can say which ones the owner still has to write.
 */
export interface ProfileSuggestions {
  readonly name?: string;
  readonly businessDescription?: string;
  readonly offerings?: string;
  readonly industry?: string;
  readonly region?: string;
  readonly targetAudience?: string;
  readonly targetLanguages?: string;
  /** `source` means AI could not localize the deterministic public evidence. */
  readonly contextLanguage?: 'target' | 'source';
}

// Kept exportable so the bounded transport contract stays covered without
// replacing the shared SSRF guard in a unit test.
export const PROFILE_SUGGESTIONS_FETCH_OPTIONS = {
  method: 'GET',
  timeoutMs: 8_000,
  maxBodyBytes: 256 * 1024,
  maxRedirects: 3,
  headers: { 'user-agent': 'FluxRadarProfileAssistant/1.0' },
} as const;

/**
 * Reads one public homepage through the shared SSRF guard. This is deliberately
 * collection, not a crawler: it follows no links and sends only bounded
 * public evidence to the single structured AI extraction.
 */
function evidenceFromHomepage(html: string): string {
  const root = parse(html);
  const nodes = readJsonLdNodes(root);
  const metadata = root
    .querySelectorAll(
      'title,meta[name="description"],meta[property="og:description"],meta[property="og:site_name"]',
    )
    .map((node) => node.getAttribute('content') ?? node.text)
    .filter((value) => value.trim() !== '')
    .join(' ')
    .slice(0, EVIDENCE_METADATA_LIMIT);
  root
    .querySelectorAll('script,style,noscript,template,nav,header,footer,aside')
    .forEach((node) => node.remove());
  const main =
    root.querySelector('main,article,[role="main"]') ?? root.querySelector('body') ?? root;
  const visible = main.text.replace(/\s+/g, ' ').trim().slice(0, EVIDENCE_TEXT_LIMIT);
  const structured = structuredEvidence(nodes);
  return JSON.stringify({ metadata, structured, visible });
}

function withHumanContext(
  proposal: ProfileSuggestions,
  context: SuggestedHumanContext,
): ProfileSuggestions {
  const { industry, businessDescription, offerings, region, targetAudience } = context;
  return {
    ...(proposal.name === undefined ? {} : { name: proposal.name }),
    ...(proposal.targetLanguages === undefined
      ? {}
      : { targetLanguages: proposal.targetLanguages }),
    ...(industry === undefined ? {} : { industry }),
    ...(businessDescription === undefined ? {} : { businessDescription }),
    ...(offerings === undefined ? {} : { offerings }),
    ...(region === undefined ? {} : { region }),
    ...(targetAudience === undefined ? {} : { targetAudience }),
    contextLanguage: 'target',
  };
}

export async function suggestProfileFromSite(
  domain: string,
  targetLanguage: 'en' | 'uk',
  suggestContext?: (
    targetLanguage: 'en' | 'uk',
    evidence: string,
    signal?: AbortSignal,
  ) => Promise<SuggestedHumanContext>,
  signal?: AbortSignal,
): Promise<ProfileSuggestions> {
  const response = await safeFetch(domain, { ...PROFILE_SUGGESTIONS_FETCH_OPTIONS, signal });
  if (response.status < 200 || response.status >= 300)
    throw new Error('site did not return a page');
  const fallback = extractProfileSuggestions(response.body);
  try {
    return withHumanContext(
      fallback,
      await (suggestContext ?? createProfileSuggestionsAi())(
        targetLanguage,
        evidenceFromHomepage(response.body),
        signal,
      ),
    );
  } catch (error) {
    if (error instanceof ProfileSuggestionsAiUnavailableError)
      return { ...fallback, contextLanguage: 'source' };
    throw error;
  }
}

export function extractProfileSuggestions(html: string): ProfileSuggestions {
  const root = parse(html);
  // The structured metadata is read first: it lives in `script` elements, which
  // the text pass below removes so that no markup the browser never shows —
  // inline scripts, styles, unrendered templates — reaches the owner as a
  // proposal about their own business.
  const nodes = readJsonLdNodes(root);
  root.querySelectorAll('script,style,noscript,template').forEach((node) => node.remove());
  // A field with no evidence is absent, not empty: the form tells the two apart
  // to decide what it still has to ask the owner for.
  const stated = <Key extends keyof ProfileSuggestions>(
    key: Key,
    value: string | undefined,
  ): Partial<ProfileSuggestions> => (value === undefined ? {} : { [key]: value });
  return {
    ...stated('name', suggestedName(root, nodes)),
    ...stated('businessDescription', suggestedDescription(root, nodes)),
    ...stated('offerings', suggestedOfferings(root, nodes)),
    ...stated('industry', suggestedIndustry(root, nodes)),
    ...stated('region', suggestedRegion(nodes)),
    ...stated('targetAudience', suggestedAudience(root, nodes)),
    ...stated('targetLanguages', suggestedLanguages(root, nodes)),
  };
}
