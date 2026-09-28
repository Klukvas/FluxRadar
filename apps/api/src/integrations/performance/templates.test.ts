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

  it('collapses a bare four-digit year', () => {
    expect(collapseDateSegment('2024')).toBe('{date}');
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
      name: 'four-digit numeric segment reads as a year, not an id',
      url: `${ORIGIN}/product/1234`,
      // Deliberate, documented ambiguity: a bare four-digit segment matches
      // the year pattern before the generic numeric-id rule runs, since a
      // path date is the more common four-digit case in real sites.
      expected: '/product/{date}',
    },
    {
      name: 'uuid segment',
      url: `${ORIGIN}/orders/550e8400-e29b-41d4-a716-446655440000`,
      expected: '/orders/{uuid}',
    },
    {
      name: 'bare-year date segment',
      url: `${ORIGIN}/blog/2024/hello`,
      expected: '/blog/{date}/{slug}',
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
    expect(groups.map((group) => group.templateKey)).toEqual([
      '/',
      '/blog/{date}/{slug}',
      '/about',
    ]);
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
