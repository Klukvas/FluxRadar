// Фикстурные тесты Accessibility-правил (D-025): A11Y-002 (img без alt,
// evidence-группа с SEO-ONPAGE-005 по §14) и A11Y-004 (controls без label).

import { describe, expect, it } from 'vitest';

import type { IssueCandidate } from '../engine/run-module.js';
import { htmlContext, loadFixtureContext, runRule } from '../testing/fixture-harness.js';

function single(candidates: readonly IssueCandidate[]): IssueCandidate {
  expect(candidates).toHaveLength(1);
  const first = candidates[0];
  if (first === undefined) {
    throw new Error('ожидался ровно один finding');
  }
  return first;
}

describe('A11Y-002 alt-тексты', () => {
  it('positive: <img> без alt → finding (Medium) с selector первого', () => {
    const finding = single(
      runRule('Accessibility', 'A11Y-002', loadFixtureContext('fx-A11Y-002-positive.html')),
    );
    expect(finding.severity).toBe('Medium');
    expect(finding.evidenceType).toBe('dom');
    expect(finding.normalizedSelector).toBe('img[src="/img/hero.png"]');
    expect(finding.evidenceGroupId).toMatch(/^evg-v1:/);
  });

  it('negative: alt заполнен или пустой alt="" (декоративное) → пусто', () => {
    expect(
      runRule('Accessibility', 'A11Y-002', loadFixtureContext('fx-A11Y-002-negative.html')),
    ).toEqual([]);
  });

  it('§14: у A11Y-002 и SEO-ONPAGE-005 общий evidenceGroupId и разные fingerprint', () => {
    const ctx = loadFixtureContext('fx-A11Y-002-positive.html');
    const a11y = single(runRule('Accessibility', 'A11Y-002', ctx));
    const seo = single(runRule('SEO', 'SEO-ONPAGE-005', ctx));
    expect(a11y.evidenceGroupId).toBeDefined();
    expect(a11y.evidenceGroupId).toBe(seo.evidenceGroupId);
    expect(a11y.fingerprint).not.toBe(seo.fingerprint);
  });
});

describe('A11Y-004 labels у форм', () => {
  it('positive: input без label → finding с selector элемента', () => {
    const finding = single(
      runRule('Accessibility', 'A11Y-004', loadFixtureContext('fx-A11Y-004-positive.html')),
    );
    expect(finding.severity).toBe('Medium');
    expect(finding.normalizedSelector).toBe('input[name="nickname"]');
  });

  it('negative: label[for], обёртка, aria-label/labelledby, hidden, submit → пусто', () => {
    expect(
      runRule('Accessibility', 'A11Y-004', loadFixtureContext('fx-A11Y-004-negative.html')),
    ).toEqual([]);
  });

  it('select и textarea без label — тоже findings (по одному на элемент)', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Bare controls page</title></head><body>' +
        '<form><select name="topic"><option>General</option></select>' +
        '<textarea name="message"></textarea></form></body></html>',
    );
    const findings = runRule('Accessibility', 'A11Y-004', ctx);
    expect(findings.map((finding) => finding.normalizedSelector).sort()).toEqual([
      'select[name="topic"]',
      'textarea[name="message"]',
    ]);
  });

  it('placeholder не заменяет label → finding остаётся', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Placeholder only page</title></head><body>' +
        '<form><input type="text" name="q" placeholder="Search" /></form></body></html>',
    );
    expect(single(runRule('Accessibility', 'A11Y-004', ctx)).normalizedSelector) //
      .toBe('input[name="q"]');
  });
});

describe('WCAG 2.2 AA static checks', () => {
  it('A11Y-001 finds an explicit low-contrast inline pair', () => {
    const finding = single(
      runRule(
        'Accessibility',
        'A11Y-001',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Contrast</title></head><body>' +
            '<main><h1 style="color:#777;background-color:#fff">Low contrast</h1></main></body></html>',
        ),
      ),
    );
    expect(finding.normalizedSelector).toBe('h1');
    expect(finding.evidenceExcerpt).toContain('4.48:1');
  });

  it('A11Y-001 does not claim a violation when the inline pair meets the threshold', () => {
    expect(
      runRule(
        'Accessibility',
        'A11Y-001',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Contrast</title></head><body>' +
            '<main><h1 style="color:#000;background-color:#fff">Readable</h1></main></body></html>',
        ),
      ),
    ).toEqual([]);
  });

  it('A11Y-003 reports missing language and skipped heading levels', () => {
    const finding = single(
      runRule(
        'Accessibility',
        'A11Y-003',
        htmlContext(
          '<!doctype html><html><head><title>Structure</title></head><body>' +
            '<main><h1>Page</h1><h3>Skipped</h3></main></body></html>',
        ),
      ),
    );
    expect(finding.normalizedSelector).toBe('html');
    expect(finding.evidenceExcerpt).toContain('html[lang]');
  });

  it('A11Y-005 reports positive tabindex and mouse-only handlers', () => {
    const finding = single(
      runRule(
        'Accessibility',
        'A11Y-005',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Keyboard</title></head><body>' +
            '<main><h1>Page</h1><div onclick="openPanel()">Open</div><a href="/next" tabindex="2">Next</a></main></body></html>',
        ),
      ),
    );
    expect(finding.evidenceExcerpt).toContain('tabindex > 0');
  });

  it('A11Y-006 reports focus outline removal without replacement', () => {
    const finding = single(
      runRule(
        'Accessibility',
        'A11Y-006',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Focus</title>' +
            '<style>button:focus { outline: none; }</style></head><body><main><h1>Page</h1></main></body></html>',
        ),
      ),
    );
    expect(finding.evidenceExcerpt).toContain('focus-state');
  });

  it('A11Y-007 reports broken ARIA references and aria-hidden focusable controls', () => {
    const finding = single(
      runRule(
        'Accessibility',
        'A11Y-007',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>ARIA</title></head><body>' +
            '<main><h1>Page</h1><button aria-labelledby="missing">Open</button></main></body></html>',
        ),
      ),
    );
    expect(finding.evidenceExcerpt).toContain('отсутствующий ARIA id');
  });

  it('A11Y-008 reports unnamed interactive elements', () => {
    const finding = single(
      runRule(
        'Accessibility',
        'A11Y-008',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Names</title></head><body>' +
            '<main><h1>Page</h1><button></button></main></body></html>',
        ),
      ),
    );
    expect(finding.normalizedSelector).toBe('button');
  });

  it('A11Y-009 requires an error description for an invalid control', () => {
    const finding = single(
      runRule(
        'Accessibility',
        'A11Y-009',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Errors</title></head><body>' +
            '<main><h1>Page</h1><input id="email" aria-invalid="true" /></main></body></html>',
        ),
      ),
    );
    expect(finding.normalizedSelector).toBe('input#email');
  });

  it('A11Y-010 reports missing main landmark and accepts an accessible document', () => {
    expect(
      runRule(
        'Accessibility',
        'A11Y-010',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Landmark</title></head><body>' +
            '<h1>Page</h1></body></html>',
        ),
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'Accessibility',
        'A11Y-010',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Landmark</title></head><body>' +
            '<main><h1>Page</h1></main></body></html>',
        ),
      ),
    ).toEqual([]);
  });

  it('A11Y-011 contributes a site report contract without an issue or penalty', () => {
    const result = runRule(
      'Accessibility',
      'A11Y-011',
      htmlContext(
        '<!doctype html><html lang="en"><head><title>Report</title></head><body>' +
          '<main><h1>Page</h1></main></body></html>',
      ),
    );
    expect(result).toEqual([]);
  });
});
