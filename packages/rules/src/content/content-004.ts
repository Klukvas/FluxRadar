// CONTENT-004 — битые изображения и media (page-level; severity из реестра).
//
// Оракул: media-ссылки (img/source/video/audio [src]) успешной HTML-страницы,
// разрешённые против finalUrl. Media считается битой ТОЛЬКО по доказательству
// обхода о самой media:
// (a) снимок её цели с 4xx/5xx, fetchError или text/html content-type (img,
//     ведущий на HTML-страницу);
// (b) media-проба обхода (crawl.resources) с 4xx/5xx или text/html.
// Оба случая доказаны, поэтому confidence = 1.
//
// Media, о которой доказательства нет, не оценивается — ни внутренняя, ни
// внешняя, ни та, чью пробу обход не сделал (robots, бюджет, пауза, сетевой
// сбой: у ResourceSnapshot.unverifiedReason). «Не проверяли» — это не «битая»:
// раньше внутренняя media без снимка давала scored finding с confidence 0.6, и
// здоровая страница с живым <img src="/logo.png"> теряла полный Medium-штраф
// (score 97 вместо 100) за ресурс, которого никто не запрашивал. Неизвестная
// доступность не снижает score и не сообщается владельцу как поломка; та же
// логика, что D-152 для внутренних ссылок, и та же причина, по которой
// незапрошенная проба не штрафуется — это наш лимит, а не дефект сайта.
//
// Один finding на страницу: excerpt — перечень битых media по причинам,
// selector — первый битый элемент.

import type { PageSnapshot, ResourceSnapshot } from '@fluxradar/crawler';
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
import { crawledTargets } from '../seo/site-index.js';

const descriptor = requireDescriptor('CONTENT-004');

const MEDIA_SELECTOR = 'img[src], source[src], video[src], audio[src]';

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
  /** Нормализованный URL media — снимок, на котором держится вердикт. */
  readonly normalizedTarget: string;
  /** Language-neutral technical detail: the fetch error or the HTTP status. */
  readonly detail?: string;
}

export const content004BrokenMedia: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  // Битой media делает снимок самой media, а не страница, которая её
  // показывает. Прогон, не увидевший этих снимков, молчит о находке по той же
  // причине, по какой молчал бы о починенной (§14, RuleEvaluation.inputTargets).
  // Снимки страниц плюс media-пробы: и то и другое — прочитанные правилом
  // входы, и проба, ставшая уликой, обязана быть в них названа.
  inputTargets: (ctx: SiteContext): readonly string[] => [
    ...new Set([
      ...crawledTargets(ctx.crawl),
      ...(ctx.crawl.resources ?? [])
        .filter((resource) => resource.unverifiedReason === undefined && resource.status !== 0)
        .map((resource) => resource.normalizedUrl),
    ]),
  ],
  // А спрашивало правило о каждой media-ссылке обхода. Картинка, которой на
  // страницах сайта больше нет, снимком уже не проверяется — и прошлая находка
  // о ней говорит о снятой картинке, а не о потерянных данных (§14).
  requestedInputs: (ctx: SiteContext): readonly string[] => mediaTargets(ctx),
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
        // Every kind left is proven by a crawl snapshot of the media itself.
        confidence: 1,
        // Находка держится ровно на этих снимках: их и спрашивает политика
        // Resolved, а не весь обход — иначе одна необойдённая страница
        // заморозила бы находки о битых картинках по всему сайту.
        dependencyTargets: broken.map((media) => media.normalizedTarget),
      }),
    ];
  },
};

/** Все media-ссылки обхода: спрос правила, отвеченный снимком или нет. */
function mediaTargets(ctx: SiteContext): readonly string[] {
  return [
    ...new Set(
      ctx.crawl.pages
        .filter((page) => isSuccessfulHtmlPage(page))
        .flatMap((page) => mediaReferences(page).map((media) => media.normalizedTarget)),
    ),
  ];
}

