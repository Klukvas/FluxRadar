// PRIVACY-001 — обнаружение cookies (page-level; severity Low из реестра —
// информационная инвентаризация, не «нарушение»).
//
// Оракул: страница ставит cookies — Set-Cookie в финальном ответе И/ИЛИ
// присваивание document.cookie в inline-скрипте → один finding на страницу
// с перечнем имён кук и источников. evidenceType: http (только заголовок),
// dom (только inline-скрипт), mixed (оба). Значения кук в evidence не
// попадают. Applicable — любой снимок с HTTP-ответом (Set-Cookie бывает
// и на не-HTML ответах); inline-скрипты ищутся только при наличии HTML.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { hasHttpResponse } from '../engine/types.js';
import { parsePage } from '../seo/dom.js';
import { parseSetCookie, setCookieValues } from '../shared/headers.js';

const descriptor = requireDescriptor('PRIVACY-001');

// (?!=) отсекает сравнения document.cookie == / === — читать куку не сигнал.
const DOCUMENT_COOKIE_ASSIGNMENT = /document\.cookie\s*=(?!=)\s*(?:["'`]\s*([^=;"'`]+)=)?/g;

export const privacy001Cookies: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: hasHttpResponse,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const headerCookies = setCookieValues(page)
      .map((value) => parseSetCookie(value).name)
      .filter((name) => name !== '');
    const scriptCookies = inlineScriptCookieNames(page);
    if (headerCookies.length === 0 && scriptCookies.length === 0) {
      return [];
    }
    const inventory = [
      ...headerCookies.map((name) => `${name} (Set-Cookie)`),
      ...scriptCookies.map((name) => `${name} (document.cookie)`),
    ];
    const evidenceType =
      headerCookies.length > 0 && scriptCookies.length > 0
        ? 'mixed'
        : headerCookies.length > 0
          ? 'http'
          : 'dom';
    return [
      pageFinding(descriptor, page, {
        evidenceType,
        evidence: `Страница ставит cookies (${inventory.length}): ${inventory.join(', ')}`,
        recommendation:
          'Убедитесь, что каждая кука нужна, задокументирована в privacy policy и — ' +
          'для нетехнических кук — ставится только после согласия пользователя.',
      }),
    ];
  },
};

/** Имена кук из присваиваний document.cookie; без имени — сам маркер. */
function inlineScriptCookieNames(page: PageSnapshot): readonly string[] {
  if (page.html === null) {
    return [];
  }
  const names = new Set<string>();
  const inlineScripts = parsePage(page)
    .querySelectorAll('script')
    .filter((script) => (script.getAttribute('src') ?? '') === '');
  for (const script of inlineScripts) {
    for (const match of script.rawText.matchAll(DOCUMENT_COOKIE_ASSIGNMENT)) {
      names.add(match[1]?.trim() ?? 'document.cookie');
    }
  }
  return [...names].sort();
}
