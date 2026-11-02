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
  ru: {
    fields: {
      displayName: 'Укажите название до 80 символов без скрытых или управляющих символов.',
      accentColor: 'Укажите код #rrggbb с контрастом к белому от 3:1 или оставьте поле пустым.',
      contactLine: 'Контакты должны содержать до 160 символов одной строкой без скрытых символов.',
      logo: 'Проверьте PNG и попробуйте ещё раз.',
    },
    title: 'Оформление отчётов для клиентов',
    lead: 'Добавьте свой логотип, название и цвет. PDF и страница для печати отчётов Complete выйдут под вашим брендом, без упоминания FluxRadar.',
    eligibility: 'Отчёты других тарифов выходят с оформлением FluxRadar.',
    enabled: 'Использовать мой бренд в отчётах',
    name: 'Название в отчёте',
    nameHint: 'Например, название вашего агентства. До 80 символов.',
    accent: 'Цвет акцента (необязательно)',
    accentHint: 'Код цвета, например #1f4fd8. Им выделено название на обложке.',
    accentLow: 'Этот цвет почти не виден на белом. Выберите темнее или оставьте поле пустым.',
    contact: 'Контакты (необязательно)',
    contactHint: 'Одна строка на обложке: телефон, email, мессенджер или сайт.',
    logo: 'Логотип',
    choose: 'Выбрать PNG',
    logoHint: 'PNG до 256 КБ и до 2048 пикселей по каждой стороне, лучше с прозрачным фоном.',
    remove: 'Убрать логотип',
    save: 'Сохранить',
    saving: 'Сохраняем…',
    saved: 'Оформление сохранено.',
    delete: 'Удалить оформление',
    deleteTitle: 'Удалить оформление?',
    deleteBody:
      'Отчёты снова будут выходить с оформлением FluxRadar, а логотип, название и цвет исчезнут. Это действие нельзя отменить.',
    keep: 'Оставить оформление',
    deleted: 'Оформление удалено. Отчёты снова выходят с оформлением FluxRadar.',
    loadFailed: 'Не удалось загрузить оформление. Обновите страницу.',
    loading: 'Загружаем оформление…',
    notConfigured: 'Оформление ещё не настроено.',
    brandApplied: (name) => `Документ оформлен под бренд «${name}».`,
    brandFailed:
      'Не удалось загрузить ваше оформление, поэтому документ имеет оформление FluxRadar.',
    headersHint: 'Если браузер добавил адрес страницы, выключите «Колонтитулы» в окне печати.',
    errors: {
      LOGO_TOO_LARGE: 'Файл больше 256 КБ. Уменьшите его и попробуйте ещё раз.',
      LOGO_UNSUPPORTED_TYPE: 'Подходит только PNG.',
      LOGO_BAD_DIMENSIONS:
        'Размер не подходит: до 2048 пикселей по каждой стороне, более длинная сторона от 64, ширина не более чем в 8 раз больше высоты.',
      LOGO_UNREADABLE:
        'Не удалось прочитать этот PNG. Сохраните его ещё раз в графическом редакторе без чересстрочного режима.',
    },
    other: 'Не удалось сохранить. Проверьте поля и попробуйте ещё раз.',
  },
};

export function brandingError(language: Language, code: string): string {
  return reportBrandingCopy[language].errors[code] ?? reportBrandingCopy[language].other;
}
