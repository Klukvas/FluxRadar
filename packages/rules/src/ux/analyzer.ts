// Static UX/Conversion evidence. This module reports observations from the
// fetched HTML; it deliberately does not guess whether a site should convert.
// The AI adapter consumes this bounded evidence and supplies the interpretation.

import { isSuccessfulHtmlPage, type SiteContext } from '../engine/types.js';
import { parsePage } from '../seo/dom.js';
import { visibleText } from '../content/visible-text.js';

const MAX_PAGES = 12;
const MAX_HEADINGS = 12;
const MAX_ACTIONS = 16;
const MAX_LINKS = 16;
const MAX_TEXT = 1_200;

export interface UxPageEvidence {
  readonly url: string;
  readonly title: string;
  readonly headings: readonly string[];
  readonly actions: readonly string[];
  readonly links: readonly string[];
  readonly forms: readonly string[];
  readonly contactSignals: readonly string[];
  readonly visibleText: string;
}

export interface UxStaticEvidence {
  readonly pages: readonly UxPageEvidence[];
  readonly findings: readonly UxStaticFinding[];
  readonly summary: {
    readonly pagesAnalyzed: number;
    readonly pagesWithActions: number;
    readonly pagesWithForms: number;
    readonly pagesWithContactSignals: number;
    readonly pagesWithHeadings: number;
  };
  readonly limitation: 'static-html-only';
}

