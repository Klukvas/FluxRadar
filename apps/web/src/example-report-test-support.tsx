// What every test of the public example report needs to open it.
//
// The page's own suite was one 1,125-line file. It is five now — the route, the
// truthfulness of the report it shows, the words on it, finding your way around
// it, and the column it is drawn in — and this is the part they share: the
// stubbed session every public page reads, the render that waits for the title,
// and the two readings of the page's text the assertions are made against.
//
// Not a test file: the name ends in `-support`, so vitest's own `*.test.*`
// pattern does not collect it.

import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';

import { App } from './App';
import { EXAMPLE_REPORT_PATH } from './app-routes';
import { exampleReportCopy } from './example-report-copy';
import type { Language } from './i18n';

/** The page's own stylesheet, read for the decisions only CSS can carry. */
export const EXAMPLE_CSS = readFileSync(resolve(__dirname, 'styles/example-report.css'), 'utf8');

/** The shared public-document shell's stylesheet, which this page shares classes with. */
export const BASE_CSS = readFileSync(resolve(__dirname, 'styles/base.css'), 'utf8');

/** The scoring package, read for the thresholds the fixture mirrors. */
export const SCORING_SOURCE = readFileSync(
  resolve(process.cwd(), '..', '..', 'packages', 'scoring', 'src', 'overall-score.ts'),
  'utf8',
);

/** One stylesheet of the application, by the name a failure should print. */
export interface Stylesheet {
  readonly file: string;
  readonly css: string;
}

/**
 * Every stylesheet in the build, not only the two this page names.
 *
 * A stylesheet imported anywhere in the application is global once it is in the
 * bundle, so "which file declared it" says nothing about whether a rule can
 * reach this page. The whole directory is read for that reason: a column rule
 * written for `.legal-document` or for `article` in a third file would have been
 * invisible to a scan of `base.css` alone.
 */
export const ALL_STYLESHEETS: readonly Stylesheet[] = readdirSync(resolve(__dirname, 'styles'))
  .filter((file) => file.endsWith('.css'))
  .sort()
  .map((file) => ({ file, css: readFileSync(resolve(__dirname, 'styles', file), 'utf8') }));

/** The session read the header follows, and the support launcher's own ask. */
export const PUBLIC_PAGE_REQUESTS = ['/auth/me', '/support/status'];

export function failure(status: number): Response {
  return new Response(
    JSON.stringify({ success: false, data: null, error: { code: 'TEST', message: 'no' } }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

export function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    headers: { 'content-type': 'application/json' },
  });
}

/** A signed-out visitor: the page must not wait for this, or need anything else. */
export function stubSignedOut(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const { pathname } = new URL(String(input));
    return Promise.resolve(pathname === '/auth/me' ? failure(401) : envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function requestedPaths(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname);
}

export async function openExample(
  language: Language = 'en',
  /** The in-page address the visitor arrives at, for the jumps that unfold a card. */
  hash = '',
): Promise<ReturnType<typeof vi.fn>> {
  const fetchMock = stubSignedOut();
  const query = language === 'uk' ? '?lang=uk' : '';
  window.history.replaceState(null, '', `${EXAMPLE_REPORT_PATH}${query}${hash}`);
  render(<App />);
  await screen.findByRole('heading', { name: exampleReportCopy[language].title });
  return fetchMock;
}

/**
 * The page's visible text, minus the two blocks addressed to a developer.
 *
 * `.example-technical` is the fold holding the internal names. `.example-task`
 * is the message the owner would *forward*: the product writes it for whoever
 * will do the work, so it names the check and its identifier on purpose, and
 * its own heading says who it is for. Everything else on the page is written
 * for the owner and is held to the denylist in `example-report.words.test.tsx`.
 */
export function plainText(): string {
  const body = document.body.cloneNode(true) as HTMLElement;
  for (const forDevelopers of body.querySelectorAll('.example-technical, .example-task')) {
    forDevelopers.remove();
  }
  return body.textContent ?? '';
}

/** Opens every folded problem card, so a test can read what is inside them. */
export function unfoldEveryProblem(): void {
  for (const card of document.querySelectorAll('details.example-finding, .example-finding__more')) {
    card.setAttribute('open', '');
  }
}

/** Everything one test of this page leaves behind. Registered by each file's `afterEach`. */
export function cleanupExamplePage(): void {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  for (const managed of document.head.querySelectorAll('[data-fluxradar-seo]')) managed.remove();
}
