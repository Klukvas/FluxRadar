import type { SafeFetchResult } from '@fluxradar/safe-fetch';
import { describe, expect, it } from 'vitest';

import { checkReferencedMedia } from './media-check.js';
import type { PageSnapshot } from './types.js';

// Whether the images a page points at actually exist.
//
// Before this, the crawler fetched pages and nothing else, and CONTENT-004
// reported the gap as "internal media not confirmed by the crawl" — a Medium
// finding with a score penalty, on files nobody had requested.

const ORIGIN = 'https://example.test';

function page(html: string, url = `${ORIGIN}/`): PageSnapshot {
  return {
    requestedUrl: url,
    normalizedUrl: url,
    finalUrl: url,
    status: 200,
    headers: {},
    redirectChain: [],
    html,
    contentType: 'text/html; charset=utf-8',
    timingMs: 4,
    truncated: false,
  };
}

function ok(url: string, contentType = 'image/png'): SafeFetchResult {
  return {
    finalUrl: url,
    status: 200,
    headers: { 'content-type': contentType },
    body: '',
    redirectChain: [],
    timingMs: 3,
    truncated: false,
  };
}

const inScope = (hostname: string): boolean => hostname === 'example.test';

describe('checkReferencedMedia', () => {
  it('asks about every distinct internal media file the read pages reference', async () => {
    const asked: string[] = [];
    const outcome = await checkReferencedMedia(
      [
        page(
          '<img src="/a.png"><video src="/b.mp4"></video><audio src="/c.mp3"></audio>' +
            '<picture><source src="/d.webp"></picture>',
        ),
      ],
      async (url) => {
        asked.push(url);
        return ok(url);
      },
      { budget: 10, isInScope: inScope },
    );

    expect(asked).toEqual([
      `${ORIGIN}/a.png`,
      `${ORIGIN}/b.mp4`,
      `${ORIGIN}/c.mp3`,
      `${ORIGIN}/d.webp`,
    ]);
    expect(outcome.checks).toHaveLength(4);
    expect(outcome.overBudget).toEqual([]);
  });

  it('asks once for a file referenced by several pages', async () => {
    const asked: string[] = [];
    await checkReferencedMedia(
      [
        page('<img src="/logo.png">', `${ORIGIN}/one`),
        page('<img src="/logo.png">', `${ORIGIN}/two`),
      ],
      async (url) => {
        asked.push(url);
        return ok(url);
      },
      { budget: 10, isInScope: inScope },
    );

    expect(asked).toEqual([`${ORIGIN}/logo.png`]);
  });

  it('leaves someone else’s CDN alone', async () => {
    const asked: string[] = [];
    await checkReferencedMedia(
      [page('<img src="https://cdn.other.test/x.png"><img src="/mine.png">')],
      async (url) => {
        asked.push(url);
        return ok(url);
      },
      { budget: 10, isInScope: inScope },
    );

    expect(asked).toEqual([`${ORIGIN}/mine.png`]);
  });

  it('reports what did not fit the budget instead of guessing about it', async () => {
    const outcome = await checkReferencedMedia(
      [page('<img src="/a.png"><img src="/b.png"><img src="/c.png">')],
      async (url) => ok(url),
      { budget: 2, isInScope: inScope },
    );

    expect(outcome.checks).toHaveLength(2);
    // Named, so a report can say "not checked" rather than imply "broken".
    expect(outcome.overBudget).toEqual([`${ORIGIN}/c.png`]);
  });

  it('does nothing at all on a zero budget', async () => {
    const asked: string[] = [];
    const outcome = await checkReferencedMedia(
      [page('<img src="/a.png">')],
      async (url) => {
        asked.push(url);
        return ok(url);
      },
      { budget: 0, isInScope: inScope },
    );

    expect(asked).toEqual([]);
    expect(outcome).toEqual({ checks: [], overBudget: [] });
  });

  it('records a failed request as a snapshot rather than throwing', async () => {
    const outcome = await checkReferencedMedia(
      [page('<img src="/a.png">')],
      async () => {
        throw new Error('ECONNRESET');
      },
      { budget: 5, isInScope: inScope },
    );

    expect(outcome.checks[0]?.fetchError).toBe('ECONNRESET');
    expect(outcome.checks[0]?.status).toBe(0);
  });

  it('never carries a body, so a media check cannot be read as a page', async () => {
    const outcome = await checkReferencedMedia(
      [page('<img src="/a.png">')],
      async (url) => ({ ...ok(url, 'text/html'), body: '<html>not a page of the site</html>' }),
      { budget: 5, isInScope: inScope },
    );

    expect(outcome.checks[0]?.html).toBeNull();
    // The content type survives, because CONTENT-004 judges an <img> that
    // answers with markup on exactly that.
    expect(outcome.checks[0]?.contentType).toBe('text/html');
  });

  it('does not spend the budget on a media URL the page crawl already fetched', async () => {
    const asked: string[] = [];
    await checkReferencedMedia(
      [
        page('<img src="/already.png">'),
        { ...page('', `${ORIGIN}/already.png`), html: null, contentType: 'image/png' },
      ],
      async (url) => {
        asked.push(url);
        return ok(url);
      },
      { budget: 10, isInScope: inScope },
    );

    expect(asked).toEqual([]);
  });

  it('takes no references from a page that was never read', async () => {
    const asked: string[] = [];
    await checkReferencedMedia(
      [{ ...page('<img src="/a.png">'), status: 403 }],
      async (url) => {
        asked.push(url);
        return ok(url);
      },
      { budget: 10, isInScope: inScope },
    );

    expect(asked).toEqual([]);
  });
});
