// Which slide of the home page's slider is showing, and when it moves on.
//
// The rules come from what a slider does to a reader who is not in control of
// it (WCAG 2.2.2): it moves on only while nobody is pointing at it or working
// inside it, it stops for good the moment the visitor picks a slide, presses a
// key or swipes, and it never moves at all for a reader who asked the system
// for reduced motion. A stop/resume control is the one way back.
//
// Nothing runs during render: the reduced-motion query and every timer start
// in effects, so the prerendered page and the first client render agree, and a
// page with no JavaScript simply shows the first slide.

import { useCallback, useEffect, useRef, useState } from 'react';

/** How long one slide stays up while the slider advances on its own. */
export const SLIDE_INTERVAL_MS = 8000;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether this reader lets things move: false until mounted, false under
 * reduced motion, and kept in step if they change the setting while reading.
 */
function useMotionAllowed(): boolean {
  const [isAllowed, setAllowed] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      setAllowed(true);
      return undefined;
    }
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const sync = (): void => setAllowed(!query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return isAllowed;
}

export interface SlideAutoplay {
  readonly current: number;
  /** Advancing on its own right now, hold aside: drives the progress strip. */
  readonly isRunning: boolean;
  /** Paused by a pointer over it or focus inside it. */
  readonly isHeld: boolean;
  /** Whether the stop/resume control means anything for this reader. */
  readonly canAutoplay: boolean;
  /** Show a slide because the visitor asked for it: auto-advance ends. */
  readonly choose: (index: number) => void;
  /** End auto-advance without moving, for any other click, key or swipe. */
  readonly stop: () => void;
  /** The stop/resume control. */
  readonly toggle: () => void;
  readonly setHovered: (isHovered: boolean) => void;
  readonly setFocused: (isFocused: boolean) => void;
}

/** An index moved past either end comes back round: -1 is the last slide. */
export function wrapIndex(index: number, count: number): number {
  return ((index % count) + count) % count;
}

export function useSlideAutoplay(count: number, intervalMs = SLIDE_INTERVAL_MS): SlideAutoplay {
  const [current, setCurrent] = useState(0);
  const [isPlaying, setPlaying] = useState(true);
  const [isHovered, setHovered] = useState(false);
  const [isFocused, setFocused] = useState(false);
  const canAutoplay = useMotionAllowed();
  const isRunning = isPlaying && canAutoplay;
  const isHeld = isHovered || isFocused;
  // What is left of the current slide's time. A hold keeps it rather than
  // restarting it, so the strip under the tab — which CSS pauses in the same
  // place — and the clock never disagree about how long is left.
  const remainingMs = useRef(intervalMs);

  useEffect(() => {
    if (!isRunning || isHeld) return undefined;
    const startedAt = Date.now();
    let hasFired = false;
    const timer = window.setTimeout(() => {
      hasFired = true;
      remainingMs.current = intervalMs;
      setCurrent((index) => wrapIndex(index + 1, count));
    }, remainingMs.current);
    return () => {
      window.clearTimeout(timer);
      if (!hasFired) {
        remainingMs.current = Math.max(0, remainingMs.current - (Date.now() - startedAt));
      }
    };
  }, [isRunning, isHeld, current, count, intervalMs]);

  const stop = useCallback((): void => setPlaying(false), []);

  const choose = useCallback(
    (index: number): void => {
      setPlaying(false);
      setCurrent(wrapIndex(index, count));
    },
    [count],
  );

  const toggle = useCallback((): void => {
    if (isPlaying) {
      setPlaying(false);
      return;
    }
    // A resumed slider gives the slide on screen its full time again.
    remainingMs.current = intervalMs;
    setPlaying(true);
  }, [isPlaying, intervalMs]);

  return { current, isRunning, isHeld, canAutoplay, choose, stop, toggle, setHovered, setFocused };
}
