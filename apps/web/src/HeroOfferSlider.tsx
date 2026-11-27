// The window beside the hero form: what the platform offers, one topic per
// slide — the report, AI assistants, security, the action plan and the message
// for a developer.
//
// It replaced a window that showed only the example report. Every topic is a
// labelled tab, so a visitor reads all five names without waiting for the
// slider to reach them, and the tabs are real ARIA tabs (roving tabindex,
// arrows, Home and End). The timing rules live in `use-slide-autoplay.ts`.
//
// All five slides are in the markup and share one grid cell, so the window is
// as tall as the tallest of them at any width and nothing beside or below it
// moves when a slide changes. The prerendered page shows the first slide and
// every tab label; the rest is hidden until JavaScript can switch to it.

import { useId, type CSSProperties, type ReactNode } from 'react';

import { HeroExampleReport } from './HeroExampleReport';
import { HeroOfferControls } from './HeroOfferControls';
import {
  ActionPlanSlide,
  AiAnswersSlide,
  DeveloperTaskSlide,
  SecuritySlide,
} from './HeroOfferSlides';
import { HeroOfferTabs } from './HeroOfferTabs';
import { heroOfferCopy, OFFER_SLIDE_IDS, type OfferSlideId } from './hero-offer-copy';
import { copy, type Language } from './i18n';
import { publicPagePath } from './public-page-routing';
import { useSliderWindowEvents, type SliderWindowEvents } from './use-slider-window-events';
import { SLIDE_INTERVAL_MS, useSlideAutoplay } from './use-slide-autoplay';
import './styles/hero-offer-slider.css';

const SLIDES: Readonly<Record<OfferSlideId, (props: { language: Language }) => ReactNode>> = {
  report: HeroExampleReport,
  ai: AiAnswersSlide,
  security: SecuritySlide,
  plan: ActionPlanSlide,
  developer: DeveloperTaskSlide,
};

/**
 * The slides whose content the full example report also shows: the report
 * itself and the developer message. It has no AI answers, Security section or
 * action plan, so under those slides the foot does not offer it.
 */
const FULL_EXAMPLE_SLIDES: readonly OfferSlideId[] = ['report', 'developer'];

/** The progress strip's run time, from the same constant as the clock. */
const TIMING = { '--hero-offer-slide-ms': `${SLIDE_INTERVAL_MS}ms` } as CSSProperties;

function SlidePanels(props: {
  language: Language;
  current: number;
  isRunning: boolean;
  tabId: (index: number) => string;
  panelId: (index: number) => string;
  swipe: SliderWindowEvents['swipe'];
}) {
  return (
    // Silent while it advances on its own, so a screen reader is not read a
    // new slide every eight seconds; polite once the visitor drives it.
    <div
      className="hero-offer__viewport"
      aria-live={props.isRunning ? 'off' : 'polite'}
      {...props.swipe}
    >
      {OFFER_SLIDE_IDS.map((slide, index) => {
        const isCurrent = index === props.current;
        const Slide = SLIDES[slide];
        return (
          <div
            key={slide}
            className={`hero-offer__slide${isCurrent ? ' is-active' : ''}`}
            role="tabpanel"
            id={props.panelId(index)}
            aria-labelledby={props.tabId(index)}
            inert={!isCurrent}
            // Four of the five panels hold nothing focusable, so the panel
            // itself is the stop after the tabs.
            tabIndex={0}
          >
            <Slide language={props.language} />
          </div>
        );
      })}
    </div>
  );
}

function WindowFoot(props: { language: Language; slide: OfferSlideId | undefined }) {
  const example = copy[props.language].home.hero.example;
  const hasFullExample = props.slide !== undefined && FULL_EXAMPLE_SLIDES.includes(props.slide);
  return (
    <div className="home-hero__window-foot">
      <span>{example.disclaimer}</span>
      {/* Hidden rather than removed, so the foot keeps its height. */}
      <a
        href={publicPagePath('exampleReport', props.language)}
        className={hasFullExample ? undefined : 'hero-offer__foot-link--hidden'}
        aria-hidden={hasFullExample ? undefined : true}
        tabIndex={hasFullExample ? undefined : -1}
      >
        {example.link} <span aria-hidden="true">→</span>
      </a>
    </div>
  );
}

export function HeroOfferSlider(props: { language: Language }) {
  const baseId = useId();
  const autoplay = useSlideAutoplay(OFFER_SLIDE_IDS.length);
  const events = useSliderWindowEvents(autoplay);
  const tabId = (index: number): string => `${baseId}-tab-${index}`;
  const panelId = (index: number): string => `${baseId}-panel-${index}`;
  const windowClass = ['home-hero__window', 'hero-offer']
    .concat(autoplay.isRunning ? ['is-auto'] : [], autoplay.isHeld ? ['is-held'] : [])
    .join(' ');
  return (
    <section
      className={windowClass}
      style={TIMING}
      aria-roledescription={heroOfferCopy[props.language].roleDescription}
      aria-labelledby={`${baseId}-title`}
      {...events.window}
    >
      <div className="home-hero__window-bar">
        <h2 id={`${baseId}-title`} className="home-hero__window-title">
          {heroOfferCopy[props.language].windowTitle}
        </h2>
      </div>
      <HeroOfferTabs
        language={props.language}
        current={autoplay.current}
        tabId={tabId}
        panelId={panelId}
        onChoose={autoplay.choose}
      />
      <SlidePanels
        language={props.language}
        current={autoplay.current}
        isRunning={autoplay.isRunning}
        tabId={tabId}
        panelId={panelId}
        swipe={events.swipe}
      />
      <HeroOfferControls language={props.language} autoplay={autoplay} />
      <WindowFoot language={props.language} slide={OFFER_SLIDE_IDS[autoplay.current]} />
    </section>
  );
}
