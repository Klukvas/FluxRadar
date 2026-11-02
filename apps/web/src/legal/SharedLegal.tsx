import type { JSX } from 'react';

import { SUPPORT_EMAIL } from '../brand';
import type { Language } from '../i18n';

export function SupportLink(): JSX.Element {
  return <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;
}

export function OperatorDetails({ language }: { readonly language: Language }): JSX.Element {
  if (language === 'ru') {
    return (
      <address className="legal-operator">
        <strong>ФЛП Павленко Андрей Владимирович</strong>
        <span>работает под коммерческим наименованием FluxLab</span>
        <span>РНУКПН: 3650600237</span>
        <span>Номер записи в ЕГР: 2010350000000049793</span>
        <span>Не зарегистрирован плательщиком НДС</span>
        <span>
          Украина, Киевская область, г. Бровары, ул. Владимира Великого, д. 8, кв. 64, 07400
        </span>
        <a href="tel:+380933602073">+380 93 360 20 73</a>
        <SupportLink />
      </address>
    );
  }
  if (language === 'uk') {
    return (
      <address className="legal-operator">
        <strong>ФОП Павленко Андрій Володимирович</strong>
        <span>працює під комерційним найменуванням FluxLab</span>
        <span>РНОКПП: 3650600237</span>
        <span>Номер запису в ЄДР: 2010350000000049793</span>
        <span>Не зареєстрований платником ПДВ</span>
        <span>
          Україна, Київська область, м. Бровари, вул. Володимира Великого, буд. 8, кв. 64, 07400
        </span>
        <a href="tel:+380933602073">+380 93 360 20 73</a>
        <SupportLink />
      </address>
    );
  }
  return (
    <address className="legal-operator">
      <strong>Pavlenko Andrii Volodymyrovich</strong>
      <span>Ukrainian individual entrepreneur trading as FluxLab</span>
      <span>Ukrainian taxpayer number: 3650600237</span>
      <span>Unified State Register record number: 2010350000000049793</span>
      <span>Not registered for VAT</span>
      <span>8 Volodymyra Velykoho Street, Apartment 64, Brovary, Kyiv Oblast, 07400, Ukraine</span>
      <a href="tel:+380933602073">+380 93 360 20 73</a>
      <SupportLink />
    </address>
  );
}

/** How each language says that a document is in force on a date. */
const IN_FORCE: Readonly<Record<Language, (date: EffectiveDate) => string>> = {
  en: (date) => `Effective ${date.en}`,
  uk: (date) => `Чинна з ${date.uk}`,
  ru: (date) => `Действует с ${date.ru}`,
};

/** When a document's current wording took effect, written out in each language. */
export interface EffectiveDate {
  readonly uk: string;
  readonly en: string;
  readonly ru: string;
}

/**
 * The date the legal documents first took effect. A document whose wording
 * changes later passes its own date, so the others keep the one that is still
 * true for them.
 */
const FIRST_EFFECTIVE: EffectiveDate = {
  uk: '10 вересня 2026 року',
  en: '10 September 2026',
  ru: '10 сентября 2026 года',
};

export function EffectiveNotice(props: {
  readonly language: Language;
  readonly documentName: string;
  readonly effectiveOn?: EffectiveDate;
}): JSX.Element {
  const date = props.effectiveOn ?? FIRST_EFFECTIVE;
  return (
    <div className="legal-document__notice">
      <strong>{IN_FORCE[props.language](date)}</strong>
      <span>{props.documentName}</span>
    </div>
  );
}
