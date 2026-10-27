import type { FindingLanguage } from '@fluxradar/rules';
import type { ReportBrand } from '../../branding/load.ts';
import { REPORT_COPY, type ReportCopy } from './copy.ts';
import { REPORT_COLOURS, type ReportDocument, type ReportPalette } from './document.ts';

export const BRANDED_COPY_OVERRIDES: Record<FindingLanguage, Partial<ReportCopy>> = {
  uk: {
    documentTitle: (domain) => `Звіт про сайт ${domain}`,
    footer: 'Автоматичний аудит сайту. Для юридичної відповідності потрібна ручна перевірка.',
  },
  en: {
    documentTitle: (domain) => `Website report for ${domain}`,
    footer: 'Automated website audit. Manual review is still required for legal compliance.',
  },
};

export function brandedCopy(language: FindingLanguage): ReportCopy {
  return { ...REPORT_COPY[language], ...BRANDED_COPY_OVERRIDES[language] };
}

export function brandPalette(brand: ReportBrand): ReportPalette {
  return { ...REPORT_COLOURS, brand: brand.accent ?? REPORT_COLOURS.text };
}

export function preparedBy(name: string, language: FindingLanguage): string {
  return language === 'uk' ? `Підготовлено: ${name}` : `Prepared by ${name}`;
}

export function brandedCover(
  doc: ReportDocument,
  brand: ReportBrand,
  language: FindingLanguage,
): void {
  if (brand.logo !== null) doc.image(brand.logo.png, { width: 180, height: 56 });
  doc.text(brand.displayName, { font: 'bold', size: 12, colour: 'brand' });
  doc.rule('brand', 2);
  doc.text(preparedBy(brand.displayName, language), { colour: 'muted', size: 9 });
  if (brand.contactLine !== null) doc.text(brand.contactLine, { colour: 'muted', size: 9 });
}

export function brandedFilename(unbranded: string): string {
  return unbranded.replace(/^fluxradar-/, 'report-');
}

export function brandedProvenance(copy: ReportCopy, generatedAt: string | null): string {
  return [copy.aiGenerated, generatedAt]
    .filter((value) => value !== null && value !== '')
    .join(' · ');
}
