import { describe, expect, it } from 'vitest';

import {
  collapseDateSegment,
  collapseNumericSegment,
  collapseSlugSegment,
  collapseUuidSegment,
  groupUrlsByTemplate,
  templateKeyFor,
} from './templates.ts';

const ORIGIN = 'https://example.com';

describe('collapseNumericSegment', () => {
  it('collapses a purely numeric segment', () => {
    expect(collapseNumericSegment('1234')).toBe('{id}');
  });

  it('leaves a segment with letters alone', () => {
    expect(collapseNumericSegment('page1')).toBeNull();
  });
});

describe('collapseUuidSegment', () => {
  it('collapses a lowercase UUID', () => {
    expect(collapseUuidSegment('550e8400-e29b-41d4-a716-446655440000')).toBe('{uuid}');
  });

  it('collapses an uppercase UUID', () => {
    expect(collapseUuidSegment('550E8400-E29B-41D4-A716-446655440000')).toBe('{uuid}');
  });

  it('rejects a segment that is merely UUID-shaped in length', () => {
    expect(collapseUuidSegment('not-a-uuid-at-all-nope')).toBeNull();
  });
});

describe('collapseDateSegment', () => {
  it('collapses a full ISO date', () => {
    expect(collapseDateSegment('2024-05-01')).toBe('{date}');
  });

  it('collapses a year-month', () => {
    expect(collapseDateSegment('2024-05')).toBe('{date}');
  });

  it('leaves a bare four-digit year alone — it cannot tell a year from a four-digit id without neighbouring segments', () => {
    expect(collapseDateSegment('2024')).toBeNull();
  });

  it('rejects a five-digit number', () => {
    expect(collapseDateSegment('20245')).toBeNull();
  });
});

describe('collapseSlugSegment', () => {
  it('collapses a segment after a known listing prefix', () => {
    expect(collapseSlugSegment('hello-world', 'blog')).toBe('{slug}');
  });

  it('is case-insensitive on the prefix', () => {
    expect(collapseSlugSegment('hello-world', 'Blog')).toBe('{slug}');
  });

  it('leaves a segment alone when there is no previous segment', () => {
    expect(collapseSlugSegment('hello-world', null)).toBeNull();
  });

  it('leaves a segment alone after an unrecognised prefix', () => {
    expect(collapseSlugSegment('hello-world', 'about')).toBeNull();
  });
});

