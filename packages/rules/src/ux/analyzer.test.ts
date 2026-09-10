import { describe, expect, it } from 'vitest';

import { analyzeUxStatic } from './analyzer.js';
import { htmlContext, siteContext } from '../testing/fixture-harness.js';

describe('analyzeUxStatic', () => {
  it('returns bounded, factual conversion evidence from HTML', () => {
    const evidence = analyzeUxStatic(
      htmlContext(
        '<html><head><title>Dental clinic</title></head><body>' +
          '<h1>Dental clinic in Kyiv</h1><a href="/book">Book an appointment</a>' +
          '<form action="/lead"><label>Name</label><input name="name" />' +
          '<button type="submit">Request a call</button></form>' +
          '<p>Care for your family.</p></body></html>',
      ),
    );

    expect(evidence.pages).toHaveLength(1);
    expect(evidence.pages[0]).toMatchObject({
      title: 'Dental clinic',
      headings: ['Dental clinic in Kyiv'],
      actions: ['Book an appointment', 'Request a call'],
      forms: ['form 1: 1 controls, 1 submit controls, action=/lead'],
      contactSignals: ['Book an appointment'],
    });
    expect(evidence.summary).toEqual({
      pagesAnalyzed: 1,
      pagesWithActions: 1,
      pagesWithForms: 1,
      pagesWithContactSignals: 1,
      pagesWithHeadings: 1,
    });
    expect(evidence.findings).toEqual([]);
    expect(evidence.limitation).toBe('static-html-only');
  });

  it('reports only factual entry-page and form friction signals', () => {
    const evidence = analyzeUxStatic(
      htmlContext(
        '<html><head><title>Clinic</title></head><body>' +
          '<p>Dental care information.</p>' +
          '<form action="/lead"><input name="name" /></form>' +
          '</body></html>',
      ),
    );

    expect(evidence.findings).toEqual([
      expect.objectContaining({
        ruleId: 'UX-CONV-STATIC-001',
        targetUrl: 'https://fixture.test/page.html',
        evidence: 'No h1 heading was present in the fetched entry-page HTML.',
      }),
      expect.objectContaining({
        ruleId: 'UX-CONV-STATIC-002',
        targetUrl: 'https://fixture.test/page.html',
        evidence:
          'No link, button, or button-like input was present in the fetched entry-page HTML.',
      }),
      expect.objectContaining({
        ruleId: 'UX-CONV-STATIC-003',
        targetUrl: 'https://fixture.test/page.html',
        selector: 'form:nth-of-type(1)',
        evidence: 'Form 1 contained 1 control and no explicit submit control.',
      }),
    ]);
  });

  it('does not invent evidence for an unreachable or non-HTML page', () => {
    const evidence = analyzeUxStatic(
      siteContext({
        pages: [
          { path: '/', html: null, fetchError: 'timeout' },
          { path: '/image.png', html: '<binary>', contentType: 'image/png' },
        ],
      }),
    );

    expect(evidence.pages).toEqual([]);
    expect(evidence.summary.pagesAnalyzed).toBe(0);
  });
});
