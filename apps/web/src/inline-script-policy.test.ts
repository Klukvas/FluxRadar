// Every document FluxRadar serves has to survive its own Content-Security-Policy.
//
// deploy/Caddyfile ships `script-src 'self' https://sbl.onfastspring.com` with
// no `'unsafe-inline'`, no nonce and no hash. That is the right policy, and it
// has one failure mode nobody notices: `vite dev`, `vite preview` and every test
// in this repository serve these documents with NO policy at all, so an inline
// `<script>` added to a blog article works perfectly everywhere except
// production, where the browser silently refuses to run it. The page still
// renders — it just stops doing whatever the script did.
//
// The static blog pages are where this bites, because they are hand-written HTML
// rather than a bundle. Their behaviour was moved into /blog/blog.js exactly for
// this reason; this test is what keeps it there.
//
// JSON-LD is deliberately allowed: a `<script type="application/ld+json">` block
// is a data block, not a script, and CSP's script-src does not apply to it
// (CSP3 §"script-src", "Should element be blocked" — a non-JavaScript MIME type
// is not blocked). Every browser and every crawler reads ours today.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest runs with `apps/web` as its working directory (see blog-page.test.ts).
const WEB_ROOT = resolve(process.cwd());
const REPO_ROOT = join(WEB_ROOT, '..', '..');

/** The `type` a `<script>` may carry while holding inline content. */
const DATA_BLOCK_TYPE = 'application/ld+json';

/** Origins the policy allows a document to reference, besides its own. */
const ALLOWED_EXTERNAL_ORIGINS = ['https://fluxradar.net'];

function htmlDocuments(): readonly string[] {
  const blogRoot = join(WEB_ROOT, 'public', 'blog');
  const blogPages = readdirSync(blogRoot, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.html'))
    .map((entry) => join(blogRoot, entry));
  return [join(WEB_ROOT, 'index.html'), ...blogPages];
}

interface ScriptBlock {
  readonly attributes: string;
  readonly content: string;
}

function scriptBlocks(html: string): readonly ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  const pattern = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match = pattern.exec(html);
  while (match !== null) {
    blocks.push({ attributes: match[1] ?? '', content: match[2] ?? '' });
    match = pattern.exec(html);
  }
  return blocks;
}

function typeOf(attributes: string): string | null {
  return /\btype\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1]?.toLowerCase() ?? null;
}

const documents = htmlDocuments().map((path) => ({
  name: relative(REPO_ROOT, path),
  html: readFileSync(path, 'utf8'),
}));

describe('documents served under the production CSP', () => {
  it('finds the pages it is supposed to be checking', () => {
    expect(documents.length).toBeGreaterThan(5);
    expect(documents.map(({ name }) => name)).toContain('apps/web/index.html');
  });

  it.each(documents.map(({ name }) => name))('%s runs no inline script', (name) => {
    const document = documents.find((entry) => entry.name === name);
    const inline = scriptBlocks(document?.html ?? '').filter(
      ({ content }) => content.trim() !== '',
    );

    for (const block of inline) {
      // Anything other than the JSON-LD data block would need 'unsafe-inline',
      // a nonce or a hash — none of which the deployed policy grants.
      expect(typeOf(block.attributes)).toBe(DATA_BLOCK_TYPE);
    }
  });

  // An `onclick="…"` attribute needs 'unsafe-inline' just as much as a
  // `<script>` block does, and reads as ordinary HTML while doing it.
  it.each(documents.map(({ name }) => name))('%s uses no inline event handler', (name) => {
    const html = documents.find((entry) => entry.name === name)?.html ?? '';

    expect(html).not.toMatch(/<[^>]+\son[a-z]+\s*=\s*["']/i);
  });

  it.each(documents.map(({ name }) => name))('%s uses no javascript: URL', (name) => {
    const html = documents.find((entry) => entry.name === name)?.html ?? '';

    expect(html.toLowerCase()).not.toContain('javascript:');
  });

  // `default-src 'self'` with `img-src 'self' data:` and `style-src 'self'
  // 'unsafe-inline'`: a stylesheet, image or font pulled from a third party is
  // simply not fetched, and the page ships with a hole in it.
  it.each(documents.map(({ name }) => name))('%s loads nothing off-origin', (name) => {
    const html = documents.find((entry) => entry.name === name)?.html ?? '';
    const references = [...html.matchAll(/\b(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].map(
      (match) => match[1] ?? '',
    );

    const foreign = references.filter(
      (reference) =>
        !ALLOWED_EXTERNAL_ORIGINS.some((origin) => reference.startsWith(`${origin}/`)) &&
        !ALLOWED_EXTERNAL_ORIGINS.includes(reference),
    );

    expect(foreign).toEqual([]);
  });
});
