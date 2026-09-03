// PRIVACY-003 — third-party скрипты (page-level; severity Low из реестра —
// информационная инвентаризация).
//
// Оракул: <script src> с hostname, не принадлежащим сайту, → один finding
// на страницу, excerpt — отсортированный перечень чужих доменов. «Свой»
// hostname — совпадает с hostname страницы или сайта либо связан с ним
// поддоменной цепочкой (dot-suffix в любую сторону: cdn.example.com при
// сайте example.com — свой, D-170; v0.1 без PSL — registrable-суффиксы
// не различаются). Инлайновые и свои скрипты — не сигнал. Поля normalized*
// пусты: набор доменов живёт в excerpt, fingerprint остаётся стабильным
// при смене CDN (D-169).

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding, SiteContext } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('PRIVACY-003');

export const privacy003ThirdPartyScripts: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot, ctx: SiteContext): readonly RuleFinding[] {
    const domains = thirdPartyScriptHosts(page, ctx);
    if (domains.length === 0) {
      return [];
    }
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence: `Third-party скрипты с ${domains.length} доменов: ${domains.join(', ')}`,
        recommendation:
          'Проверьте каждый сторонний скрипт: нужен ли он, упомянут ли в privacy ' +
          'policy и требует ли согласия пользователя (трекеры — требуют).',
      }),
    ];
  },
};

function thirdPartyScriptHosts(page: PageSnapshot, ctx: SiteContext): readonly string[] {
  const ownHosts = [hostnameOf(page.finalUrl), hostnameOf(ctx.domain)].filter(
    (host): host is string => host !== null,
  );
  const hosts = parsePage(page)
    .querySelectorAll('script')
    .map((script) => script.getAttribute('src')?.trim() ?? '')
    .filter((src) => src !== '')
    .map((src) => resolveHostname(src, page.finalUrl))
    .filter((host): host is string => host !== null && !isOwnHost(host, ownHosts));
  return [...new Set(hosts)].sort();
}

/**
 * Свой hostname: равен hostname страницы/сайта либо связан с ним
 * поддоменной цепочкой (D-170). Сравнение по hostname — порт стороны
 * не меняет (та же приватность у example.com:80 и :8443).
 */
function isOwnHost(host: string, ownHosts: readonly string[]): boolean {
  return ownHosts.some(
    (own) => host === own || host.endsWith(`.${own}`) || own.endsWith(`.${host}`),
  );
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function resolveHostname(src: string, baseUrl: string): string | null {
  try {
    const resolved = new URL(src, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return null;
    }
    return resolved.hostname;
  } catch {
    return null;
  }
}
