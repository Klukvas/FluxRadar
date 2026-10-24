import { describe, expect, it } from 'vitest';

import { runModuleRules } from '../engine/run-module.js';
import type { SiteContext } from '../engine/types.js';
import { renderFindingMessage } from '../messages/index.js';
import { addressTextKey, localFacts, schemaNodes } from '../shared/local-business.js';
import { FIXTURE_ORIGIN, runRule, siteContext } from '../testing/fixture-harness.js';

const prose =
  '<p>Our team provides detailed information about services, people and appointments for visitors to make an informed decision.</p>';
const id = `${FIXTURE_ORIGIN}/#clinic`;
const business = (changes: Readonly<Record<string, unknown>> = {}) => ({
  '@context': 'https://schema.org',
  '@type': 'Dentist',
  '@id': id,
  url: FIXTURE_ORIGIN,
  name: 'Example Dental',
  address: { '@type': 'PostalAddress', streetAddress: '12 Main Street', addressLocality: 'Kyiv' },
  telephone: '+380 44 123 45 67',
  openingHours: 'Mo-Fr 09:00-18:00',
  geo: { '@type': 'GeoCoordinates', latitude: 0, longitude: '30.52' },
  ...changes,
});
const html = (schema: unknown, body = prose, lang = 'en') =>
  `<html lang="${lang}"><head><title>Clinic details</title><script type="application/ld+json">${JSON.stringify(schema)}</script></head><body>${body}</body></html>`;
const page = (path: string, schema: unknown, body = prose, lang = 'en') => ({
  path,
  html: html(schema, body, lang),
});
const run = (id: string, ctx: SiteContext) =>
  runRule(id.startsWith('CONTENT') ? 'Content Quality' : 'SEO', id, ctx);

