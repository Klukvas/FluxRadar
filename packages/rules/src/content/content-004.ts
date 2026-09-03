// CONTENT-004 — битые изображения и media (page-level; severity из реестра).
//
// Оракул: media-ссылки (img/source/video/audio [src]) успешной HTML-страницы,
// разрешённые против finalUrl. Media битая, если:
// (a) её цель имеет снимок обхода с 4xx/5xx, fetchError или text/html
//     content-type (img, ведущий на HTML-страницу) — confidence 1;
// (b) цель внутренняя (host сайта), но снимка в обходе нет — краулер v0.1
//     media не фетчит, существование ресурса не подтверждено ничем —
//     confidence снижен (D-165). Внешние media без снимка не оцениваются
//     (их статус неизвестен, evidence нет — та же логика, что D-152).
// Один finding на страницу: excerpt — перечень битых media с причинами,
// selector — первый битый элемент.

import type { PageSnapshot } from '@fluxradar/crawler';
import { normalizeUrl } from '@fluxradar/fingerprint';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding, SiteContext } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('CONTENT-004');

const MEDIA_SELECTOR = 'img[src], source[src], video[src], audio[src]';

/** Confidence для внутренних media без снимка: обход их не подтверждает. */
const UNCONFIRMED_CONFIDENCE = 0.6;

interface BrokenMedia {
  readonly selector: string;
  readonly reason: string;
  readonly confirmed: boolean;
}

export const content004BrokenMedia: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot, ctx: SiteContext): readonly RuleFinding[] {
    const broken = collectBrokenMedia(page, ctx);
    const first = broken[0];
    if (first === undefined) {
      return [];
    }
    const confirmed = broken.some((media) => media.confirmed);
    const listing = broken.map((media) => `${media.selector}: ${media.reason}`).join('; ');
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence: `Битые media (${broken.length}): ${listing}`,
        recommendation:
          'Замените или удалите битые media-ссылки: битая картинка портит страницу ' +
          'заметнее любой другой контентной проблемы.',
        selector: first.selector,
        confidence: confirmed ? 1 : UNCONFIRMED_CONFIDENCE,
      }),
    ];
  },
};

function collectBrokenMedia(page: PageSnapshot, ctx: SiteContext): readonly BrokenMedia[] {
  const snapshots = new Map(ctx.crawl.pages.map((snapshot) => [snapshot.normalizedUrl, snapshot]));
  const siteHost = new URL(ctx.domain).host;
  const seenTargets = new Set<string>();
  return parsePage(page)
    .querySelectorAll(MEDIA_SELECTOR)
    .flatMap((element) => {
      const rawSrc = element.getAttribute('src')?.trim() ?? '';
      const target = resolveHttpUrl(rawSrc, page.finalUrl);
      if (target === null || seenTargets.has(target.href)) {
        return [];
      }
      seenTargets.add(target.href);
      const selector = `${element.rawTagName.toLowerCase()}[src="${rawSrc}"]`;
      const verdict = mediaVerdict(target, snapshots.get(normalizeUrl(target.href)), siteHost);
      return verdict === null ? [] : [{ selector, reason: verdict.reason, confirmed: verdict.confirmed }];
    });
}

function mediaVerdict(
  target: URL,
  snapshot: PageSnapshot | undefined,
  siteHost: string,
): { reason: string; confirmed: boolean } | null {
  if (snapshot !== undefined) {
    if (snapshot.fetchError !== undefined) {
      return { reason: `недоступен (${snapshot.fetchError})`, confirmed: true };
    }
    if (snapshot.status >= 400) {
      return { reason: `HTTP ${snapshot.status}`, confirmed: true };
    }
    if (snapshot.contentType?.toLowerCase().startsWith('text/html') === true) {
      return { reason: 'отвечает HTML-страницей, не media', confirmed: true };
    }
    return null;
  }
  if (target.host === siteHost) {
    return { reason: 'внутренний ресурс не подтверждён обходом', confirmed: false };
  }
  return null;
}

function resolveHttpUrl(rawSrc: string, baseUrl: string): URL | null {
  if (rawSrc === '') {
    return null;
  }
  let resolved: URL;
  try {
    resolved = new URL(rawSrc, baseUrl);
  } catch {
    return null;
  }
  return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved : null;
}
