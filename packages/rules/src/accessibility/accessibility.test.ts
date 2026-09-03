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
