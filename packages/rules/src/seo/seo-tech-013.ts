// SEO-TECH-013 — HTTPS/mixed content (page-level; severity из реестра).
//
// Оракул: субресурсы страницы — img/script/iframe[src] и link[href] с
// resource-rel (stylesheet/icon/preload/prefetch/manifest/mask-icon) — с
// абсолютным http:// URL:
//  (a) страница https → классический mixed content → finding на каждый
//      уникальный элемент;
//  (b) страница http, ресурс на ДРУГОМ host → тоже finding: небезопасный
//      внешний субресурс сломается при переходе сайта на https (fixture-сайт
//      живёт на loopback-http и представляет https-сайт — D-154).
// Same-host ресурс на http-странице — не finding (консистентная схема).
// Protocol-relative `//host/...` наследует схему страницы и при переходе на
// https станет https автоматически — в ветке (b) не finding (D-157).
// selector = `tag[attr="raw"]`; дедуп по selector в пределах страницы.

import type { PageSnapshot } from '@fluxradar/crawler';
import type { HTMLElement } from 'node-html-parser';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { parsePage, relTokens } from './dom.js';

const descriptor = requireDescriptor('SEO-TECH-013');

const RESOURCE_LINK_RELS: ReadonlySet<string> = new Set([
  'stylesheet',
  'icon',
  'apple-touch-icon',
  'mask-icon',
  'preload',
  'prefetch',
  'manifest',
]);

interface SubresourceRef {
  readonly selector: string;
  readonly rawUrl: string;
  readonly resolved: URL;
}

export const seoTech013MixedContent: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const pageUrl = new URL(page.finalUrl);
    const reported = new Set<string>();
    return subresources(parsePage(page), page.finalUrl)
      .filter((ref) => isInsecure(ref, pageUrl))
      .filter((ref) => {
        if (reported.has(ref.selector)) {
          return false;
        }
        reported.add(ref.selector);
        return true;
      })
      .map((ref) => insecureResourceFinding(page, ref));
  },
};

function subresources(root: HTMLElement, baseUrl: string): readonly SubresourceRef[] {
  const fromTags = (['img', 'script', 'iframe'] as const).flatMap((tag) =>
    root
      .querySelectorAll(tag)
      .map((element) => toRef(tag, 'src', element.getAttribute('src'), baseUrl)),
  );
  const fromLinks = root
    .querySelectorAll('link')
    .filter((link) => relTokens(link).some((token) => RESOURCE_LINK_RELS.has(token)))
    .map((link) => toRef('link', 'href', link.getAttribute('href'), baseUrl));
  return [...fromTags, ...fromLinks].filter((ref): ref is SubresourceRef => ref !== null);
}

function toRef(
  tag: string,
  attribute: string,
  rawValue: string | undefined,
  baseUrl: string,
): SubresourceRef | null {
  const rawUrl = rawValue?.trim();
  if (rawUrl === undefined || rawUrl === '') {
    return null;
  }
  try {
    return {
      selector: `${tag}[${attribute}="${rawUrl}"]`,
      rawUrl,
      resolved: new URL(rawUrl, baseUrl),
    };
  } catch {
    return null; // неразбираемый URL — не субресурс
  }
}

function isInsecure(ref: SubresourceRef, pageUrl: URL): boolean {
  if (ref.resolved.protocol !== 'http:') {
    return false;
  }
  if (pageUrl.protocol === 'https:') {
    return true;
  }
  // На http-странице protocol-relative ссылка резолвится в http, но при
  // переходе сайта на https обновится сама — «сломаться» ей нечем (D-157).
  if (ref.rawUrl.startsWith('//')) {
    return false;
  }
  return ref.resolved.hostname.toLowerCase() !== pageUrl.hostname.toLowerCase();
}

function insecureResourceFinding(page: PageSnapshot, ref: SubresourceRef): RuleFinding {
  return pageFinding(descriptor, page, {
    evidenceType: 'dom',
    evidence: `${ref.selector} загружается по незашифрованному http:// (${ref.resolved.href})`,
    recommendation:
      'Загружайте субресурсы по https:// (или протокол-относительным URL того же origin) — ' +
      'браузеры блокируют или помечают mixed content.',
    selector: ref.selector,
    resource: ref.resolved.href,
  });
}