const SINGLE_KIND_CODES = {
  unreachable: 'content-004.evidence.unreachable',
  httpError: 'content-004.evidence.http-error',
  htmlResponse: 'content-004.evidence.html-response',
} as const satisfies Record<BrokenMediaKind, FindingMessageCode>;

/**
 * A page whose broken media all fail the same way — usually one broken image —
 * gets the short sentence for that way. Only a mix gets the full breakdown: a
 * single 404 used to be reported as four clauses, three of them "—".
 *
 * The breakdown is `mixed-v2`: `mixed` names a fourth kind this rule no longer
 * reports, and it stays in the catalog to render the findings that were stored
 * with it (RENDER_ONLY_MESSAGE_CODES).
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
  return findingMessage('content-004.evidence.mixed-v2', {
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

/** Media-ссылка страницы: селектор для evidence и нормализованная цель. */
interface MediaReference {
  readonly selector: string;
  readonly normalizedTarget: string;
}

const mediaReferencesCache = new WeakMap<PageSnapshot, readonly MediaReference[]>();

/**
 * Media-ссылки страницы, по одной на цель.
 *
 * Разбор кэшируется на снимок: список нужен и вердикту страницы, и спросу
 * правила по всему обходу (requestedInputs), и оба обходят одни и те же
 * страницы.
 */
function mediaReferences(page: PageSnapshot): readonly MediaReference[] {
  const cached = mediaReferencesCache.get(page);
  if (cached !== undefined) {
    return cached;
  }
  const seenTargets = new Set<string>();
  const references = parsePage(page)
    .querySelectorAll(MEDIA_SELECTOR)
    .flatMap((element) => {
      const rawSrc = element.getAttribute('src')?.trim() ?? '';
      const target = resolveHttpUrl(rawSrc, page.finalUrl);
      if (target === null || seenTargets.has(target.href)) {
        return [];
      }
      seenTargets.add(target.href);
      return [
        {
          selector: `${element.rawTagName.toLowerCase()}[src="${rawSrc}"]`,
          normalizedTarget: normalizeUrl(target.href),
        },
      ];
    });
  mediaReferencesCache.set(page, references);
  return references;
}

function collectBrokenMedia(page: PageSnapshot, ctx: SiteContext): readonly BrokenMedia[] {
  const snapshots = new Map(ctx.crawl.pages.map((snapshot) => [snapshot.normalizedUrl, snapshot]));
  // Media the crawl asked about directly. Before these existed, an image the
  // crawl had not happened to fetch as a page could not be judged at all.
  const probes = new Map(
    (ctx.crawl.resources ?? []).map((resource) => [resource.normalizedUrl, resource]),
  );
  return mediaReferences(page).flatMap((media) => {
    const verdict = mediaVerdict(
      snapshots.get(media.normalizedTarget),
      probes.get(media.normalizedTarget),
    );
    return verdict === null ? [] : [{ ...media, ...verdict }];
  });
}

/** null — media либо отвечает нормально, либо вообще не проверялась обходом. */
function mediaVerdict(
  snapshot: PageSnapshot | undefined,
  probe: ResourceSnapshot | undefined,
): Omit<BrokenMedia, 'selector' | 'normalizedTarget'> | null {
  if (snapshot !== undefined) {
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
  if (probe !== undefined) {
    // A probe that was never made — robots.txt, budget, a pause, a request that
    // failed on our side — says nothing about the resource. Reporting it as
    // broken would be reporting our own limits as the site's defect.
    if (probe.unverifiedReason !== undefined || probe.status === 0) {
      return null;
    }
    if (probe.status >= 400) {
      return { kind: 'httpError', detail: `HTTP ${probe.status}` };
    }
    if (probe.contentType?.toLowerCase().startsWith('text/html') === true) {
      return { kind: 'htmlResponse' };
    }
  }
  // Ни снимка, ни выполненной пробы — доказательства нет, и находки тоже.
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
