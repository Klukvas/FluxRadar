// The first slide of the window beside the hero form: what a report on a small
// business's site reads like, before the visitor has typed anything. It is a
// picture of the product, but it is real text, not an image, so a screen
// reader and a translator get the same three findings a sighted visitor does.
// It is also the slide the prerendered page shows, so a reader with no
// JavaScript gets this one whole.

import { SlideIncludes } from './HeroOfferSlideParts';
import { seoChecksCaption } from './hero-offer-content';
import { copy, type Language } from './i18n';

export function HeroExampleReport(props: { language: Language }) {
  const t = copy[props.language].home.hero.example;
  return (
    <>
      {/* A heading like every other slide's, so a screen reader's heading
          list names all five; the site's name stays the line under it. */}
      <div className="home-hero__window-head">
        <h3 className="hero-offer__question">{t.title}</h3>
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
      <SlideIncludes lead={seoChecksCaption(props.language)} />
    </>
  );
}
