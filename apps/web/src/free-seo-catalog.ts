// The web bundle has no contracts dependency. Source parity is checked against
// the SEO registry and Free tariff in free-seo-catalog.test.ts.
import { reportLanguage } from './report-language';
import type { Language } from './i18n';

export const FREE_SEO_RULE_IDS = [
  'SEO-ONPAGE-001',
  'SEO-ONPAGE-003',
  'SEO-ONPAGE-002',
  'SEO-TECH-008',
  'SEO-SOCIAL-001',
  'SEO-ONPAGE-005',
] as const;

export const SEO_CHECK_CATALOG = [
  ['SEO-TECH-002', 'Sitemap (sitemap.xml)', 'Карта сайту (sitemap.xml)'],
  ['SEO-TECH-004', 'Canonical URLs', 'Канонічні URL'],
  ['SEO-TECH-005', 'Redirect chains and loops', 'Ланцюжки та цикли перенаправлень'],
  [
    'SEO-TECH-016',
    'Stylesheet, script and font availability',
    'Доступність стилів, скриптів і шрифтів',
  ],
  ['SEO-TECH-015', 'Search crawler access in robots.txt', 'Доступ пошукових роботів у robots.txt'],
  ['SEO-TECH-001', 'robots.txt availability and syntax', 'Доступність і синтаксис robots.txt'],
  ['SEO-TECH-003', 'Page HTTP status', 'HTTP-статус сторінок'],
  ['SEO-TECH-006', 'Pages with 4xx/5xx responses', 'Сторінки з відповідями 4xx/5xx'],
  ['SEO-TECH-007', 'Duplicate URLs', 'Дублікати URL'],
  ['SEO-TECH-008', 'Search indexing directives', 'Директиви індексації пошуковиками'],
  [
    'SEO-TECH-009',
    'Internal links to sitemap pages',
    'Внутрішні посилання на сторінки карти сайту',
  ],
  ['SEO-TECH-010', 'Page click depth', 'Глибина сторінок у кліках'],
  ['SEO-TECH-011', 'Internal link coverage', 'Покриття внутрішніми посиланнями'],
  ['SEO-TECH-013', 'HTTPS and mixed content', 'HTTPS і змішаний вміст'],
  ['SEO-ONPAGE-007', 'Mobile viewport configuration', 'Налаштування мобільного viewport'],
  ['SEO-ONPAGE-001', 'Page titles', 'Заголовки сторінок'],
  ['SEO-ONPAGE-002', 'Meta descriptions', 'Метаописи сторінок'],
  ['SEO-ONPAGE-003', 'Heading structure', 'Структура заголовків'],
  ['SEO-ONPAGE-004', 'Title uniqueness across pages', 'Унікальність заголовків між сторінками'],
  ['SEO-ONPAGE-005', 'Image alt text', 'Альтернативний текст зображень'],
  [
    'SEO-ONPAGE-006',
    'Meta description uniqueness across pages',
    'Унікальність метаописів між сторінками',
  ],
  ['SEO-STRUCT-001', 'JSON-LD syntax', 'Синтаксис JSON-LD'],
  ['SEO-STRUCT-002', 'JSON-LD completeness', 'Повнота JSON-LD'],
  ['SEO-SOCIAL-001', 'Social preview metadata', 'Метадані прев’ю в соцмережах'],
  ['SEO-ADV-001', 'Local contact consistency', 'Узгодженість локальних контактних даних'],
  ['SEO-STRUCT-003', 'Local business structured data', 'Структуровані дані локального бізнесу'],
  ['SEO-STRUCT-004', 'Local review markup eligibility', 'Право на розмітку локальних відгуків'],
] as const;

export function additionalSeoChecks(recordedIds: readonly string[], language: Language) {
  const excluded = new Set<string>([...FREE_SEO_RULE_IDS, ...recordedIds]);
  return SEO_CHECK_CATALOG.filter(([id]) => !excluded.has(id)).map(([id, en, uk]) => ({
    id,
    title: reportLanguage(language) === 'en' ? en : uk,
  }));
}
