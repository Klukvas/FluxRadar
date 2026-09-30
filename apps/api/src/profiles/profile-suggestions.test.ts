// What profile autofill may propose, and what it must refuse to.
//
// The reported case is `flux-lab.dev`: the form came back with a description and
// nine "services" that were really its section labels and project code names —
// "Featured Projects, WashFlow, Why fluxLab?, Full Ownership" — while the three
// fields the page actually states in its JSON-LD (served market, languages) or
// states nowhere at all (business type, audience) stayed blank. The fixture below
// keeps that page's real markup shape so a regression shows up as this test.

import { describe, expect, it } from 'vitest';

import {
  extractProfileSuggestions,
  PROFILE_SUGGESTIONS_FETCH_OPTIONS,
} from './profile-suggestions.ts';

/** The reported homepage, trimmed to the elements the extraction reads. */
const STUDIO_HOMEPAGE = `
<!doctype html><html lang="en"><head>
<title>Software Development Company in Ukraine | fluxLab.dev</title>
<meta name="description" content="Kyiv product studio behind SaaS apps used by 46K+ people. Hire our senior React, Next.js and Go team: dedicated teams from $8K/month.">
<meta property="og:site_name" content="fluxLab.dev">
<meta property="og:locale" content="en_US">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'fluxLab.dev',
      url: 'https://flux-lab.dev',
      logo: { '@type': 'ImageObject', url: 'https://flux-lab.dev/logo.png' },
      description: 'Kyiv-based software development studio building production SaaS products.',
      address: { '@type': 'PostalAddress', addressLocality: 'Kyiv', addressCountry: 'UA' },
      areaServed: [
        { '@type': 'Country', name: 'United States' },
        { '@type': 'Country', name: 'Ukraine' },
      ],
      knowsAbout: [
        'Software Development Outsourcing',
        'Custom Software Development',
        'SaaS Development',
        'Dedicated Development Teams',
      ],
    },
    { '@type': 'WebSite', name: 'fluxLab.dev', inLanguage: ['en', 'uk'] },
  ],
})}</script>
</head><body><main>
<h1>Software development studio · Kyiv, Ukraine</h1>
<h2>Featured Projects</h2><h2>EFluxCom</h2><h2>WashFlow</h2><h2>Accounting</h2>
<h2>Why fluxLab?</h2>
<h3>Product Builders, Not Just Coders</h3><h3>Full Ownership</h3><h3>Battle-Tested Stack</h3>
<h2>Let's Talk About Your Project</h2><h3>How can we help?</h3>
</main></body></html>`;

