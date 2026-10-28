import type { Language } from './i18n';

type BrandingCopy = {
  fields: Readonly<Record<'displayName' | 'accentColor' | 'contactLine' | 'logo', string>>;
  title: string;
  lead: string;
  eligibility: string;
  enabled: string;
  name: string;
  nameHint: string;
  accent: string;
  accentHint: string;
  accentLow: string;
  contact: string;
  contactHint: string;
  logo: string;
  choose: string;
  logoHint: string;
  remove: string;
  save: string;
  saving: string;
  saved: string;
  delete: string;
  deleteTitle: string;
  deleteBody: string;
  keep: string;
  deleted: string;
  loadFailed: string;
  loading: string;
  notConfigured: string;
  brandApplied: (name: string) => string;
  brandFailed: string;
  headersHint: string;
  errors: Readonly<Record<string, string>>;
  other: string;
};
export const reportBrandingCopy: Record<Language, BrandingCopy> = {
  uk: {
    fields: {
      displayName: 'Вкажіть назву до 80 символів без прихованих або керівних символів.',
      accentColor: 'Вкажіть код #rrggbb із контрастом до білого від 3:1 або залиште поле порожнім.',
      contactLine: 'Контакти мають містити до 160 символів одним рядком без прихованих символів.',
      logo: 'Перевірте PNG і спробуйте ще раз.',
    },
    title: 'Оформлення звітів для клієнтів',
    lead: 'Додайте свій логотип, назву й колір. PDF і сторінка для друку звітів Complete вийдуть під вашим брендом, без згадки FluxRadar.',
    eligibility: 'Звіти інших тарифів виходять з оформленням FluxRadar.',
    enabled: 'Використовувати мій бренд у звітах',
    name: 'Назва у звіті',
    nameHint: 'Наприклад, назва вашої агенції. До 80 символів.',
    accent: 'Колір акценту (необовʼязково)',
    accentHint: 'Код кольору, наприклад #1f4fd8. Ним виділено назву на обкладинці.',
    accentLow: 'Цей колір майже не видно на білому. Оберіть темніший або залиште поле порожнім.',
    contact: 'Контакти (необовʼязково)',
    contactHint: 'Один рядок на обкладинці: телефон, email, месенджер або сайт.',
    logo: 'Логотип',
    choose: 'Обрати PNG',
    logoHint: 'PNG до 256 КБ і до 2048 пікселів по кожній стороні, краще з прозорим фоном.',
    remove: 'Прибрати логотип',
    save: 'Зберегти',
    saving: 'Зберігаємо…',
    saved: 'Оформлення збережено.',
    delete: 'Видалити оформлення',
    deleteTitle: 'Видалити оформлення?',
    deleteBody:
      'Звіти знову виходитимуть з оформленням FluxRadar, а логотип, назва й колір зникнуть. Цю дію не можна скасувати.',
    keep: 'Залишити оформлення',
    deleted: 'Оформлення видалено. Звіти знову виходять з оформленням FluxRadar.',
    loadFailed: 'Не вдалося завантажити оформлення. Оновіть сторінку.',
    loading: 'Завантажуємо оформлення…',
    notConfigured: 'Оформлення ще не налаштовано.',
    brandApplied: (name) => `Документ оформлено під бренд «${name}».`,
    brandFailed: 'Не вдалося завантажити ваше оформлення, тому документ має оформлення FluxRadar.',
    headersHint: 'Якщо браузер додав адресу сторінки, вимкніть «Колонтитули» у вікні друку.',
    errors: {
      LOGO_TOO_LARGE: 'Файл більший за 256 КБ. Зменште його й спробуйте ще раз.',
      LOGO_UNSUPPORTED_TYPE: 'Підходить лише PNG.',
      LOGO_BAD_DIMENSIONS:
        'Розмір не підходить: до 2048 пікселів по кожній стороні, довша сторона від 64, ширина не більше ніж у 8 разів за висоту.',
      LOGO_UNREADABLE:
        'Не вдалося прочитати цей PNG. Збережіть його ще раз у графічному редакторі без черезрядкового режиму.',
    },
    other: 'Не вдалося зберегти. Перевірте поля й спробуйте ще раз.',
  },
  en: {
    fields: {
      displayName: 'Enter a name of up to 80 characters without invisible or control characters.',
      accentColor: 'Enter a #rrggbb code with at least 3:1 contrast on white, or leave it empty.',
      contactLine: 'Use one contact line of up to 160 characters without invisible characters.',
      logo: 'Check the PNG and try again.',
    },
    title: 'Client report branding',
    lead: 'Add your logo, name and colour. The PDF and the printable page of Complete reports then carry your brand, with no mention of FluxRadar.',
    eligibility: 'Reports on other plans keep the FluxRadar design.',
    enabled: 'Use my brand in reports',
    name: 'Name on the report',
    nameHint: "For example, your agency's name. Up to 80 characters.",
    accent: 'Accent colour (optional)',
    accentHint: 'A colour code such as #1f4fd8. It marks your name on the cover.',
    accentLow: 'This colour barely shows on white. Pick a darker one or leave the field empty.',
    contact: 'Contact line (optional)',
    contactHint: 'One line on the cover: phone, email, messenger or website.',
    logo: 'Logo',
    choose: 'Choose PNG',
    logoHint: 'PNG up to 256 KB and 2048 pixels per side, ideally with a transparent background.',
    remove: 'Remove logo',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Branding saved.',
    delete: 'Delete branding',
    deleteTitle: 'Delete your branding?',
    deleteBody:
      'Reports will use the FluxRadar design again, and the logo, name and colour are gone. This cannot be undone.',
    keep: 'Keep branding',
    deleted: 'Branding deleted. Reports use the FluxRadar design again.',
    loadFailed: 'Branding could not be loaded. Reload the page.',
    loading: 'Loading branding…',
    notConfigured: 'Branding is not configured yet.',
    brandApplied: (name) => `This document carries the ${name} brand.`,
    brandFailed: 'Your branding could not be loaded, so this document uses the FluxRadar design.',
    headersHint:
      'If the browser adds the page address, turn off “Headers and footers” in the print dialog.',
    errors: {
      LOGO_TOO_LARGE: 'The file is larger than 256 KB. Make it smaller and try again.',
      LOGO_UNSUPPORTED_TYPE: 'Only PNG files are accepted.',
      LOGO_BAD_DIMENSIONS:
        'The size does not fit: up to 2048 pixels per side, the longer side at least 64, and no more than 8 times wider than tall.',
      LOGO_UNREADABLE:
        'This PNG could not be read. Save it again from an image editor, without interlacing.',
    },
    other: 'Could not save. Check the fields and try again.',
  },
};

export function brandingError(language: Language, code: string): string {
  return reportBrandingCopy[language].errors[code] ?? reportBrandingCopy[language].other;
}
