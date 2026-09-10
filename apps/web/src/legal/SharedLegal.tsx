import type { JSX } from 'react';

import { SUPPORT_EMAIL } from '../brand';
import type { Language } from '../i18n';

export function SupportLink(): JSX.Element {
  return <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;
}

export function OperatorDetails({ language }: { readonly language: Language }): JSX.Element {
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

export function EffectiveNotice(props: {
  readonly language: Language;
  readonly documentName: string;
}): JSX.Element {
  return (
    <div className="legal-document__notice">
      <strong>
        {props.language === 'uk' ? 'Чинна з 10 вересня 2026 року' : 'Effective 10 September 2026'}
      </strong>
      <span>{props.documentName}</span>
    </div>
  );
}
