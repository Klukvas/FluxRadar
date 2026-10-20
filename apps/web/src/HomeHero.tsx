// The home page's first screen, in the words of the people it is for.
//
// It used to open on a typed brand line, an audit-station label, counters and a
// terminal panel; four reviews by small-business personas read all of that as
// "a tool for programmers". What is left says what we do, asks for the site,
// says what happens next and what it costs, and shows a report beside it.

import { HeroExampleReport } from './HeroExampleReport';
import { HeroSiteForm } from './HeroSiteForm';
import { copy, fillCopy, type Language } from './i18n';
import { BASIC_PRICE } from './tariff-prices';
import './styles/home-hero.css';

export function HomeHero(props: {
  language: Language;
  /** The site the visitor typed, or null for an empty field. */
  onStartSite: (site: string | null) => void;
  onSeePricing: () => void;
}) {
  const t = copy[props.language].home.hero;
  return (
    <section className="home__hero" aria-labelledby="home-title">
      <div className="home__hero-copy home-hero__panel">
        <h1 id="home-title">{t.title}</h1>
        <p className="home__lede">{t.lede}</p>
        <HeroSiteForm
          language={props.language}
          label={t.formLabel}
          placeholder={t.formPlaceholder}
          submitLabel={t.submit}
          // The cheapest paid report, read from the one table every price on
          // the site comes from.
          note={fillCopy(t.note, { price: BASIC_PRICE })}
          onStart={props.onStartSite}
        />
        {/* role="list": Safari drops list semantics from a list styled with
            `list-style: none`, and VoiceOver then reads three loose lines. */}
        <ul className="home-hero__trust" role="list">
          {t.trust.map((item) => (
            <li key={item}>
              <span className="home-hero__check" aria-hidden="true">
                ✓
              </span>
              {item}
            </li>
          ))}
        </ul>
        <a className="home__text-action" href="#pricing">
          {t.pricingLink} <span aria-hidden="true">↓</span>
        </a>
      </div>
      <HeroExampleReport language={props.language} />
    </section>
  );
}
