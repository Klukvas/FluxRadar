// Open Graph/Twitter preview checks over static public HTML.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { parsePage } from './dom.js';

const descriptor = requireDescriptor('SEO-SOCIAL-001');

const REQUIRED_PREVIEW_FIELDS = [
  { key: 'og:title', label: 'og:title' },
  { key: 'og:description', label: 'og:description' },
  { key: 'og:image', label: 'og:image' },
  { key: 'og:url', label: 'og:url' },
  { key: 'twitter:card', label: 'twitter:card' },
] as const;

export const seoSocial001Preview: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const missing = missingPreviewFields(page);
    if (missing.length === 0) return [];
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence: `Отсутствуют social preview поля: ${missing.join(', ')}`,
        recommendation:
          'Добавьте уникальные Open Graph og:title, og:description, og:image, og:url и ' +
          'Twitter twitter:card; проверьте абсолютные URL и предпросмотр ссылки.',
        resource: 'social-preview',
      }),
    ];
  },
};

export function hasSocialPreview(page: PageSnapshot): boolean {
  return missingPreviewFields(page).length === 0;
}

function missingPreviewFields(page: PageSnapshot): readonly string[] {
  const root = parsePage(page);
  return REQUIRED_PREVIEW_FIELDS.filter(({ key }) => {
    const meta = root.querySelectorAll('meta').find((element) => {
      const property = element.getAttribute('property')?.trim().toLowerCase();
      const name = element.getAttribute('name')?.trim().toLowerCase();
      return property === key || name === key;
    });
    return (meta?.getAttribute('content') ?? '').trim() === '';
  }).map(({ label }) => label);
}
