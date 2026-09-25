// The evidence snapshot: what it includes, what it refuses to include, and
// what it says about itself when there is almost nothing to say.

import { describe, expect, it } from 'vitest';

import {
  buildGeoEvidenceSnapshot,
  evidenceSourceById,
  renderGeoEvidence,
  type GeoEvidenceInput,
} from './geo-evidence.js';

function input(overrides: Partial<GeoEvidenceInput> = {}): GeoEvidenceInput {
  return {
    siteDomain: 'smile.example',
    brandIsHostname: false,
    profile: { brand: 'Smile Clinic', businessDescription: 'Dental clinic in Kyiv' },
    pages: [
      {
        url: 'https://smile.example/',
        title: 'Smile Clinic — dental care in Kyiv',
        headings: ['Implants', 'Emergency appointments'],
        visibleText: 'We place implants and see emergency patients the same day.',
      },
    ],
    ...overrides,
  };
}

describe('geo evidence snapshot', () => {
  it('keeps owner-entered fields and crawled pages apart, with their provenance', () => {
    const snapshot = buildGeoEvidenceSnapshot(input());

    const profile = snapshot.sources.filter((source) => source.kind === 'profile');
    const pages = snapshot.sources.filter((source) => source.kind === 'page');
    expect(profile.map((source) => source.id)).toEqual(['profile-1', 'profile-2']);
    expect(profile[0]?.provenance).toContain('unverified claim by the site owner');
    expect(profile[0]?.url).toBeNull();
    expect(pages[0]).toMatchObject({
      id: 'page-1',
      url: 'https://smile.example/',
      provenance: 'text read from the public page during this scan',
    });
    expect(pages[0]?.excerpt).toContain('emergency patients');
    expect(snapshot.sufficiency).toBe('substantive');
  });

  it('does not publish a hostname-shaped profile name as a brand', () => {
    const snapshot = buildGeoEvidenceSnapshot(
      input({
        brandIsHostname: true,
        profile: { brand: 'smile.example' },
      }),
    );

    expect(snapshot.sources.some((source) => source.excerpt === 'smile.example')).toBe(false);
    expect(snapshot.limits.join(' ')).toContain('no brand name');
  });

  // The limit used to read "no confirmed brand name is available", which is
  // wrong the moment a crawled page says what the business calls itself. What
  // is missing is the owner's own statement of it, and only that.
  it('limits the missing brand name to the profile, not to the whole snapshot', () => {
    const snapshot = buildGeoEvidenceSnapshot(
      input({
        brandIsHostname: true,
        profile: { brand: 'fyno.com.ua', businessDescription: 'Fulfilment for online shops' },
        pages: [
          {
            url: 'https://fyno.com.ua/',
            title: 'FYNO — фулфілмент для інтернет-магазинів',
            visibleText: 'FYNO зберігає та відправляє замовлення.',
          },
        ],
      }),
    );

    const limits = snapshot.limits.join(' ');
    expect(limits).toContain('owner-entered profile states no brand name');
    expect(limits).toContain('from the pages themselves');
    // The page-derived name stays quotable evidence: the evaluator may still
    // check an answer against what the site itself says it is called.
    const page = snapshot.sources.find((source) => source.kind === 'page');
    expect(page?.excerpt).toContain('FYNO');
  });

  // A page whose body the extractor could not read still said something: its
  // title. Dropping the page left the only substantive line unquotable, and a
  // claim can only be supported by text that is in an excerpt.
  it('keeps a title-only page as quotable evidence', () => {
    const snapshot = buildGeoEvidenceSnapshot(
      input({
        pages: [{ url: 'https://smile.example/', title: 'Smile Clinic — dental care in Kyiv' }],
      }),
    );

    const page = snapshot.sources.find((source) => source.kind === 'page');
    expect(page?.excerpt).toBe('Smile Clinic — dental care in Kyiv');
    expect(snapshot.sufficiency).toBe('substantive');
  });

  it('marks JSON-LD as an author declaration rather than a verified fact', () => {
    const snapshot = buildGeoEvidenceSnapshot(
      input({
        pages: [
          {
            url: 'https://smile.example/',
            title: 'Smile Clinic',
            visibleText: 'Dental care.',
            structuredData: ['@type=Dentist; name=Smile Clinic; areaServed=Kyiv'],
          },
        ],
      }),
    );

    const structured = snapshot.sources.find((source) => source.kind === 'structured-data');
    expect(structured).toMatchObject({
      id: 'jsonld-1',
      provenance: 'author-declared JSON-LD on the page (unverified)',
    });
  });

  it('reports profile-only evidence honestly when no page could be read', () => {
    const snapshot = buildGeoEvidenceSnapshot(input({ pages: [] }));

    expect(snapshot.sufficiency).toBe('profile-only');
    expect(snapshot.limits.join(' ')).toContain('No public page text could be read');
  });

  it('reports insufficient evidence when the scan read nothing at all', () => {
    const snapshot = buildGeoEvidenceSnapshot(input({ profile: {}, pages: [] }));

    expect(snapshot.sources).toEqual([]);
    expect(snapshot.sufficiency).toBe('insufficient');
    // A snapshot with no sources still states what it cannot show, so a caller
    // reading only `limits` is not left thinking the site was checked.
    expect(snapshot.limits.length).toBeGreaterThan(0);
  });

  // A profile that was never filled in still carries the defaults the launch
  // screen sets. "Primary language: uk" is a setting for the audit, not a fact
  // about the business: it can neither support nor contradict a description,
  // and a snapshot holding only that was being judged against as `profile-only`.
  it('treats a language-only profile with no crawl as nothing to judge against', () => {
    const snapshot = buildGeoEvidenceSnapshot(
      input({
        profile: { language: 'uk', targetLanguages: 'Ukrainian, English' },
        pages: [],
      }),
    );

    expect(snapshot.sufficiency).toBe('insufficient');
    expect(snapshot.limits.join(' ')).toContain('Nothing about this business could be read');
  });

  it('keeps a profile that does say something about the business', () => {
    const withRegion = buildGeoEvidenceSnapshot(
      input({ profile: { language: 'uk', region: 'Kyiv' }, pages: [] }),
    );
    const withBrand = buildGeoEvidenceSnapshot(
      input({ profile: { language: 'uk', brand: 'Smile Clinic' }, pages: [] }),
    );

    expect(withRegion.sufficiency).toBe('profile-only');
    expect(withBrand.sufficiency).toBe('profile-only');
    // The language field is still evidence the judge may read; it is simply not
    // enough on its own for the snapshot to be worth judging against.
    expect(withRegion.sources.map((source) => source.label)).toContain('Primary language');
  });

  it('does not count a hostname-shaped brand as a substantive profile field', () => {
    const snapshot = buildGeoEvidenceSnapshot(
      input({
        brandIsHostname: true,
        profile: { brand: 'smile.example', language: 'uk' },
        pages: [],
      }),
    );

    expect(snapshot.sufficiency).toBe('insufficient');
  });

  it('bounds page excerpts where they are built, not where they are sent', () => {
    const snapshot = buildGeoEvidenceSnapshot(
      input({
        pages: [{ url: 'https://smile.example/', visibleText: 'x'.repeat(5_000) }],
      }),
    );

    const page = snapshot.sources.find((source) => source.kind === 'page');
    expect([...(page?.excerpt ?? '')]).toHaveLength(700);
    expect(page?.excerpt.endsWith('…')).toBe(true);
  });

  // The excerpt was capped and the same untrusted title was then copied into
  // the label whole, so a page titled with 40,000 characters pushed every
  // evaluation of that scan past the input cap — with two-line excerpts.
  it('bounds the label a page and its JSON-LD are listed under', () => {
    const snapshot = buildGeoEvidenceSnapshot(
      input({
        pages: [
          {
            url: 'https://smile.example/',
            title: 'Smile '.repeat(5_000),
            visibleText: 'We place implants and see emergency patients in Kyiv.',
            structuredData: ['@type=Dentist; name=Smile Clinic; areaServed=Kyiv'],
          },
        ],
      }),
    );

    const page = snapshot.sources.find((source) => source.kind === 'page');
    const structured = snapshot.sources.find((source) => source.kind === 'structured-data');
    expect([...(page?.label ?? '')]).toHaveLength(120);
    expect([...(structured?.label ?? '')]).toHaveLength(120);
    expect(page?.label.endsWith('…')).toBe(true);
    // The address is provenance, not quoted text: it stays whole so the link works.
    expect(page?.url).toBe('https://smile.example/');
  });

  it('bounds the address a title-less page falls back to, and keeps the link whole', () => {
    const url = `https://smile.example/${'implants/'.repeat(500)}`;
    const snapshot = buildGeoEvidenceSnapshot(
      input({ pages: [{ url, visibleText: 'We place implants in Kyiv.' }] }),
    );

    const page = snapshot.sources.find((source) => source.kind === 'page');
    expect([...(page?.label ?? '')]).toHaveLength(120);
    expect(page?.url).toBe(url);
  });

  it('cuts a label on a code-point boundary, never inside a character', () => {
    const snapshot = buildGeoEvidenceSnapshot(
      input({
        pages: [
          { url: 'https://smile.example/', title: '🦷'.repeat(500), visibleText: 'Implants.' },
        ],
      }),
    );

    const label = snapshot.sources.find((source) => source.kind === 'page')?.label ?? '';
    expect([...label]).toHaveLength(120);
    expect(label).toBe(`${'🦷'.repeat(119)}…`);
  });

  it('caps how many pages may contribute, in crawl order', () => {
    const snapshot = buildGeoEvidenceSnapshot(
      input({
        pages: Array.from({ length: 9 }, (_, index) => ({
          url: `https://smile.example/page-${index}`,
          visibleText: `Page ${index} text`,
        })),
      }),
    );

    const pages = snapshot.sources.filter((source) => source.kind === 'page');
    expect(pages).toHaveLength(6);
    expect(pages[0]?.url).toBe('https://smile.example/page-0');
  });

  it('is frozen, so every evaluator of a scan is handed the same evidence', () => {
    const snapshot = buildGeoEvidenceSnapshot(input());

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.sources)).toBe(true);
    expect(() => {
      (snapshot.sources as unknown as { push: (value: unknown) => void }).push({});
    }).toThrow();
  });

  it('renders every source with the id an evaluator has to cite', () => {
    const snapshot = buildGeoEvidenceSnapshot(input());
    const rendered = renderGeoEvidence(snapshot).join('\n');

    for (const source of snapshot.sources) {
      expect(rendered).toContain(`id=${source.id}`);
      expect(evidenceSourceById(snapshot, source.id)).toBe(source);
    }
    expect(evidenceSourceById(snapshot, 'page-99')).toBeNull();
  });
});
