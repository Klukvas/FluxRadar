// SEO-модуль rules-mvp-0.1 (T-08): 9 технических + 4 on-page правила.
// Порядок — по ruleId реестра; движок сохраняет его в результатах.

import type { Rule } from '../engine/types.js';
import { seoOnpage001Title } from './seo-onpage-001.js';
import { seoOnpage002MetaDescription } from './seo-onpage-002.js';
import { seoOnpage003Headings } from './seo-onpage-003.js';
import { seoOnpage005ImageAlt } from './seo-onpage-005.js';
import { seoTech001RobotsTxt } from './seo-tech-001.js';
import { seoTech002Sitemap } from './seo-tech-002.js';
import { seoTech003HttpStatus } from './seo-tech-003.js';
import { seoTech004Canonical } from './seo-tech-004.js';
import { seoTech005RedirectChains } from './seo-tech-005.js';
import { seoTech006BrokenLinks } from './seo-tech-006.js';
import { seoTech007DuplicateUrls } from './seo-tech-007.js';
import { seoTech008Noindex } from './seo-tech-008.js';
import { seoTech013MixedContent } from './seo-tech-013.js';

export const SEO_RULES: readonly Rule[] = [
  seoTech001RobotsTxt,
  seoTech002Sitemap,
  seoTech003HttpStatus,
  seoTech004Canonical,
  seoTech005RedirectChains,
  seoTech006BrokenLinks,
  seoTech007DuplicateUrls,
  seoTech008Noindex,
  seoTech013MixedContent,
  seoOnpage001Title,
  seoOnpage002MetaDescription,
  seoOnpage003Headings,
  seoOnpage005ImageAlt,
];
