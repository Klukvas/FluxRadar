import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspect } from 'node:util';

import { within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { copy, type Language } from './i18n';
import { WORKSPACE_PATHS } from './workspace-paths';

// The static blog reads the session the way the React public pages do
// (public-header-session.test.tsx): a signed-in reader gets the four workspace
// tabs as the links MenuBar draws, and a visitor keeps them disabled. These run
// the shipped blog.js against the shipped markup with only the API stubbed.

// Vitest runs with `apps/web` as its working directory.
const BLOG_ROOT = resolve(process.cwd(), 'public/blog');
const SOURCE = readFileSync(resolve(BLOG_ROOT, 'blog.js'), 'utf8');

/** The API base production builds the app with; blog.js keeps its own copy. */
function productionApiBase(): string {
  const dockerfile = readFileSync(resolve(process.cwd(), '../../Dockerfile.web'), 'utf8');
  const base = /^ARG VITE_API_URL=(\S+)$/m.exec(dockerfile)?.[1];
  if (base === undefined) throw new Error('Dockerfile.web no longer defaults VITE_API_URL');
  return base;
}

// The tabs in the order MenuBar draws them, each with the screen it opens.
const TABS = [
  ['profiles', WORKSPACE_PATHS.desktop],
  ['scan', WORKSPACE_PATHS['new-scan']],
  ['reports', WORKSPACE_PATHS.reports],
  ['integrations', WORKSPACE_PATHS.integrations],
] as const;

const EMAIL = 'owner@example.com';
const ACCOUNT = { accountId: 'account-1', email: EMAIL, emailVerified: true };

type Answer = () => Promise<Response>;

function answerJson(status: number, body: unknown): Answer {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
}

const SIGNED_IN = answerJson(200, { success: true, data: ACCOUNT, error: null });
const NO_SESSION = {
  success: false,
  data: null,
  error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' },
};

let fetchMock: ReturnType<typeof vi.fn>;
let consoleError: MockInstance<typeof console.error>;

/** Opens a shipped blog page at `url`, with the API giving `answer` to the session request. */
function open(page: string, url: string, answer: Answer): void {
  const html = readFileSync(resolve(BLOG_ROOT, page), 'utf8');
  fetchMock.mockImplementation(answer);
  window.history.replaceState(null, '', url);
  document.documentElement.lang = /<html lang="(\w+)"/.exec(html)?.[1] ?? 'en';
  document.body.setAttribute('data-blog-page', /data-blog-page="(\w+)"/.exec(html)?.[1] ?? '');
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
  new Function(SOURCE)();
}

function siteMenu(): HTMLElement {
  const nav = document.querySelector<HTMLElement>('nav.menubar');
  if (nav === null) throw new Error('missing site menu');
  return nav;
}

async function expectWorkspaceLinks(language: Language): Promise<void> {
  const labels = copy[language].nav;
  for (const [tab, path] of TABS) {
    const link = await within(siteMenu()).findByRole('link', { name: labels[tab] });
    expect(link).toHaveAttribute('href', `${path}?lang=${language}`);
    expect(link).toHaveAttribute('title', labels.descriptions[tab]);
    expect(link).toHaveClass('menubar__item', { exact: true });
  }
}

function expectVisitorTabs(language: Language = 'en'): void {
  for (const [tab] of TABS) {
    const name = copy[language].nav[tab];
    expect(within(siteMenu()).getByRole('button', { name })).toBeDisabled();
  }
}

/** Lets the page act on the answer, so a check is not a check on the first paint. */
async function settle(): Promise<void> {
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function loggedText(): string {
  return consoleError.mock.calls
    .flat()
    .map((argument) => inspect(argument))
    .join('\n');
}

beforeEach(() => {
  window.localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  consoleError = vi.spyOn(window.console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  document.body.innerHTML = '';
  document.body.removeAttribute('data-blog-page');
  document.documentElement.removeAttribute('data-blog-lang');
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the blog header for a signed-in reader', () => {
  it('asks the API on this origin who is reading, once, with the session cookie', async () => {
    open('index.html', '/blog', SIGNED_IN);
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`${productionApiBase()}/auth/me`, {
      credentials: 'same-origin',
    });
  });

  it.each([
    ['index.html', '/blog', 'en'],
    ['index.html', '/blog?lang=uk', 'uk'],
    ['ai-crawler-readiness/index.html', '/blog/ai-crawler-readiness', 'en'],
    ['uk/tekhnichne-seo-audyt/index.html', '/blog/uk/tekhnichne-seo-audyt', 'uk'],
  ] as const)('offers the workspace from %s at %s in %s', async (page, url, language) => {
    open(page, url, SIGNED_IN);

    await expectWorkspaceLinks(language);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('carries a language switch into the links without asking again', async () => {
    open('index.html', '/blog', SIGNED_IN);
    await expectWorkspaceLinks('en');

    document.querySelector<HTMLElement>('[data-language-filter="uk"]')?.click();

    await expectWorkspaceLinks('uk');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('links in the language picked while the answer was still on its way', async () => {
    let answer: (response: Response) => void = () => undefined;
    const pending = (): Promise<Response> =>
      new Promise((resolve) => {
        answer = resolve;
      });
    open('index.html', '/blog', pending);
    document.querySelector<HTMLElement>('[data-language-filter="uk"]')?.click();

    void SIGNED_IN().then(answer);

    await expectWorkspaceLinks('uk');
  });
});

describe('the blog header without a signed-in reader', () => {
  it('keeps the tabs disabled for a visitor and logs nothing', async () => {
    open('index.html', '/blog', answerJson(401, NO_SESSION));
    await settle();

    expectVisitorTabs();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each([
    ['the API is unreachable', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['the API fails', answerJson(500, NO_SESSION)],
    ['the answer is not JSON', () => Promise.resolve(new Response(`${EMAIL} <html>`))],
    ['the answer names no account', answerJson(200, { success: false, data: ACCOUNT })],
    ['the answer is empty', answerJson(200, { success: true, data: null, error: null })],
  ] as const)('keeps the tabs disabled and logs one line when %s', async (_case, answer) => {
    open('index.html', '/blog', answer);
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
    await settle();

    expectVisitorTabs();
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('FluxRadar session unavailable', expect.any(Error));
    expect(loggedText()).not.toContain('owner@');
  });

  it.each([
    ['fails', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['never answers', () => new Promise<Response>(() => undefined)],
  ] as const)('keeps the rest of the page working when the request %s', async (_case, answer) => {
    open('index.html', '/blog', answer);

    document.querySelector<HTMLElement>('[data-language-filter="uk"]')?.click();
    expect(document.documentElement.getAttribute('data-blog-lang')).toBe('uk');

    document.querySelector<HTMLElement>('[data-cookie-choice="necessary"]')?.click();
    expect(document.querySelector('[data-cookie-consent]')).toBeNull();
    expect(window.localStorage.getItem('fluxradar.cookieConsent')).toContain('"version":"v2"');

    document.querySelector<HTMLElement>('[data-menu-toggle]')?.click();
    expect(document.getElementById('menubar-links')).toHaveClass('is-open');

    await settle();
    expectVisitorTabs('uk');
  });
});
