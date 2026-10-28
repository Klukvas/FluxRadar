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

const LOGO_BOX = { width: 150, height: 36 } as const;
const NAME_X_AFTER_LOGO = 180;

/**
 * The agency's header block: logo, name in the agency colour, and who prepared
 * the report with how to reach them. Returns where the block ends.
 */
export function brandedCover(
  doc: ReportDocument,
  brand: ReportBrand,
  language: FindingLanguage,
): number {
  const top = doc.y;
  const left = doc.contentLeft;
  if (brand.logo !== null) doc.imageAt(brand.logo.png, left, top, LOGO_BOX);
  const textX = brand.logo === null ? left : NAME_X_AFTER_LOGO;
  const width = left + doc.contentWidth - textX;
  const nameBottom = doc.textAt(brand.displayName, textX, top + 2, {
    font: 'bold',
    size: 12,
    colour: 'structure',
    width,
  });
  const contact = [preparedBy(brand.displayName, language), brand.contactLine]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');
  const contactBottom = doc.textAt(contact, textX, nameBottom + 3, {
    size: 8,
    colour: 'muted',
    width,
  });
  return Math.max(brand.logo === null ? 0 : top + LOGO_BOX.height, contactBottom);
}

export function brandedFilename(unbranded: string): string {
  return unbranded.replace(/^fluxradar-/, 'report-');
}

export function brandedProvenance(copy: ReportCopy, generatedAt: string | null): string {
  return [copy.aiGenerated, generatedAt]
    .filter((value) => value !== null && value !== '')
    .join(' · ');
}
