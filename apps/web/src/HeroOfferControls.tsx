// The row under the home page slider's slides: previous, "N of 5", next, and
// the stop/resume control for its auto-advance.

import { heroOfferCopy, OFFER_SLIDE_IDS } from './hero-offer-copy';
import type { Language } from './i18n';
import type { SlideAutoplay } from './use-slide-autoplay';

export function HeroOfferControls(props: { language: Language; autoplay: SlideAutoplay }) {
  const t = heroOfferCopy[props.language];
  const { autoplay } = props;
  return (
    <div className="hero-offer__controls">
      <button
        className="button button--default hero-offer__nav"
        type="button"
        aria-label={t.previous}
        onClick={() => autoplay.choose(autoplay.current - 1)}
      >
        ←
      </button>
      <span className="hero-offer__count">
        {t.position(autoplay.current + 1, OFFER_SLIDE_IDS.length)}
      </span>
      <button
        className="button button--default hero-offer__nav"
        type="button"
        aria-label={t.next}
        onClick={() => autoplay.choose(autoplay.current + 1)}
      >
        →
      </button>
      {/* Only where the slider may move at all: under reduced motion, and
          before JavaScript runs, there is nothing to stop. */}
      {autoplay.canAutoplay ? (
        <button
          className="button button--default hero-offer__auto"
          type="button"
          data-autoplay-toggle=""
          onClick={autoplay.toggle}
        >
          {autoplay.isRunning ? t.stop : t.resume}
        </button>
      ) : null}
    </div>
  );
}
