// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { copy } from './i18n';
import {
  PUBLIC_ROOT,
  WEB_ROOT,
  metaContent,
  sitemapDocuments,
  titleOf,
} from './public-site-test-support';

// Every page in the sitemap is a search result and a shared link. A production
// scan of fluxradar.net flagged titles over 70 characters, descriptions over
// 160 and an SVG favicon as the social preview, which no network renders.

const TITLE_LENGTH = { min: 10, max: 70 } as const;
const DESCRIPTION_LENGTH = { min: 50, max: 160 } as const;
const PREVIEW_IMAGE = 'https://fluxradar.net/og-image.png';

/** Length as a reader counts it: code points, not UTF-16 units. */
function lengthOf(text: string | null): number {
  return text === null ? 0 : Array.from(text.trim()).length;
}

const pages = sitemapDocuments().map((page) => [page.path, page.html] as const);

describe('public page heads', () => {
  it.each(pages)('%s has a title of 10 to 70 characters', (_path, html) => {
    const length = lengthOf(titleOf(html));
    expect(length).toBeGreaterThanOrEqual(TITLE_LENGTH.min);
    expect(length).toBeLessThanOrEqual(TITLE_LENGTH.max);
  });

  it.each(pages)('%s has a description of 50 to 160 characters', (_path, html) => {
    const length = lengthOf(metaContent(html, 'description'));
    expect(length).toBeGreaterThanOrEqual(DESCRIPTION_LENGTH.min);
    expect(length).toBeLessThanOrEqual(DESCRIPTION_LENGTH.max);
  });

  it.each(pages)('%s shares the large preview image', (_path, html) => {
    for (const key of ['og:title', 'og:description', 'og:url', 'og:image:alt']) {
      expect(metaContent(html, key), key).toMatch(/\S/);
    }
    expect(metaContent(html, 'og:image')).toBe(PREVIEW_IMAGE);
    expect(metaContent(html, 'og:image:width')).toBe('1200');
    expect(metaContent(html, 'og:image:height')).toBe('630');
    expect(metaContent(html, 'twitter:card')).toBe('summary_large_image');
    expect(metaContent(html, 'twitter:image')).toBe(PREVIEW_IMAGE);
  });
});

describe('the shared preview image', () => {
  // The size is read from the PNG header (IHDR), where og:image:width and
  // og:image:height have to agree with it.
  it('is a 1200×630 PNG small enough for every network to fetch', () => {
    const png = readFileSync(resolve(PUBLIC_ROOT, 'og-image.png'));
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(png.length).toBeLessThan(150 * 1024);
  });
});

describe('the home head in index.html', () => {
  // index.html is the first response of `/`, and the app later writes the
  // same copy from i18n.ts; two different home titles would flip on load.
  const template = readFileSync(resolve(WEB_ROOT, 'index.html'), 'utf8');
  const home = copy.en.seo.home;

  it('says what the English home copy says', () => {
    expect(titleOf(template)).toBe(home.title);
    expect(metaContent(template, 'og:title')).toBe(home.title);
    expect(metaContent(template, 'twitter:title')).toBe(home.title);
    expect(metaContent(template, 'description')).toBe(home.description);
    expect(metaContent(template, 'og:description')).toBe(home.description);
    expect(metaContent(template, 'twitter:description')).toBe(home.description);
  });
});
