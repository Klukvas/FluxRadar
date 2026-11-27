// What the home page slider's window does with the visitor's hands: a mouse
// over it or keyboard focus inside it holds the clock, any other click, key or
// swipe ends auto-advance for good (`use-slide-autoplay.ts` keeps the clock).

import {
  useEffect,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type TouchEvent,
} from 'react';

import type { SlideAutoplay } from './use-slide-autoplay';

/** How far a finger must travel sideways before a touch counts as a swipe. */
const SWIPE_MIN_PX = 40;
/** How much more sideways than vertical a swipe must be, so scrolling the page is not one. */
const SWIPE_DOMINANCE = 1.5;

/**
 * Keys that never end auto-advance: Tab and Shift+Tab move focus through the
 * window, which holds it, and a modifier pressed alone does nothing yet.
 */
const PASSIVE_KEYS: readonly string[] = ['Tab', 'Shift', 'Control', 'Alt', 'Meta'];

function isInsideToggle(target: EventTarget): boolean {
  return target instanceof Element && target.closest('[data-autoplay-toggle]') !== null;
}

export interface SliderWindowEvents {
  readonly window: {
    readonly onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerLeave: () => void;
    readonly onPointerDown: () => void;
    readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
    readonly onBlur: (event: FocusEvent<HTMLElement>) => void;
    readonly onClick: (event: { target: EventTarget }) => void;
    readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  };
  readonly swipe: {
    readonly onTouchStart: (event: TouchEvent<HTMLElement>) => void;
    readonly onTouchEnd: (event: TouchEvent<HTMLElement>) => void;
  };
}

/** True from a press until it is released anywhere, or read by the focus it caused. */
function usePointerPress() {
  const isPointerPress = useRef(false);
  // Released anywhere: a press that starts inside and ends outside (a drag
  // selection, a context menu) must not leave later keyboard focus unheld.
  useEffect(() => {
    const release = (): void => {
      isPointerPress.current = false;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);
  return isPointerPress;
}

function useSwipe(autoplay: SlideAutoplay): SliderWindowEvents['swipe'] {
  const touchStart = useRef<{ readonly x: number; readonly y: number } | null>(null);
  return {
    onTouchStart: (event) => {
      const touch = event.changedTouches[0];
      touchStart.current = touch === undefined ? null : { x: touch.clientX, y: touch.clientY };
    },
    onTouchEnd: (event) => {
      const start = touchStart.current;
      const touch = event.changedTouches[0];
      touchStart.current = null;
      if (start === null || touch === undefined) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * SWIPE_DOMINANCE) return;
      autoplay.choose(autoplay.current + (dx < 0 ? 1 : -1));
    },
  };
}

export function useSliderWindowEvents(autoplay: SlideAutoplay): SliderWindowEvents {
  const isPointerPress = usePointerPress();
  const swipe = useSwipe(autoplay);
  return {
    window: {
      onPointerEnter: (event) => {
        if (event.pointerType === 'mouse') autoplay.setHovered(true);
      },
      onPointerLeave: () => autoplay.setHovered(false),
      onPointerDown: () => {
        isPointerPress.current = true;
      },
      // Only keyboard focus holds the slider. A mouse or finger press focuses
      // the button it lands on too, and holding for that left "Play
      // automatically" doing nothing until the visitor clicked somewhere else.
      onFocus: (event) => {
        const isFocusVisible =
          event.target instanceof Element && event.target.matches(':focus-visible');
        autoplay.setFocused(!isPointerPress.current && isFocusVisible);
        isPointerPress.current = false;
      },
      onBlur: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) autoplay.setFocused(false);
      },
      // Any click or key press in the window, other than on the stop/resume
      // control, is the visitor taking over: auto-advance ends for good.
      onClick: (event) => {
        if (!isInsideToggle(event.target)) autoplay.stop();
      },
      onKeyDown: (event) => {
        if (!PASSIVE_KEYS.includes(event.key) && !isInsideToggle(event.target)) autoplay.stop();
      },
    },
    swipe,
  };
}
