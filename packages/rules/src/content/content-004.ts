// CONTENT-004 — битые изображения и media (page-level; severity из реестра).
//
// Оракул: media-ссылки (img/source/video/audio [src]) успешной HTML-страницы,
// разрешённые против finalUrl. Media битая ТОЛЬКО если её цель проверена и
// ответила плохо: снимок с 4xx/5xx, fetchError или text/html content-type
// (img, ведущий на HTML-страницу). Снимок даёт либо сам обход (media-адрес
// попал в очередь страниц), либо HEAD-проверка media (crawler media-check.ts).
//
// Ветки «внутренняя media без снимка» (D-165, confidence 0.6) больше нет.
// Она штрафовала за непроверенное: краулер media не фетчил вообще, а правило
// выдавало Medium-находку «Биті зображення або медіа» с доказательством
// «не підтверджені обходом». 21.09.2026 все три файла из такого доказательства
// руками отдали 200. Непроверенное теперь и называется непроверенным —
// `unverifiedMedia` считает такие адреса, и модуль показывает их как охват
// проверки, без severity и без −3 балла.
//
// Один finding на страницу: excerpt — перечень битых media по причинам,
// selector — первый битый элемент.

import type { PageSnapshot } from '@fluxradar/crawler';
import { MEDIA_SELECTOR } from '@fluxradar/crawler';
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

/** Shown for a failure kind no media on the page fell into; the same in every language. */
const NONE_LISTED = '—';

/**
 * Why a media reference counts as broken. The evidence sentence names each
 * kind in the reader's language, so the kind travels as data, not as text.
 */
type BrokenMediaKind = 'unreachable' | 'httpError' | 'htmlResponse';

interface BrokenMedia {
  readonly selector: string;
  readonly kind: BrokenMediaKind;
  /** Language-neutral technical detail: the fetch error or the HTTP status. */
  readonly detail?: string;
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
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence: brokenMediaEvidence(broken),
        recommendation: findingMessage('content-004.recommendation', {}),
        selector: first.selector,
        // Every finding here is a file that was asked for and answered badly,
        // so there is nothing left to be uncertain about.
        confidence: 1,
      }),
    ];
  },
};

const SINGLE_KIND_CODES = {
  unreachable: 'content-004.evidence.unreachable',
  httpError: 'content-004.evidence.http-error',
  htmlResponse: 'content-004.evidence.html-response',
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
  const snapshots = mediaSnapshots(ctx);
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
      const verdict = mediaVerdict(snapshots.get(normalizeUrl(target.href)));
      return verdict === null ? [] : [{ selector, ...verdict }];
    });
}

/**
 * Everything the crawl holds an answer for: pages it fetched, plus the media it
 * verified with a HEAD. A media address in neither was never asked about, and
 * this rule has nothing to say about it.
 */
function mediaSnapshots(ctx: SiteContext): ReadonlyMap<string, PageSnapshot> {
  return new Map(
    [...ctx.crawl.pages, ...ctx.crawl.mediaChecks].map((snapshot) => [
      snapshot.normalizedUrl,
      snapshot,
    ]),
  );
}

/** The verdict on one media file, or null when it answered fine or was never asked. */
function mediaVerdict(snapshot: PageSnapshot | undefined): Omit<BrokenMedia, 'selector'> | null {
  if (snapshot === undefined) {
    // Not verified. Saying nothing is the whole fix: this branch used to return
    // a Medium finding about a file the crawler had never requested.
    return null;
  }
  if (snapshot.fetchError !== undefined) {
    return { kind: 'unreachable', detail: snapshot.fetchError };
  }
  if (snapshot.status >= 400) {
    return { kind: 'httpError', detail: `HTTP ${snapshot.status}` };
  }
  if (snapshot.contentType?.toLowerCase().startsWith('text/html') === true) {
    return { kind: 'htmlResponse' };
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