describe('templateKeyFor', () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly url: string;
    readonly expected: string;
  }> = [
    { name: 'root path', url: `${ORIGIN}/`, expected: '/' },
    { name: 'root path with no trailing slash', url: ORIGIN, expected: '/' },
    { name: 'static literal path', url: `${ORIGIN}/about`, expected: '/about' },
    {
      name: 'numeric id segment',
      url: `${ORIGIN}/product/98765`,
      // "product" is also a known slug prefix, but the numeric rule matches
      // first for a purely numeric, non-year-shaped segment.
      expected: '/product/{id}',
    },
    {
      name: 'four-digit numeric segment with no date context reads as an id',
      url: `${ORIGIN}/product/1234`,
      // A bare four-digit segment needs date CONTEXT (a neighbouring
      // month/day segment, or an already-collapsed {date} beside it) to read
      // as a year — otherwise `/product/995` and `/product/1000` would split
      // into two templates for what is the same page type either side of
      // 1000. See `bareYearHasDateContext` in templates.ts.
      expected: '/product/{id}',
    },
    {
      name: 'uuid segment',
      url: `${ORIGIN}/orders/550e8400-e29b-41d4-a716-446655440000`,
      expected: '/orders/{uuid}',
    },
    {
      name: 'bare year with no date context reads as an id, not a date',
      url: `${ORIGIN}/blog/2024/hello`,
      // "2024" has no neighbouring month/day segment, so it has no date
      // context and reads as an id — the slug rule still fires afterwards
      // because a numeric ancestor collapsed (`afterDateOrId`).
      expected: '/blog/{id}/{slug}',
    },
    {
      name: 'dated permalink: year/month/day all collapse, and the slug rule reaches past them',
      url: `${ORIGIN}/2024/03/15/hello-world`,
      expected: '/{date}/{id}/{id}/{slug}',
    },
    {
      name: 'full-date segment',
      url: `${ORIGIN}/events/2024-05-01`,
      expected: '/events/{date}',
    },
    {
      name: 'slug after known prefix',
      url: `${ORIGIN}/blog/my-great-post`,
      expected: '/blog/{slug}',
    },
    {
      name: 'query string is stripped before grouping',
      url: `${ORIGIN}/search?q=shoes&page=2`,
      expected: '/search',
    },
    {
      name: 'trailing slash is ignored',
      url: `${ORIGIN}/about/`,
      expected: '/about',
    },
    {
      name: 'combination: prefix, slug and trailing query',
      url: `${ORIGIN}/product/red-shoes?ref=nav`,
      expected: '/product/{slug}',
    },
    {
      name: 'unrecognised prefix keeps its literal segment',
      url: `${ORIGIN}/team/jane-doe`,
      expected: '/team/jane-doe',
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} -> ${testCase.expected}`, () => {
      expect(templateKeyFor(testCase.url)).toBe(testCase.expected);
    });
  }

  it('groups two same-shaped blog URLs into one template', () => {
    const a = templateKeyFor(`${ORIGIN}/blog/2024/hello`);
    const b = templateKeyFor(`${ORIGIN}/blog/2025/world`);
    expect(a).toBe(b);
  });

  it('keeps the root path distinct from every other template', () => {
    expect(templateKeyFor(`${ORIGIN}/`)).not.toBe(templateKeyFor(`${ORIGIN}/about`));
  });

  it('falls back to the literal string for an unparseable URL', () => {
    expect(templateKeyFor('not a url')).toBe('not a url');
  });

  it('groups dated permalinks (year/month/day, no listing prefix) into one template (H1)', () => {
    const a = templateKeyFor(`${ORIGIN}/2024/03/15/hello-world`);
    const b = templateKeyFor(`${ORIGIN}/2024/03/16/second-post`);
    expect(a).toBe(b);
    expect(a).toBe('/{date}/{id}/{id}/{slug}');
  });

  it('groups a 300-post dated blog into one template, not one per post (H1)', () => {
    const posts = Array.from(
      { length: 300 },
      (_, index) =>
        `${ORIGIN}/2024/${String((index % 12) + 1).padStart(2, '0')}/${String((index % 28) + 1).padStart(2, '0')}/post-${index}`,
    );
    const keys = new Set(posts.map((url) => templateKeyFor(url)));
    expect(keys.size).toBe(1);
  });

  it('groups ids straddling 1000 into one template instead of splitting on the year/id ambiguity (M1)', () => {
    const below = templateKeyFor(`${ORIGIN}/product/995`);
    const above = templateKeyFor(`${ORIGIN}/product/1000`);
    const wide = templateKeyFor(`${ORIGIN}/product/12345`);
    expect(below).toBe(above);
    expect(below).toBe(wide);
    expect(below).toBe('/product/{id}');
  });

  it('still reads a full date next to plausible siblings as a date (M1, unambiguous cases unaffected)', () => {
    expect(templateKeyFor(`${ORIGIN}/events/2024-05-01`)).toBe('/events/{date}');
    expect(templateKeyFor(`${ORIGIN}/events/2024-05`)).toBe('/events/{date}');
  });

  it('collapses a locale-routing prefix so /en/about and /uk/about share one template (L1)', () => {
    const en = templateKeyFor(`${ORIGIN}/en/about`);
    const uk = templateKeyFor(`${ORIGIN}/uk/about`);
    expect(en).toBe(uk);
    expect(en).toBe('/{locale}/about');
  });

  it('does not treat a locale-shaped segment as a locale unless it opens the path (L1)', () => {
    expect(templateKeyFor(`${ORIGIN}/team/en`)).toBe('/team/en');
  });

  // N5: `afterDateOrId` stays set for every segment after the first collapse,
  // not just the last one — the documented price of collapsing a whole dated
  // permalink to one template (H1). Two distinct page types under the same
  // numeric parent merge into one template as a result.
  it('merges distinct page types under the same numeric parent once a segment collapses (N5, documented trade-off)', () => {
    const payment = templateKeyFor(`${ORIGIN}/checkout/123/payment`);
    const review = templateKeyFor(`${ORIGIN}/checkout/123/review`);
    expect(payment).toBe(review);
    expect(payment).toBe('/checkout/{id}/{slug}');
  });
});

describe('groupUrlsByTemplate', () => {
  it('groups pages of the same shape together, in first-seen order', () => {
    const urls = [
      `${ORIGIN}/`,
      `${ORIGIN}/blog/2024/hello`,
      `${ORIGIN}/about`,
      `${ORIGIN}/blog/2025/world`,
      `${ORIGIN}/blog/2026/again`,
    ];
    const groups = groupUrlsByTemplate(urls);
    expect(groups.map((group) => group.templateKey)).toEqual(['/', '/blog/{id}/{slug}', '/about']);
    expect(groups[1]?.urls).toHaveLength(3);
  });

  it('is deterministic across repeated calls', () => {
    const urls = [`${ORIGIN}/a`, `${ORIGIN}/b/1`, `${ORIGIN}/b/2`, `${ORIGIN}/a`];
    const first = groupUrlsByTemplate(urls);
    const second = groupUrlsByTemplate(urls);
    expect(first).toEqual(second);
  });

  it('handles an empty input', () => {
    expect(groupUrlsByTemplate([])).toEqual([]);
  });
});
