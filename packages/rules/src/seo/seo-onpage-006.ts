// SEO-ONPAGE-006 — дубль meta description (цели — страницы; severity из реестра).
//
// Оракул: прочитанная HTML-страница, чей нормализованный content первого
// <meta name="description"> (trim, пробелы схлопнуты, регистр сохранён)
// совпадает с description другой прочитанной страницы, даёт finding. Первый тег,
// как и у SEO-ONPAGE-002: два description на странице — это её собственная
// проблема, а не совпадение с чужой. Страница без description finding не даёт —
// это предмет SEO-ONPAGE-002.
//
// Severity ниже, чем у дубля title: поисковик описание часто перепишет сам под
// запрос, а заголовок берёт как написан. Но одинаковое описание на десятке
// страниц — это всё равно десяток страниц, которые выдача не различает.
//
// ПОЧЕМУ НОМЕР 006. §3 плана держал 006 за «Open Graph/social metadata», а
// реестр выдал этой проверке собственный префикс (SEO-SOCIAL-001) — как и
// structured data (SEO-STRUCT-001/002), и перелинковке (SEO-TECH-009/010/011).
// Номер освободился, 005 занят image alt, и 006 — следующий свободный.
// Уникальность title живёт рядом под 004.
//
// КАНДИДАТ, CANONICAL И ГРАНИЦА С SEO-TECH-007 — ровно как у SEO-ONPAGE-004
// (см. его шапку): один снимок на адрес документа, canonical на члена группы
// снимает находку, а группа дублей URL к дублям описаний привести не может.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFindingAt } from '../engine/finding.js';
import type { PageRule, RuleFinding, SiteContext } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import {
  duplicateIndex,
  duplicateValueOf,
  unclaimedDuplicatesOf,
} from '../shared/duplicate-groups.js';
import { duplicateCoverage } from '../shared/duplicate-rule.js';
import { canonicalAddress } from './site-index.js';

const descriptor = requireDescriptor('SEO-ONPAGE-006');

export const seoOnpage006DuplicateMetaDescription: PageRule = {
  kind: 'page',
  descriptor,
  ...duplicateCoverage('meta-description'),
  evaluatePage(page: PageSnapshot, ctx: SiteContext): readonly RuleFinding[] {
    const address = canonicalAddress(ctx.crawl, page.normalizedUrl);
    const duplicates = unclaimedDuplicatesOf(duplicateIndex(ctx, 'meta-description'), address);
    if (duplicates === null) {
      return [];
    }
    return [
      pageFindingAt(descriptor, address, page, {
        evidenceType: 'dom',
        evidence: findingMessage('seo-onpage-006.evidence', {
          description: duplicateValueOf(page, 'meta-description'),
          count: duplicates.count,
          pages: duplicates.listed.join(', '),
        }),
        recommendation: findingMessage('seo-onpage-006.recommendation', {}),
        selector: 'meta[name="description"]',
        dependencyTargets: duplicates.listed,
      }),
    ];
  },
};
