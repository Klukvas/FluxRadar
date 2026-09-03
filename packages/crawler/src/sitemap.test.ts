import { describe, expect, it } from 'vitest';

import type { SafeFetchResult } from '@fluxradar/safe-fetch';

import { fetchSitemapUrls } from './sitemap.js';
import type { CrawlFetcher } from './types.js';

function xmlResponse(url: string, body: string, status = 200): SafeFetchResult {
  return {
    finalUrl: url,
    status,
    headers: { 'content-type': 'application/xml' },
    body,
    redirectChain: [],
    timingMs: 1,
    truncated: false,
  };
}

function fetcherFor(routes: Readonly<Record<string, string>>): CrawlFetcher {
  return (url) => {
    const body = routes[url];
    return Promise.resolve(
      body === undefined ? xmlResponse(url, 'not found', 404) : xmlResponse(url, body),
    );
  };
}

describe('fetchSitemapUrls', () => {
  it('извлекает loc из urlset и декодирует XML-сущности', async () => {
    const fetcher = fetcherFor({
      'https://s.example/sitemap.xml': `<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc> https://s.example/a </loc></url>
          <url><loc>https://s.example/b?x=1&amp;y=2</loc></url>
        </urlset>`,
    });
    await expect(fetchSitemapUrls('https://s.example/sitemap.xml', fetcher)).resolves.toEqual([
      'https://s.example/a',
      'https://s.example/b?x=1&y=2',
    ]);
  });

  it('sitemapindex разворачивается ровно на один уровень', async () => {
    const fetcher = fetcherFor({
      'https://s.example/sitemap.xml': `<sitemapindex>
          <sitemap><loc>https://s.example/child.xml</loc></sitemap>
          <sitemap><loc>https://s.example/nested-index.xml</loc></sitemap>
          <sitemap><loc>https://s.example/gone.xml</loc></sitemap>
        </sitemapindex>`,
      'https://s.example/child.xml': `<urlset><url><loc>https://s.example/from-child</loc></url></urlset>`,
      // Вложенный индекс второго уровня не разворачивается.
      'https://s.example/nested-index.xml': `<sitemapindex>
          <sitemap><loc>https://s.example/deeper.xml</loc></sitemap>
        </sitemapindex>`,
    });
    await expect(fetchSitemapUrls('https://s.example/sitemap.xml', fetcher)).resolves.toEqual([
      'https://s.example/from-child',
    ]);
  });

  it('обрезает результат по лимиту URL', async () => {
    const locs = Array.from(
      { length: 10 },
      (_, i) => `<url><loc>https://s.example/p${i}</loc></url>`,
    ).join('');
    const fetcher = fetcherFor({
      'https://s.example/sitemap.xml': `<urlset>${locs}</urlset>`,
    });
    const urls = await fetchSitemapUrls('https://s.example/sitemap.xml', fetcher, 3);
    expect(urls).toHaveLength(3);
  });

  it('чужой host в sitemapindex не фетчится при заданном фильтре (план §25)', async () => {
    const fetched: string[] = [];
    const routes: Readonly<Record<string, string>> = {
      'https://s.example/sitemap.xml': `<sitemapindex>
          <sitemap><loc>https://evil.example/child.xml</loc></sitemap>
          <sitemap><loc>https://s.example/child.xml</loc></sitemap>
        </sitemapindex>`,
      'https://evil.example/child.xml': `<urlset><url><loc>https://evil.example/p</loc></url></urlset>`,
      'https://s.example/child.xml': `<urlset><url><loc>https://s.example/own</loc></url></urlset>`,
    };
    const fetcher: CrawlFetcher = (url) => {
      fetched.push(url);
      const body = routes[url];
      return Promise.resolve(
        body === undefined ? xmlResponse(url, 'not found', 404) : xmlResponse(url, body),
      );
    };
    const isSameHost = (url: string): boolean => new URL(url).hostname === 's.example';
    const urls = await fetchSitemapUrls('https://s.example/sitemap.xml', fetcher, 100, isSameHost);
    expect(urls).toEqual(['https://s.example/own']);
    expect(fetched).not.toContain('https://evil.example/child.xml');
  });

  it('недоступный sitemap — пустой список, не ошибка', async () => {
    const failing: CrawlFetcher = () => Promise.reject(new Error('boom'));
    await expect(fetchSitemapUrls('https://s.example/sitemap.xml', failing)).resolves.toEqual([]);
  });
});
