// SEO-TECH-004 — canonical URL (page-level; severity из реестра contracts).
//
// Оракул: для успешно загруженной HTML-страницы:
//  (a) нет <link rel="canonical"> с непустым href → finding «отсутствует»;
//  (b) href не разрешается в абсолютный http(s)-URL (относительный
//      разрешается против finalUrl) → finding «не разрешается»;
//  (c) host канонического URL отличается от host страницы → finding «чужой
//      origin»: www.example.com и example.com — разные host-ы (D-151).
// Canonical на другой path/scheme того же host-а — легитимная канонизация
// дублей, не finding. При нескольких canonical берётся первый непустой href.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { parsePage, relTokens } from './dom.js';

const descriptor = requireDescriptor('SEO-TECH-004');
const CANONICAL_SELECTOR = 'link[rel="canonical"]';

export const seoTech004Canonical: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const href = canonicalHref(page);
    if (href === null) {
      return [missingCanonicalFinding(page)];
    }
    const resolved = resolveCanonical(href, page.finalUrl);
    if (resolved === null) {
      return [unresolvableCanonicalFinding(page, href)];
    }
    const pageHost = new URL(page.finalUrl).hostname.toLowerCase();
    if (resolved.hostname.toLowerCase() !== pageHost) {
      return [foreignCanonicalFinding(page, href, resolved)];
    }
    return [];
  },
};

function canonicalHref(page: PageSnapshot): string | null {
  const links = parsePage(page)
    .querySelectorAll('link')
    .filter((link) => relTokens(link).includes('canonical'));
  const href = links
    .map((link) => link.getAttribute('href')?.trim())
    .find((value): value is string => value !== undefined && value !== '');
  return href ?? null;
}

function resolveCanonical(href: string, baseUrl: string): URL | null {
  try {
    const resolved = new URL(href, baseUrl);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved : null;
  } catch {
    return null;
  }
}

function missingCanonicalFinding(page: PageSnapshot): RuleFinding {
  return pageFinding(descriptor, page, {
    evidenceType: 'dom',
    evidence: `<link rel="canonical"> отсутствует в документе ${page.finalUrl}`,
    recommendation:
      'Добавьте <link rel="canonical"> с абсолютным URL самой страницы (или её ' +
      'канонической версии на том же домене).',
    selector: CANONICAL_SELECTOR,
  });
}

function unresolvableCanonicalFinding(page: PageSnapshot, href: string): RuleFinding {
  return pageFinding(descriptor, page, {
    evidenceType: 'dom',
    evidence: `<link rel="canonical" href="${href}"> не разрешается в абсолютный http(s)-URL`,
    recommendation: 'Укажите в rel=canonical корректный абсолютный http(s)-URL.',
    selector: CANONICAL_SELECTOR,
    resource: href,
  });
}

function foreignCanonicalFinding(page: PageSnapshot, href: string, resolved: URL): RuleFinding {
  return pageFinding(descriptor, page, {
    evidenceType: 'dom',
    evidence:
      `<link rel="canonical" href="${href}"> указывает на чужой host ${resolved.hostname} — ` +
      `страница живёт на ${new URL(page.finalUrl).hostname}`,
    recommendation:
      'Canonical должен указывать на URL в пределах того же host-а; кросс-доменный canonical ' +
      'передаёт индексацию чужому домену — проверьте, что это сделано намеренно.',
    selector: CANONICAL_SELECTOR,
    resource: resolved.href,
  });
}
