// The labelled tab strip of the home page slider: every topic named, so a
// visitor reads all five without waiting for the slider to reach them. Real
// ARIA tabs — roving tabindex, arrows, Home and End — kept in view on a phone,
// where the strip scrolls sideways (`use-selected-tab-in-view.ts`).

import { useRef, type KeyboardEvent } from 'react';

import { heroOfferCopy, OFFER_SLIDE_IDS } from './hero-offer-copy';
import type { Language } from './i18n';
import { useSelectedTabInView } from './use-selected-tab-in-view';
import { wrapIndex } from './use-slide-autoplay';

/** The tablist keys and the slide each one moves to, from the one showing. */
function keyTarget(key: string, current: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return current + 1;
    case 'ArrowLeft':
      return current - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

export function HeroOfferTabs(props: {
  language: Language;
  current: number;
  tabId: (index: number) => string;
  panelId: (index: number) => string;
  onChoose: (index: number) => void;
}) {
  const t = heroOfferCopy[props.language];
  const count = OFFER_SLIDE_IDS.length;
  const tablist = useRef<HTMLDivElement>(null);
  useSelectedTabInView(tablist, props.current);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = keyTarget(event.key, props.current, count);
    if (target === null) return;
    event.preventDefault();
    const index = wrapIndex(target, count);
    props.onChoose(index);
    // Roving tabindex: focus follows the selection onto the new tab.
    document.getElementById(props.tabId(index))?.focus();
  };

  return (
    <div
      className="hero-offer__tabs"
      ref={tablist}
      role="tablist"
      aria-label={t.tablistLabel}
      onKeyDown={onKeyDown}
    >
      {OFFER_SLIDE_IDS.map((slide, index) => {
        const isCurrent = index === props.current;
        return (
          <button
            key={slide}
            className="hero-offer__tab"
            type="button"
            role="tab"
            id={props.tabId(index)}
            aria-controls={props.panelId(index)}
            aria-selected={isCurrent}
            tabIndex={isCurrent ? 0 : -1}
            onClick={() => props.onChoose(index)}
          >
            {t.tabs[slide]}
            <span className="hero-offer__tab-bar" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