export interface UxStaticFinding {
  readonly ruleId: 'UX-CONV-STATIC-001' | 'UX-CONV-STATIC-002' | 'UX-CONV-STATIC-003';
  readonly targetUrl: string;
  readonly severity: 'Medium' | 'Low';
  readonly evidence: string;
  readonly recommendation: string;
  readonly confidence: 1;
  readonly selector?: string;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function textOf(element: { textContent: string } | null): string {
  return element === null ? '' : clean(element.textContent);
}

function unique(values: readonly string[], limit: number): readonly string[] {
  return [...new Set(values.filter((value) => value !== ''))].slice(0, limit);
}

function pageTitle(root: ReturnType<typeof parsePage>): string {
  return textOf(root.querySelector('title'));
}

function headings(root: ReturnType<typeof parsePage>): readonly string[] {
  return unique(
    root.querySelectorAll('h1, h2, h3').map((element) => textOf(element)),
    MAX_HEADINGS,
  );
}

function actions(root: ReturnType<typeof parsePage>): readonly string[] {
  const values = root
    .querySelectorAll('a[href], button, input[type="submit"], input[type="button"]')
    .map((element) => {
      const text = textOf(element);
      const value = clean(element.getAttribute('value') ?? '');
      const href = clean(element.getAttribute('href') ?? '');
      return text || value || href;
    });
  return unique(values, MAX_ACTIONS);
}

function links(root: ReturnType<typeof parsePage>): readonly string[] {
  return unique(
    root.querySelectorAll('a[href]').map((element) => {
      const label = textOf(element);
      const href = clean(element.getAttribute('href') ?? '');
      return label === '' ? href : `${label} → ${href}`;
    }),
    MAX_LINKS,
  );
}

function forms(root: ReturnType<typeof parsePage>): readonly string[] {
  return root
    .querySelectorAll('form')
    .slice(0, 8)
    .map((form, index) => {
      const controls = form.querySelectorAll('input, select, textarea').length;
      const submits = form.querySelectorAll('button[type="submit"], input[type="submit"]').length;
      const action = clean(form.getAttribute('action') ?? '');
      return `form ${index + 1}: ${controls} controls, ${submits} submit controls${
        action === '' ? '' : `, action=${action}`
      }`;
    });
}

function contactSignals(root: ReturnType<typeof parsePage>): readonly string[] {
  const values = root.querySelectorAll('a[href]').flatMap((element) => {
    const href = clean(element.getAttribute('href') ?? '').toLowerCase();
    const label = textOf(element).toLowerCase();
    if (/^(mailto:|tel:)/.test(href)) return [href];
    if (/(contact|appointment|book|quote|demo|consult|call)/.test(`${href} ${label}`)) {
      return [textOf(element) || href];
    }
    return [];
  });
  return unique(values, 8);
}

function pageEvidence(page: Parameters<typeof visibleText>[0]): UxPageEvidence {
  const root = parsePage(page);
  const bodyText = visibleText(page);
  return {
    url: page.finalUrl,
    title: pageTitle(root),
    headings: headings(root),
    actions: actions(root),
    links: links(root),
    forms: forms(root),
    contactSignals: contactSignals(root),
    visibleText: bodyText.slice(0, MAX_TEXT),
  };
}

function pagePriority(page: UxPageEvidence, index: number): number {
  let score = index === 0 ? 100 : 0;
  score += page.forms.length * 20;
  score += page.contactSignals.length * 10;
  score += page.actions.length;
  return score;
}

function entryPageFindings(page: Parameters<typeof visibleText>[0]): readonly UxStaticFinding[] {
  const root = parsePage(page);
  const findings: UxStaticFinding[] = [];
  if (root.querySelector('h1') === null) {
    findings.push({
      ruleId: 'UX-CONV-STATIC-001',
      targetUrl: page.finalUrl,
      severity: 'Medium',
      evidence: 'No h1 heading was present in the fetched entry-page HTML.',
      recommendation:
        'Add one visible h1 that states the page’s main offer or purpose in plain language.',
      confidence: 1,
      selector: 'body',
    });
  }
  if (root.querySelector('a[href], button, input[type="submit"], input[type="button"]') === null) {
    findings.push({
      ruleId: 'UX-CONV-STATIC-002',
      targetUrl: page.finalUrl,
      severity: 'Medium',
      evidence: 'No link, button, or button-like input was present in the fetched entry-page HTML.',
      recommendation:
        'Provide a visible action that lets visitors continue toward the page’s intended outcome.',
      confidence: 1,
      selector: 'body',
    });
  }
  return findings;
}

function formFindings(page: Parameters<typeof visibleText>[0]): readonly UxStaticFinding[] {
  const root = parsePage(page);
  return root.querySelectorAll('form').flatMap((form, index) => {
    const controls = form.querySelectorAll('input, select, textarea').length;
    const submits = form.querySelectorAll('button[type="submit"], input[type="submit"]').length;
    if (controls === 0 || submits > 0) return [];
    return [
      {
        ruleId: 'UX-CONV-STATIC-003' as const,
        targetUrl: page.finalUrl,
        severity: 'Low' as const,
        evidence: `Form ${index + 1} contained ${controls} ${controls === 1 ? 'control' : 'controls'} and no explicit submit control.`,
        recommendation: 'Provide a clearly labelled submit control inside the form.',
        confidence: 1 as const,
        selector: `form:nth-of-type(${index + 1})`,
      },
    ];
  });
}

export function analyzeUxStatic(ctx: SiteContext): UxStaticEvidence {
  const successfulPages = ctx.crawl.pages.filter(
    (page) =>
      isSuccessfulHtmlPage(page) &&
      (page.contentType === null || page.contentType.toLowerCase().startsWith('text/html')),
  );
  const analyzed = successfulPages.map((page) => ({ source: page, evidence: pageEvidence(page) }));
  const entry = analyzed[0];
  const prioritized = analyzed
    .slice(1)
    .map(({ source, evidence }, index) => ({
      source,
      evidence,
      priority: pagePriority(evidence, index + 1),
    }))
    .sort((left, right) => right.priority - left.priority)
    .map(({ source, evidence }) => ({ source, evidence }));
  const selected = entry === undefined ? [] : [entry, ...prioritized].slice(0, MAX_PAGES);
  const pages = selected.map(({ evidence }) => evidence);
  const findings = selected.flatMap(({ source }, index) => [
    ...(index === 0 ? entryPageFindings(source) : []),
    ...formFindings(source),
  ]);
  return {
    pages,
    findings,
    summary: {
      pagesAnalyzed: pages.length,
      pagesWithActions: pages.filter((page) => page.actions.length > 0).length,
      pagesWithForms: pages.filter((page) => page.forms.length > 0).length,
      pagesWithContactSignals: pages.filter((page) => page.contactSignals.length > 0).length,
      pagesWithHeadings: pages.filter((page) => page.headings.length > 0).length,
    },
    limitation: 'static-html-only',
  };
}
