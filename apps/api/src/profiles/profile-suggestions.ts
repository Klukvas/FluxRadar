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
 * extraction, not a crawler or AI prompt: it follows no links and returns only
 * bounded text the owner can inspect before saving.
 */
export async function suggestProfileFromSite(domain: string): Promise<ProfileSuggestions> {
  const response = await safeFetch(domain, PROFILE_SUGGESTIONS_FETCH_OPTIONS);
  if (response.status < 200 || response.status >= 300)
    throw new Error('site did not return a page');
  return extractProfileSuggestions(response.body);
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
