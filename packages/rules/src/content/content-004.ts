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
// Один finding на страницу: excerpt — перечень битых media по причинам,
// selector — первый битый элемент.

import type { PageSnapshot } from '@fluxradar/crawler';
import { normalizeUrl } from '@fluxradar/fingerprint';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding, SiteContext } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import {
  findingMessage,
  type FindingMessageCode,
  type CataloguedFindingMessage,
} from '../messages/index.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('CONTENT-004');

const MEDIA_SELECTOR = 'img[src], source[src], video[src], audio[src]';

/** Confidence для внутренних media без снимка: обход их не подтверждает. */
const UNCONFIRMED_CONFIDENCE = 0.6;

/** Shown for a failure kind no media on the page fell into; the same in every language. */
const NONE_LISTED = '—';

/**
 * Why a media reference counts as broken. The evidence sentence names each
 * kind in the reader's language, so the kind travels as data, not as text.
 */
type BrokenMediaKind = 'unreachable' | 'httpError' | 'htmlResponse' | 'unconfirmed';

interface BrokenMedia {
  readonly selector: string;
  readonly kind: BrokenMediaKind;
  /** Language-neutral technical detail: the fetch error or the HTTP status. */
  readonly detail?: string;
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
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence: brokenMediaEvidence(broken),
        recommendation: findingMessage('content-004.recommendation', {}),
        selector: first.selector,
        confidence: confirmed ? 1 : UNCONFIRMED_CONFIDENCE,
      }),
    ];
  },
};

const SINGLE_KIND_CODES = {
  unreachable: 'content-004.evidence.unreachable',
  httpError: 'content-004.evidence.http-error',
  htmlResponse: 'content-004.evidence.html-response',
  unconfirmed: 'content-004.evidence.unconfirmed',
} as const satisfies Record<BrokenMediaKind, FindingMessageCode>;

/**
 * A page whose broken media all fail the same way — usually one broken image —
 * gets the short sentence for that way. Only a mix gets the full breakdown: a
 * single 404 used to be reported as four clauses, three of them "—".
 */
function brokenMediaEvidence(broken: readonly BrokenMedia[]): CataloguedFindingMessage {
  const kinds = [...new Set(broken.map((media) => media.kind))];
  const [onlyKind] = kinds;
  if (kinds.length === 1 && onlyKind !== undefined) {
    return findingMessage(SINGLE_KIND_CODES[onlyKind], {
      count: broken.length,
      items: listingOf(broken, onlyKind),
    });
  }
  return findingMessage('content-004.evidence.mixed', {
    count: broken.length,
    unreachable: listingOf(broken, 'unreachable'),
    httpErrors: listingOf(broken, 'httpError'),
    htmlResponses: listingOf(broken, 'htmlResponse'),
    unconfirmed: listingOf(broken, 'unconfirmed'),
  });
}

function listingOf(broken: readonly BrokenMedia[], kind: BrokenMediaKind): string {
  const entries = broken
    .filter((media) => media.kind === kind)
    .map((media) =>
      media.detail === undefined ? media.selector : `${media.selector} (${media.detail})`,
    );
  return entries.length === 0 ? NONE_LISTED : entries.join(', ');
}

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
      return verdict === null ? [] : [{ selector, ...verdict }];
    });
}

function mediaVerdict(
  target: URL,
  snapshot: PageSnapshot | undefined,
  siteHost: string,
): Omit<BrokenMedia, 'selector'> | null {
  if (snapshot !== undefined) {
    if (snapshot.fetchError !== undefined) {
      return { kind: 'unreachable', detail: snapshot.fetchError, confirmed: true };
    }
    if (snapshot.status >= 400) {
      return { kind: 'httpError', detail: `HTTP ${snapshot.status}`, confirmed: true };
    }
    if (snapshot.contentType?.toLowerCase().startsWith('text/html') === true) {
      return { kind: 'htmlResponse', confirmed: true };
    }
    return null;
  }
  if (target.host === siteHost) {
    return { kind: 'unconfirmed', confirmed: false };
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