describe('public profile suggestions', () => {
  it('proposes the served market and both published languages of the reported page', () => {
    expect(extractProfileSuggestions(STUDIO_HOMEPAGE)).toEqual({
      name: 'fluxLab.dev',
      businessDescription:
        'Kyiv product studio behind SaaS apps used by 46K+ people. Hire our senior React, Next.js and Go team: dedicated teams from $8K/month.',
      offerings:
        'Software Development Outsourcing, Custom Software Development, SaaS Development, Dedicated Development Teams',
      region: 'United States, Ukraine',
      targetLanguages: 'en, uk',
    });
  });

  it('never proposes a marketing heading or a project name as a service', () => {
    const offerings = extractProfileSuggestions(STUDIO_HOMEPAGE).offerings ?? '';
    for (const heading of [
      'Featured Projects',
      'EFluxCom',
      'WashFlow',
      'Accounting',
      'Why fluxLab?',
      'Full Ownership',
      'Battle-Tested Stack',
      'How can we help?',
    ]) {
      expect(offerings).not.toContain(heading);
    }
  });

  it('leaves a business type and an audience the page never states empty', () => {
    const suggestions = extractProfileSuggestions(STUDIO_HOMEPAGE);
    expect(suggestions.industry).toBeUndefined();
    expect(suggestions.targetAudience).toBeUndefined();
  });

  it('keeps the rest of the proposal when a stated category has malformed encoding', () => {
    expect(
      extractProfileSuggestions(`<html lang="en"><head><title>Studio</title>
        <script type="application/ld+json">${JSON.stringify({
          '@type': 'Organization',
          category: 'Design%studio',
          areaServed: 'Europe',
        })}</script></head><body></body></html>`),
    ).toEqual({
      name: 'Studio',
      industry: 'Design%studio',
      region: 'Europe',
      targetLanguages: 'en',
    });
  });

  it('ignores category, market and audience declared by unrelated nested content', () => {
    expect(
      extractProfileSuggestions(`<html lang="en"><head><title>Publisher</title>
        <script type="application/ld+json">${JSON.stringify({
          '@type': 'Organization',
          name: 'Publisher',
          '@graph': [
            {
              '@type': 'Product',
              category: 'Irrelevant product category',
              areaServed: 'Mars',
              audience: { '@type': 'PeopleAudience', audienceType: 'Robots' },
              address: { '@type': 'PostalAddress', addressLocality: 'Moon base' },
              telephone: '+1-555-0100',
              logo: 'https://example.test/product-logo.png',
            },
          ],
        })}</script></head><body></body></html>`),
    ).toEqual({ name: 'Publisher', targetLanguages: 'en' });
  });

  it('prefers descriptive stated topics over one-word technologies in knowsAbout', () => {
    expect(
      extractProfileSuggestions(`<html><head><title>Studio</title>
        <script type="application/ld+json">${JSON.stringify({
          '@type': 'Organization',
          knowsAbout: [
            'Custom software development',
            'Dedicated teams',
            'React',
            'Go',
            'PostgreSQL',
          ],
        })}</script></head><body></body></html>`).offerings,
    ).toBe('Custom software development, Dedicated teams');
  });

  it('treats the office address as a location, not as the market it serves', () => {
    const suggestions = extractProfileSuggestions(STUDIO_HOMEPAGE);
    expect(suggestions.region).not.toContain('Kyiv');
    expect(
      extractProfileSuggestions(
        `<html><head><script type="application/ld+json">${JSON.stringify({
          '@type': 'Organization',
          name: 'Local shop',
          address: { '@type': 'PostalAddress', addressLocality: 'Kyiv', addressCountry: 'UA' },
        })}</script></head><body></body></html>`,
      ).region,
    ).toBeUndefined();
  });

  it('uses only visible homepage metadata and never invents region or audience', () => {
    expect(
      extractProfileSuggestions(`
        <html lang="uk-UA"><head><title>Clinic</title>
        <meta name="description" content="Care for local families"></head>
        <body><script>secret internal audience</script><main><h2>Our services</h2><h3>Dental implants</h3><h3>Emergency care</h3></main></body></html>
      `),
    ).toEqual({
      name: 'Clinic',
      businessDescription: 'Care for local families',
      offerings: 'Dental implants, Emergency care',
      targetLanguages: 'uk',
    });
  });

  it('reads a stated category, audience and offer catalogue where the page has them', () => {
    expect(
      extractProfileSuggestions(
        `<html lang="uk"><head><title>Clinic</title>
         <script type="application/ld+json">${JSON.stringify({
           '@type': 'Dentist',
           name: 'Bright Smile',
           address: { '@type': 'PostalAddress', addressLocality: 'Kyiv' },
           areaServed: 'Kyiv and Kyiv region',
           audience: { '@type': 'PeopleAudience', audienceType: 'Families with children' },
           hasOfferCatalog: {
             '@type': 'OfferCatalog',
             name: 'Services',
             itemListElement: [
               { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Dental implants' } },
               { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Teeth cleaning' } },
             ],
           },
         })}</script></head><body><h2>Why us?</h2></body></html>`,
      ),
    ).toEqual({
      name: 'Clinic',
      industry: 'Dentist',
      offerings: 'Dental implants, Teeth cleaning',
      region: 'Kyiv and Kyiv region',
      targetAudience: 'Families with children',
      targetLanguages: 'uk',
    });
  });

  it('keeps the single homepage read bounded', () => {
    expect(PROFILE_SUGGESTIONS_FETCH_OPTIONS).toEqual({
      method: 'GET',
      timeoutMs: 8_000,
      maxBodyBytes: 256 * 1024,
      maxRedirects: 3,
      headers: { 'user-agent': 'FluxRadarProfileAssistant/1.0' },
    });
  });

  it('bounds extracted text and ignores executable markup', () => {
    const oversized = 'x'.repeat(2_000);
    expect(
      extractProfileSuggestions(
        `<html><head><title>${oversized}</title><meta name="description" content="${oversized}"></head><body><script>hidden</script><h2>Services</h2><h3>${oversized}</h3></body></html>`,
      ),
    ).toEqual({
      name: 'x'.repeat(120),
      businessDescription: 'x'.repeat(800),
    });
  });

  it('survives structured metadata that is broken, hostile or enormous', () => {
    const suggestions = extractProfileSuggestions(
      `<html lang="en"><head><title>Survivor</title>
       <script type="application/ld+json">{ not json at all </script>
       <script type="application/ld+json">${JSON.stringify({
         '@type': 'Organization',
         areaServed: Array.from({ length: 200 }, (_value, index) => `Region ${index}`),
         knowsAbout: Array.from({ length: 200 }, (_value, index) => `Topic ${index}`),
       })}</script>
       <script type="application/ld+json">${JSON.stringify({
         '@type': 'Organization',
         name: 'y'.repeat(5_000),
         areaServed: 'z'.repeat(5_000),
       })}</script>
       </head><body></body></html>`,
    );
    expect(suggestions.name).toBe('Survivor');
    expect(suggestions.offerings?.split(', ')).toHaveLength(12);
    expect(suggestions.region?.split(', ')).toHaveLength(8);
    expect(suggestions.region?.length).toBeLessThanOrEqual(1_200);
    expect(suggestions.targetLanguages).toBe('en');
  });
});
