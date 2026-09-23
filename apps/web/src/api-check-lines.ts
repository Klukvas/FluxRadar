// The API endpoints a scan checks, as a person types them.
//
// One per line, in the order they will run:
//
//   https://example.com/api/health
//   GET https://example.com/api/products 200,204
//   HEAD https://example.com/api/feed
//
// The method is optional and defaults to GET; the trailing list is the statuses
// the owner expects, which is how an endpoint that is *meant* to answer 404 is
// told apart from one that has broken. Only GET and HEAD exist here because
// only GET and HEAD exist in the API: a scan reads a site, it never changes one.

import type { ApiCheckConfig } from './api';

export interface ApiCheckLineProblem {
  /** 1-based, so it matches what the textarea shows. */
  readonly line: number;
  readonly text: string;
  readonly reason: 'method' | 'url' | 'status';
}

export interface ParsedApiCheckLines {
  readonly valid: readonly ApiCheckConfig[];
  readonly problems: readonly ApiCheckLineProblem[];
}

const METHODS = new Set(['GET', 'HEAD']);

export function parseApiCheckLines(value: string): ParsedApiCheckLines {
  const valid: ApiCheckConfig[] = [];
  const problems: ApiCheckLineProblem[] = [];
  value.split('\n').forEach((raw, index) => {
    const text = raw.trim();
    if (text === '') return;
    const parsed = parseLine(text);
    if (parsed.ok) {
      valid.push(parsed.check);
      return;
    }
    problems.push({ line: index + 1, text, reason: parsed.reason });
  });
  return { valid, problems };
}

/** The same endpoints back as the lines that produced them. */
export function apiCheckLines(checks: readonly ApiCheckConfig[]): string {
  return checks
    .map((check) => {
      const expected = check.expectedStatus ?? [];
      const suffix = expected.length === 0 ? '' : ` ${expected.join(',')}`;
      return `${check.method} ${check.url}${suffix}`;
    })
    .join('\n');
}

type LineResult =
  | { readonly ok: true; readonly check: ApiCheckConfig }
  | { readonly ok: false; readonly reason: ApiCheckLineProblem['reason'] };

function parseLine(text: string): LineResult {
  const parts = text.split(/\s+/).filter((part) => part !== '');
  const [first, ...rest] = parts;
  if (first === undefined) return { ok: false, reason: 'url' };
  const hasMethod = METHODS.has(first.toUpperCase()) && rest.length > 0;
  // A leading word that is neither a URL nor a method we support is a method we
  // do not support — POST is the one people try — and saying "method" is more
  // useful than complaining about the URL that follows it.
  if (!hasMethod && !looksLikeUrl(first)) return { ok: false, reason: 'method' };
  const method = hasMethod ? (first.toUpperCase() as 'GET' | 'HEAD') : 'GET';
  const [urlText, statusText, ...extra] = hasMethod ? rest : parts;
  if (urlText === undefined || !looksLikeUrl(urlText)) return { ok: false, reason: 'url' };
  if (statusText === undefined) return { ok: true, check: { method, url: urlText } };
  // Nothing follows the expected-status list. Accepting a line and ignoring its
  // tail would silently drop whatever the owner meant by it — and every other
  // malformed line is named by its number, so this one has to be too.
  if (extra.length > 0) return { ok: false, reason: 'status' };
  const expectedStatus = statusText.split(',').map((entry) => Number(entry.trim()));
  if (expectedStatus.some((status) => !Number.isInteger(status) || status < 100 || status > 599)) {
    return { ok: false, reason: 'status' };
  }
  return { ok: true, check: { method, url: urlText, expectedStatus } };
}

function looksLikeUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}
