// The window beside the hero form: what a report on a small business's site
// reads like, before the visitor has typed anything. It is a picture of the
// product, so it is static — but it is real text in a labelled region, not an
// image, so a screen reader and a translator get the same three findings a
// sighted visitor does.

import { useId } from 'react';

import { EXAMPLE_REPORT_PATH } from './app-routes';
import { copy, type Language } from './i18n';

export function HeroExampleReport(props: { language: Language }) {
  const t = copy[props.language].home.hero.example;
  const titleId = useId();
  return (
    <section className="home-hero__window" aria-labelledby={titleId}>
      <div className="home-hero__window-bar">
        <h2 id={titleId} className="home-hero__window-title">
          {t.title}
        </h2>
      </div>
      <div className="home-hero__window-head">
        <p className="home-hero__window-site">{t.site}</p>
        <p className="home-hero__window-meta">{t.meta}</p>
      </div>
      {/* role="list" keeps the findings a list in Safari, which drops the
          semantics of an unstyled list. */}
      <ul className="home-hero__findings" role="list">
        {t.findings.map((finding) => (
          <li
            key={finding.problem}
            className={
              finding.priority === 'first'
                ? 'home-hero__finding home-hero__finding--first'
                : 'home-hero__finding'
            }
          >
            <span className="home-hero__chip">{finding.chip}</span>
            <p className="home-hero__problem">{finding.problem}</p>
            <p className="home-hero__todo">{finding.action}</p>
          </li>
        ))}
      </ul>
      <div className="home-hero__window-foot">
        <span>{t.disclaimer}</span>
        <a href={EXAMPLE_REPORT_PATH}>
          {t.link} <span aria-hidden="true">→</span>
        </a>
      </div>
    </section>
  );
}
