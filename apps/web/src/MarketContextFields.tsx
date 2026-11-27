// Services and industry, asked above the pay button of a paid check for a site
// that has neither (market-context-gate.ts says why the button waits for one).

import type { MarketContextGate } from './market-context-gate';
import { INDUSTRY_MAX_LENGTH, OFFERINGS_MAX_LENGTH } from './market-context-gate';
import { Field, TextAreaField } from './components';
import { copy, type Language } from './i18n';

/** Referenced by the pay button's `aria-describedby` while it waits. */
export const MARKET_CONTEXT_BLOCKED_ID = 'launch-blocked-market';

const marketContextCopy: Readonly<
  Record<Language, { heading: string; lead: string; blocked: string }>
> = {
  en: {
    heading: 'What do your customers search for?',
    lead: 'The AI section asks Claude and ChatGPT what your customers ask about your market, and it writes those questions from your services or industry. This site has neither yet. Add one, and it is saved to the site before checkout.',
    blocked: 'Add your services or industry to continue.',
  },
  uk: {
    heading: 'Що шукають ваші клієнти?',
    lead: 'Розділ ШІ запитує Claude і ChatGPT те, що ваші клієнти питають про ваш ринок, і складає ці питання з ваших послуг або галузі. У цього сайту поки немає ні того, ні іншого. Додайте щось одне, і ми збережемо це в сайті перед оплатою.',
    blocked: 'Додайте послуги або галузь, щоб продовжити.',
  },
  ru: {
    heading: 'Что ищут ваши клиенты?',
    lead: 'Раздел ИИ спрашивает Claude и ChatGPT то, что ваши клиенты спрашивают о вашем рынке, и составляет эти вопросы из ваших услуг или отрасли. У этого сайта пока нет ни того, ни другого. Добавьте что-то одно, и мы сохраним это в сайте перед оплатой.',
    blocked: 'Добавьте услуги или отрасль, чтобы продолжить.',
  },
};

export function MarketContextFields(props: {
  gate: MarketContextGate;
  language: Language;
  disabled: boolean;
}) {
  if (!props.gate.missing) return null;
  const c = marketContextCopy[props.language];
  const w = copy[props.language].workspace;
  return (
    <fieldset className="market-context" aria-describedby="market-context-lead">
      <legend className="market-context__heading">{c.heading}</legend>
      <p className="muted" id="market-context-lead">
        {c.lead}
      </p>
      <TextAreaField
        label={w.offerings}
        name="market-context-offerings"
        autoComplete="off"
        rows={2}
        value={props.gate.offerings}
        onChange={props.gate.setOfferings}
        placeholder={w.offeringsPlaceholder}
        maxLength={OFFERINGS_MAX_LENGTH}
        disabled={props.disabled}
      />
      <Field
        label={w.businessType}
        name="market-context-industry"
        autoComplete="off"
        value={props.gate.industry}
        onChange={props.gate.setIndustry}
        placeholder={w.businessTypePlaceholder}
        maxLength={INDUSTRY_MAX_LENGTH}
        disabled={props.disabled}
      />
      {props.gate.blocking ? (
        <p className="muted launch-form__blocked" id={MARKET_CONTEXT_BLOCKED_ID} role="note">
          {c.blocked}
        </p>
      ) : null}
    </fieldset>
  );
}