describe('local business schema observations', () => {
  it('accepts a complete Dentist including zero latitude and overnight hours', () => {
    const ctx = siteContext({
      pages: [
        page(
          '/',
          business({
            openingHours: undefined,
            openingHoursSpecification: {
              '@type': 'OpeningHoursSpecification',
              dayOfWeek: 'Monday',
              opens: '20:00',
              closes: '02:00',
            },
          }),
        ),
      ],
    });
    expect(run('SEO-STRUCT-003', ctx)).toEqual([]);
  });

  it('traverses graph/type arrays/full type URLs and resolves PostalAddress/geo references', () => {
    const ctx = siteContext({
      pages: [
        page('/', {
          '@context': 'https://schema.org',
          '@graph': [
            business({
              '@type': ['https://schema.org/LocalBusiness', 'https://schema.org/Dentist'],
              address: { '@id': '#address' },
              geo: { '@id': '#geo' },
            }),
            {
              '@id': '#address',
              '@type': 'PostalAddress',
              streetAddress: '12 Main Street',
              addressLocality: 'Kyiv',
            },
            { '@id': '#geo', '@type': 'GeoCoordinates', latitude: 50.45, longitude: 30.52 },
          ],
        }),
      ],
    });
    expect(run('SEO-STRUCT-003', ctx)).toEqual([]);
    const snapshot = ctx.crawl.pages[0];
    expect(
      snapshot && schemaNodes(snapshot).some((node) => node['streetAddress'] === '12 Main Street'),
    ).toBe(true);
  });

  it('distinguishes required fields from recommended telephone/hours/geo', () => {
    const ctx = siteContext({
      pages: [
        page(
          '/',
          business({
            name: '',
            address: null,
            telephone: {},
            openingHours: '',
            openingHoursSpecification: { '@type': 'OpeningHoursSpecification' },
            geo: { latitude: true, longitude: 190 },
          }),
        ),
      ],
    });
    const finding = run('SEO-STRUCT-003', ctx)[0];
    expect(finding?.messages?.evidence.params['required']).toContain('name');
    expect(finding?.messages?.evidence.params['required']).toContain('address');
    expect(finding?.messages?.evidence.params['recommended']).toContain('telephone');
    expect(finding?.messages?.evidence.params['recommended']).toContain('openingHours');
    expect(finding?.messages?.evidence.params['recommended']).toContain('geo');
    expect(finding?.severity).toBeNull();
    expect(finding?.scoreDelta).toBe('informational');
  });

  it('offers missing-schema advice only for an explicit readable local contact page', () => {
    const contacts = `<h1>Contacts</h1><address>12 Main Street, Kyiv</address><a href="tel:+380441234567">Call</a>${prose}`;
    expect(
      run('SEO-STRUCT-003', siteContext({ pages: [page('/contact', {}, contacts)] })),
    ).toHaveLength(1);
    expect(run('SEO-STRUCT-003', siteContext({ pages: [page('/article', {}, prose)] }))).toEqual(
      [],
    );
    expect(
      run('SEO-STRUCT-003', siteContext({ pages: [page('/contact', {}, '<div id="app"></div>')] })),
    ).toEqual([]);
  });

  it('does not require local markup on an ordinary Organization', () => {
    expect(
      run(
        'SEO-STRUCT-003',
        siteContext({
          pages: [page('/', { '@type': 'Organization', name: 'Remote software company' })],
        }),
      ),
    ).toEqual([]);
  });

  it('does not invent a specific medical subtype from text when an existing type is broad', () => {
    expect(
      run(
        'SEO-STRUCT-003',
        siteContext({
          pages: [page('/', business({ '@type': 'LocalBusiness' }), `<h1>Dentist</h1>${prose}`)],
        }),
      ),
    ).toEqual([]);
  });

  it('flags own-site review markup informationally; absent ratings never fail', () => {
    const marked = siteContext({
      pages: [
        page(
          '/',
          business({
            aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.9, reviewCount: 120 },
          }),
        ),
      ],
    });
    const finding = run('SEO-STRUCT-004', marked)[0];
    expect(finding?.evidenceExcerpt).toContain('ineligible');
    expect(finding?.recommendation).toContain('do not add');
    expect(finding?.scoreDelta).toBe('informational');
    expect(run('SEO-STRUCT-004', siteContext({ pages: [page('/', business())] }))).toEqual([]);
    expect(
      run(
        'SEO-STRUCT-004',
        siteContext({
          pages: [
            page(
              '/',
              business({ url: 'https://other.test/', aggregateRating: { ratingValue: 5 } }),
            ),
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe('local NAP observations', () => {
  it('normalizes address ordering/abbreviations and overlapping formatted phone sets', () => {
    expect(addressTextKey('12 Main Street, Kyiv')).toBe(addressTextKey('Kyiv, Main St. 12'));
    const ctx = siteContext({
      pages: [
        page('/', business({ telephone: ['+380 (44) 123-45-67', '+380441112233'] })),
        page(
          '/details',
          business({
            address: { streetAddress: 'Main St. 12', addressLocality: 'Kyiv' },
            telephone: ['0441234567;ext=10', '+380449998877'],
          }),
        ),
      ],
    });
    expect(run('SEO-ADV-001', ctx)).toEqual([]);
  });

  it('records a same-location phone difference and its actual dependency', () => {
    const ctx = siteContext({
      pages: [page('/', business()), page('/details', business({ telephone: '+380449998877' }))],
    });
    const findings = run('SEO-ADV-001', ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.messages?.evidence.params['field']).toBe('telephone');
    expect(findings[0]?.dependencyTargets).toEqual([`${FIXTURE_ORIGIN}/`]);
  });

  it('checks N and A only when shared identity/language and concrete location anchor agree', () => {
    const names = siteContext({
      pages: [page('/', business()), page('/name', business({ name: 'Other Dental' }))],
    });
    expect(run('SEO-ADV-001', names)[0]?.messages?.evidence.params['field']).toBe('name');
    const addresses = siteContext({
      pages: [
        page('/', business()),
        page(
          '/address',
          business({ address: { streetAddress: '99 Main Street', addressLocality: 'Kyiv' } }),
        ),
      ],
    });
    expect(run('SEO-ADV-001', addresses)[0]?.messages?.evidence.params['field']).toBe('address');
  });

  it('does not conflate branch ids, multilingual identities or unanchored footer phones', () => {
    const ctx = siteContext({
      pages: [
        page(
          '/',
          business(),
          `<footer><a href="tel:+380449998877">Branch phone</a></footer>${prose}`,
        ),
        page(
          '/branch',
          business({
            '@id': '#branch',
            name: 'Example Dental',
            telephone: '+380449998877',
            address: { streetAddress: '99 Main Street', addressLocality: 'Kyiv' },
          }),
        ),
        page(
          '/uk',
          business({ name: 'Стоматологія Приклад', telephone: '+380449998877' }),
          prose,
          'uk',
        ),
      ],
    });
    expect(run('SEO-ADV-001', ctx)).toEqual([]);
  });

  it('connects ordinary footer HTML only through a unique matching name and address', () => {
    const footer = `<footer><b>Example Dental</b><address>Kyiv, Main St. 12</address><a href="tel:+380449998877">+380 44 999 88 77</a></footer>${prose}`;
    const findings = run('SEO-ADV-001', siteContext({ pages: [page('/', business(), footer)] }));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.messages?.evidence.params['field']).toBe('telephone');
  });

  it('reports contact hours and tel links with distinct fingerprints and localized evidence', () => {
    const body = `<h1>Contacts</h1><address>12 Main Street, Kyiv</address><p>Telephone +380 44 123 45 67</p>${prose}`;
    const findings = run(
      'SEO-ADV-001',
      siteContext({ pages: [page('/contact', business(), body)] }),
    );
    expect(findings.map((finding) => finding.messages?.evidence.code)).toEqual([
      'seo-adv-001.evidence.hours',
      'seo-adv-001.evidence.clickable',
    ]);
    expect(new Set(findings.map((finding) => finding.fingerprint)).size).toBe(2);
    for (const finding of findings) {
      expect(finding.messages && renderFindingMessage(finding.messages.evidence, 'uk')).toMatch(
        /контакт/,
      );
    }
  });

  it('does not manufacture absence or resolution proof for an incomplete crawl', () => {
    const ctx = siteContext({ pages: [page('/contact', business(), `<h1>Contacts</h1>${prose}`)] });
    const incomplete = {
      ...ctx,
      crawl: { ...ctx.crawl, skippedOverLimit: [`${FIXTURE_ORIGIN}/more`] },
    };
    expect(run('SEO-ADV-001', incomplete)).toEqual([]);
    const evaluation = runModuleRules('SEO', incomplete).evaluations.find(
      (item) => item.ruleId === 'SEO-ADV-001',
    );
    expect(evaluation?.checkedTargets).toEqual([]);
    expect(evaluation?.inputTargets).toEqual([`${FIXTURE_ORIGIN}/contact`]);
  });
});

describe('article and medical transparency', () => {
  it('accepts author OR reviewer and publication date without requiring an update date', () => {
    for (const person of [
      { author: [{ '@type': 'Person', name: 'Jane Doe' }] },
      { reviewedBy: { '@id': '#doctor' } },
    ]) {
      const graph = {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'BlogPosting', datePublished: '2026-10-01', ...person },
          { '@id': '#doctor', '@type': 'Person', name: 'Dr Jane Doe' },
        ],
      };
      expect(
        run(
          'CONTENT-008',
          siteContext({
            pages: [page('/blog/a', graph, `<article><h1>Advice</h1>${prose}</article>`)],
          }),
        ),
      ).toEqual([]);
    }
  });

  it('accepts visible reviewed-by text and time/meta article dates', () => {
    const body = `<article><h1>Advice</h1><p>Medically reviewed by Dr Jane Doe</p><time datetime="2026-10-01">October 1</time>${prose}</article>`;
    expect(run('CONTENT-008', siteContext({ pages: [page('/advice', {}, body)] }))).toEqual([]);
  });

  it('accepts ordinary readable dates without a datetime attribute', () => {
    for (const date of ['21 October 2026', '21.10.2026']) {
      const body = `<article><h1>Advice</h1><p class="author">Jane Smith</p><time>${date}</time>${prose}</article>`;
      expect(run('CONTENT-008', siteContext({ pages: [page('/blog/date', {}, body)] }))).toEqual(
        [],
      );
    }
  });

  it('recognizes a named team profile with its doctor role in body text', () => {
    const ctx = siteContext({
      pages: [
        page('/', business()),
        page(
          '/team/jane',
          {},
          `<h1>Jane Smith</h1><p>Dentist. Education: Medical University.</p>${prose}`,
        ),
      ],
    });
    const codes = run('CONTENT-012', ctx).map((finding) => finding.messages?.evidence.code);
    expect(codes).not.toContain('content-012.evidence.profiles');
    expect(codes).not.toContain('content-012.evidence.qualifications');
  });

  it('reports separate actionable missing article author/date findings', () => {
    const findings = run(
      'CONTENT-008',
      siteContext({
        pages: [page('/blog/a', { '@type': 'Article' }, `<article>${prose}</article>`)],
      }),
    );
    expect(findings.map((finding) => finding.messages?.evidence.code)).toEqual([
      'content-008.evidence.attribution',
      'content-008.evidence.published',
    ]);
    expect(new Set(findings.map((finding) => finding.fingerprint)).size).toBe(2);
  });

  it('ignores service/contact pages even when their theme wraps content in article', () => {
    const ctx = siteContext({
      pages: [
        page('/service', business(), `<article><h1>Dental services</h1>${prose}</article>`),
        page('/contact', {}, `<article><h1>Contacts</h1>${prose}</article>`),
      ],
    });
    expect(run('CONTENT-008', ctx)).toEqual([]);
  });

  it('does not mistake medical article vocabulary for a medical business', () => {
    expect(
      run(
        'CONTENT-012',
        siteContext({
          pages: [page('/news', { '@type': 'Article' }, `<h1>Dentist interviews</h1>${prose}`)],
        }),
      ),
    ).toEqual([]);
  });

  it('reports license not observed without asserting invalidity or missing qualifications truth', () => {
    const ctx = siteContext({ pages: [page('/', business())] });
    const findings = run('CONTENT-012', ctx);
    expect(findings).toHaveLength(5);
    expect(
      findings.find((finding) => finding.messages?.evidence.code === 'content-012.evidence.license')
        ?.evidenceExcerpt,
    ).toContain('does not establish');
    expect(findings.every((finding) => finding.scoreDelta === 'informational')).toBe(true);
    expect(findings[0]?.dependencyTargets).toEqual([`${FIXTURE_ORIGIN}/`]);
  });

  it('recognizes doctor profile/qualifications, about, contacts and license evidence', () => {
    const ctx = siteContext({
      pages: [
        page('/', business()),
        page(
          '/doctors/jane',
          {
            '@type': 'Person',
            name: 'Dr Jane Doe',
            jobTitle: 'Dentist',
            alumniOf: { name: 'Medical University' },
          },
          `<h1>Dr Jane Doe, dentist</h1><p>Education: Medical University; DDS qualification.</p>${prose}`,
        ),
        page(
          '/about',
          { '@type': 'AboutPage' },
          `<h1>About the clinic</h1><p>License number 123456</p>${prose}`,
        ),
        page(
          '/contact',
          {},
          `<h1>Contacts</h1><address>12 Main Street, Kyiv</address><a href="tel:+380441234567">Call</a>${prose}`,
        ),
      ],
    });
    expect(run('CONTENT-012', ctx)).toEqual([]);
  });

  it('suppresses medical absence findings when any crawl page is unreadable, stopped or missing', () => {
    const ctx = siteContext({ pages: [page('/', business())] });
    const first = ctx.crawl.pages[0];
    if (first === undefined) throw new Error('Fixture requires a page');
    for (const patch of [
      { stoppedEarly: true },
      { skippedOverLimit: [`${FIXTURE_ORIGIN}/doctors`] },
      {
        pages: [
          ...ctx.crawl.pages,
          {
            ...first,
            normalizedUrl: `${FIXTURE_ORIGIN}/shell`,
            finalUrl: `${FIXTURE_ORIGIN}/shell`,
            html: '<div id="app"></div>',
          },
        ],
      },
    ]) {
      expect(run('CONTENT-012', { ...ctx, crawl: { ...ctx.crawl, ...patch } })).toEqual([]);
    }
  });
});

describe('independent QA regressions', () => {
  it('does not trust site-wide OG article metadata on contact, about, doctor or listing surfaces', () => {
    const surfaces = [
      ['/kontakty/', 'Контакти'],
      ['/about-uk/', 'Про клініку'],
      ['/likari/', 'Наші лікарі'],
      ['/doctor/jane/', 'Jane Doe'],
      ['/statti/', 'Статті'],
    ] as const;
    for (const [path, heading] of surfaces) {
      const source = html(
        {
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'WebPage',
              url: `${FIXTURE_ORIGIN}${path}`,
              datePublished: '2020-04-13T18:22:15+00:00',
            },
            { '@type': 'Organization', name: 'Example Dental' },
          ],
        },
        `<main><h1>${heading}</h1>${prose}</main>`,
      ).replace(
        '</head>',
        '<meta property="og:type" content="article"><meta property="article:modified_time" content="2024-02-01T15:16:30+00:00"></head>',
      );
      expect(run('CONTENT-008', siteContext({ pages: [{ path, html: source }] }))).toEqual([]);
    }
  });

  it('keeps explicit primary Article stronger than generic WebPage and listing hints', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', url: `${FIXTURE_ORIGIN}/blog/` },
        {
          '@type': 'Article',
          url: `${FIXTURE_ORIGIN}/blog/`,
          author: { '@type': 'Person', name: 'Jane Doe' },
          datePublished: '2026-10-21',
        },
      ],
    };
    const ctx = siteContext({ pages: [page('/blog/', schema)] });
    const evaluation = runModuleRules('Content Quality', ctx).evaluations.find(
      (entry) => entry.ruleId === 'CONTENT-008',
    );
    expect(evaluation?.applicableTargets).toBe(1);
    expect(evaluation?.findings).toEqual([]);
  });

  it('keeps explicitly authored and published primary DOM articles stronger than URL hints', () => {
    const body = `<article><h1>Clinical research</h1><p>By Jane Doe</p><p>Published on 21 October 2026</p>${prose}</article>`;
    const ctx = siteContext({ pages: [page('/services/research', { '@type': 'WebPage' }, body)] });
    const evaluation = runModuleRules('Content Quality', ctx).evaluations.find(
      (entry) => entry.ruleId === 'CONTENT-008',
    );
    expect(evaluation?.applicableTargets).toBe(1);
    expect(evaluation?.findings).toEqual([]);
  });

  it('recognizes an ordinary city/street/building paragraph on an explicit Ukrainian contact page', () => {
    const body = `<main><h1>Контакти</h1><p>м. Київ, вул. Антоновича (Горького) 47,<br>2-й поверх</p><a href="tel:+380441234567">+380 44 123 45 67</a>${prose}</main>`;
    const ctx = siteContext({ pages: [page('/kontakty/', { '@type': 'WebPage' }, body, 'uk')] });
    expect(localFacts(ctx).pages[0]?.visibleLocal).toBe(true);
    expect(run('SEO-STRUCT-003', ctx)[0]?.messages?.evidence.code).toBe(
      'seo-struct-003.evidence.missing',
    );
    expect(
      run('SEO-ADV-001', ctx).some(
        (finding) => finding.messages?.evidence.code === 'seo-adv-001.evidence.address',
      ),
    ).toBe(false);
    const partial = {
      ...ctx,
      crawl: { ...ctx.crawl, skippedOverLimit: [`${FIXTURE_ORIGIN}/more`] },
    };
    expect(run('SEO-STRUCT-003', partial)).toHaveLength(1);
    expect(run('CONTENT-012', partial)).toEqual([]);
    expect(run('SEO-ADV-001', partial)).toEqual([]);
  });

  it('does not turn an unlabeled address in generic article prose into local business evidence', () => {
    const body = `<article><h1>Travel advice</h1><p>м. Київ, вул. Антоновича 47</p><a href="tel:+380441234567">Call</a>${prose}</article>`;
    const ctx = siteContext({ pages: [page('/advice', { '@type': 'Article' }, body)] });
    expect(localFacts(ctx).pages[0]?.visibleLocal).toBe(false);
    expect(run('SEO-STRUCT-003', ctx)).toEqual([]);
  });

  it('withholds site-wide absence and resolution proof when an in-scope doctor page answers 503', () => {
    const ctx = siteContext({
      pages: [page('/', business()), { ...page('/doctors/jane', {}, prose), status: 503 }],
    });
    expect(run('CONTENT-012', ctx)).toEqual([]);
    for (const module of ['SEO', 'Content Quality'] as const) {
      const result = runModuleRules(module, ctx);
      for (const id of ['SEO-ADV-001', 'SEO-STRUCT-003', 'SEO-STRUCT-004', 'CONTENT-012']) {
        const evaluated = result.evaluations.find((entry) => entry.ruleId === id);
        if (evaluated !== undefined) expect(evaluated.checkedTargets).toEqual([]);
      }
    }
  });

  it('checks an inline Article explicitly assigned as the current WebPage mainEntity', () => {
    const ctx = siteContext({
      pages: [
        page('/advice', {
          '@type': 'WebPage',
          url: `${FIXTURE_ORIGIN}/advice`,
          mainEntity: { '@type': 'Article', url: `${FIXTURE_ORIGIN}/advice` },
        }),
      ],
    });
    expect(run('CONTENT-008', ctx).map((finding) => finding.messages?.evidence.code)).toEqual([
      'content-008.evidence.attribution',
      'content-008.evidence.published',
    ]);
  });

  it('resolves the current WebPage mainEntity @id without treating related articles as primary', () => {
    const ctx = siteContext({
      pages: [
        page('/advice', {
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'WebPage',
              '@id': '#page',
              url: `${FIXTURE_ORIGIN}/advice`,
              mainEntity: { '@id': '#article' },
            },
            {
              '@type': 'ItemList',
              itemListElement: [
                { '@type': 'Article', '@id': '#article', url: `${FIXTURE_ORIGIN}/advice` },
              ],
            },
          ],
        }),
      ],
    });
    expect(run('CONTENT-008', ctx)).toHaveLength(2);
  });

  it('accepts an explicit mainEntityOfPage relation while ignoring unrelated nested articles', () => {
    const ctx = siteContext({
      pages: [
        page('/advice', {
          '@type': 'ItemList',
          itemListElement: [
            {
              '@type': 'Article',
              '@id': '#article',
              mainEntityOfPage: { '@id': `${FIXTURE_ORIGIN}/advice` },
            },
            { '@type': 'Article', url: `${FIXTURE_ORIGIN}/related` },
          ],
        }),
      ],
    });
    expect(run('CONTENT-008', ctx)).toHaveLength(2);
  });

  it('does not treat dated blog index cards as the primary article', () => {
    const body = `<main><h1>Blog</h1><article><h2>First article</h2><p>By Jane Doe</p><time datetime="2026-10-21">21 October 2026</time></article><article><h2>Second article</h2><time datetime="2026-10-20">20 October 2026</time></article>${prose}</main>`;
    expect(run('CONTENT-008', siteContext({ pages: [page('/blog', {}, body)] }))).toEqual([]);
  });

  it('does not treat service appointment dates as article publication metadata', () => {
    const body = `<article><h1>Dental cleaning</h1><p>Book your appointment for <time datetime="2026-10-21">21 October 2026</time>.</p>${prose}</article>`;
    expect(
      run('CONTENT-008', siteContext({ pages: [page('/services/cleaning', {}, body)] })),
    ).toEqual([]);
  });

  it('bounds deep valid JSON without crashing or treating discarded schema as absent', () => {
    const deep = '{"x":'.repeat(3000) + '{}' + '}'.repeat(3000);
    const body = `<h1>Contacts</h1><address>12 Main Street, Kyiv</address><a href="tel:+380441234567">Call</a>${prose}`;
    const source = html({}, body).replace(
      '<script type="application/ld+json">{}</script>',
      `<script type="application/ld+json">${deep}</script>`,
    );
    const ctx = siteContext({ pages: [{ path: '/contact', html: source }] });
    expect(() => runModuleRules('SEO', ctx)).not.toThrow();
    expect(run('SEO-STRUCT-003', ctx)).toEqual([]);
    expect(run('SEO-ADV-001', ctx)).toEqual([]);
    expect(
      runModuleRules('SEO', ctx).evaluations.find((item) => item.ruleId === 'SEO-ADV-001')
        ?.checkedTargets,
    ).toEqual([]);
  });

  it('compares ordinary contacts on another page with an unambiguous schema identity', () => {
    const body = `<h1>Contacts</h1><p>Example Dental</p><address>12 Main Street, Kyiv</address><a href="tel:+380449998877">Call</a><p>Monday–Friday 09:00–18:00</p>${prose}`;
    const ctx = siteContext({ pages: [page('/', business()), page('/contact', {}, body)] });
    const findings = run('SEO-ADV-001', ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.messages?.evidence.params['field']).toBe('telephone');
    expect(findings[0]?.normalizedUrl).toBe(`${FIXTURE_ORIGIN}/contact`);
    expect(findings[0]?.dependencyTargets).toEqual([`${FIXTURE_ORIGIN}/`]);
    const partial = {
      ...ctx,
      crawl: { ...ctx.crawl, skippedOverLimit: [`${FIXTURE_ORIGIN}/more`] },
    };
    expect(
      runModuleRules('SEO', partial).evaluations.find((item) => item.ruleId === 'SEO-ADV-001')
        ?.checkedTargets,
    ).toEqual([]);
  });

  it('accepts labeled ordinary address, full weekdays and case-insensitive telephone scheme', () => {
    const body = `<h1>Contacts</h1><p>Example Dental</p><p>Address:12 Main Street, Kyiv</p><a href="TEL:+380441234567">Call</a><p>Monday–Friday 09:00–18:00</p>${prose}`;
    const ctx = siteContext({ pages: [page('/contact', business(), body)] });
    expect(run('SEO-ADV-001', ctx)).toEqual([]);
  });

  it('accepts article-scoped author and publication labels in ordinary paragraphs', () => {
    const body = `<article><h1>Advice</h1><p>By Jane Doe</p><p>Published on 21 October 2026</p>${prose}</article>`;
    expect(
      run('CONTENT-008', siteContext({ pages: [page('/advice', { '@type': 'Article' }, body)] })),
    ).toEqual([]);
  });

  it('does not count an Updated time as a publication date', () => {
    const body = `<article><h1>Advice</h1><p>By Jane Doe</p><p>Updated: <time datetime="2026-10-21">21 October 2026</time></p>${prose}</article>`;
    const findings = run(
      'CONTENT-008',
      siteContext({ pages: [page('/advice', { '@type': 'Article' }, body)] }),
    );
    expect(findings.map((finding) => finding.messages?.evidence.code)).toEqual([
      'content-008.evidence.published',
    ]);
  });

  it('does not treat education as proof of a medical role', () => {
    const ctx = siteContext({
      pages: [
        page('/', business()),
        page('/team/manager', {
          '@type': 'Person',
          name: 'Jane Smith',
          jobTitle: 'Office manager',
          alumniOf: { name: 'Business School' },
        }),
      ],
    });
    const codes = run('CONTENT-012', ctx).map((finding) => finding.messages?.evidence.code);
    expect(codes).toContain('content-012.evidence.profiles');
    expect(codes).toContain('content-012.evidence.qualifications');
  });

  it('requires structured physical address components rather than any nonempty string', () => {
    const finding = run(
      'SEO-STRUCT-003',
      siteContext({ pages: [page('/', business({ address: 'not a physical address' }))] }),
    )[0];
    expect(finding?.messages?.evidence.params['required']).toContain('address');
  });

  it('accepts reversed primary names and declared alternateName aliases', () => {
    const ctx = siteContext({
      pages: [
        page('/', business({ name: 'Example Dental', alternateName: 'Example Dentistry' })),
        page('/details', business({ name: 'Example Dentistry', alternateName: 'Example Dental' })),
      ],
    });
    expect(run('SEO-ADV-001', ctx)).toEqual([]);
  });

  it('does not mistake a postcode in a string address for a changed building number', () => {
    const ctx = siteContext({
      pages: [
        page('/', business()),
        page('/details', business({ address: '01001 Kyiv, 12 Main Street' })),
      ],
    });
    expect(
      run('SEO-ADV-001', ctx).filter(
        (finding) => finding.messages?.evidence.params['field'] === 'address',
      ),
    ).toEqual([]);
  });

  it('does not apply article metadata checks to nested related/list articles', () => {
    const ctx = siteContext({
      pages: [
        page('/blog', {
          '@type': 'ItemList',
          itemListElement: [{ '@type': 'BlogPosting', url: `${FIXTURE_ORIGIN}/blog/related` }],
        }),
      ],
    });
    expect(run('CONTENT-008', ctx)).toEqual([]);
    const direct = siteContext({
      pages: [
        page('/advice', {
          '@context': 'https://schema.org',
          '@graph': [{ '@type': 'Article', '@id': '#article' }],
        }),
      ],
    });
    expect(run('CONTENT-008', direct)).toHaveLength(2);
  });

  it('ignores template author metadata on contact, about and service article wrappers', () => {
    for (const [path, type] of [
      ['/contact', 'ContactPage'],
      ['/about', 'AboutPage'],
      ['/services/cleaning', 'Service'],
    ] as const) {
      const body = `<article><h1>Page details</h1>${prose}</article>`;
      const markup = html({ '@type': type }, body).replace(
        '</head>',
        '<meta name="author" content="Example Dental"></head>',
      );
      expect(run('CONTENT-008', siteContext({ pages: [{ path, html: markup }] }))).toEqual([]);
    }
  });

  it('does not borrow primary article attribution or publication from related articles', () => {
    const related =
      '<article><h2>Related advice</h2><p class="author">Jane Doe</p><time datetime="2026-10-21">21 October 2026</time></article>';
    for (const body of [
      `<main><article><h1>Advice</h1>${prose}</article><aside>${related}</aside></main>`,
      `<main><article><h1>Advice</h1>${prose}${related}</article></main>`,
      `<main><article><h1>Advice</h1>${prose}</article>${related}</main>`,
    ]) {
      const ctx = siteContext({ pages: [page('/advice', { '@type': 'Article' }, body)] });
      expect(run('CONTENT-008', ctx)).toHaveLength(2);
    }
  });

  it('withholds medical absence and closure for chrome-only empty application shells', () => {
    const shell = `<nav>${'Services doctors contacts clinic information '.repeat(4)}</nav><div id="app"></div><script src="/app.js"></script>`;
    const ctx = siteContext({ pages: [page('/', business()), page('/doctors/jane', {}, shell)] });
    expect(localFacts(ctx).complete).toBe(false);
    expect(run('CONTENT-012', ctx)).toEqual([]);
    const evaluated = runModuleRules('Content Quality', ctx).evaluations.find(
      (entry) => entry.ruleId === 'CONTENT-012',
    );
    expect(evaluated?.checkedTargets).toEqual([]);
    const ssr = siteContext({
      pages: [page('/', business({ name: '' }), `${shell}<main>${prose}</main>`)],
    });
    expect(localFacts(ssr).complete).toBe(true);
    expect(run('SEO-STRUCT-003', ssr)).toHaveLength(1);
  });
});
