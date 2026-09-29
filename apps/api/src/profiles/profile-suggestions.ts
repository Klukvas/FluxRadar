import { parse } from 'node-html-parser';
import { safeFetch } from '@fluxradar/safe-fetch';

export interface ProfileSuggestions {
  readonly name?: string;
  readonly businessDescription?: string;
  readonly offerings?: string;
  readonly targetLanguages?: string;
}

const MAX_TEXT = 800;

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
  root.querySelectorAll('script,style,noscript,template').forEach((node) => node.remove());
  const text = (value: string | undefined): string | undefined => {
    const normalized = value?.replace(/\s+/g, ' ').trim();
    return normalized === undefined || normalized === ''
      ? undefined
      : normalized.slice(0, MAX_TEXT);
  };
  const title =
    text(root.querySelector('meta[property="og:site_name"]')?.getAttribute('content')) ??
    text(root.querySelector('title')?.text);
  const description = text(root.querySelector('meta[name="description"]')?.getAttribute('content'));
  const headings = root
    .querySelectorAll('main h2, main h3, h2, h3')
    .map((node) => text(node.text))
    .filter((value): value is string => value !== undefined)
    .slice(0, 8);
  const language = root.querySelector('html')?.getAttribute('lang')?.split('-')[0]?.toLowerCase();
  return {
    ...(title === undefined ? {} : { name: title.slice(0, 120) }),
    ...(description === undefined ? {} : { businessDescription: description }),
    ...(headings.length === 0 ? {} : { offerings: headings.join(', ').slice(0, 1200) }),
    ...(language === undefined || !/^[a-z]{2,3}$/.test(language)
      ? {}
      : { targetLanguages: language }),
  };
}
