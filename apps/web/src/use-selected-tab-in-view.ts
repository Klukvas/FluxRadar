// Keeps the selected tab of a sideways-scrolling tab strip on screen.
//
// On a phone the slider's five labels are wider than the window, so the strip
// scrolls inside it. When the slider moves on by itself, or a swipe or an
// arrow picks a tab past the edge, the selected tab would be out of sight and
// the strip would no longer say where the reader is. The strip itself is
// scrolled — `scrollIntoView` could move the whole page under the reader —
// and only when the tab is not already fully visible.

import { useEffect, type RefObject } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function useSelectedTabInView(
  stripRef: RefObject<HTMLElement | null>,
  current: number,
): void {
  useEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (strip == null || tab == null || typeof strip.scrollTo !== 'function') return;
    const stripBox = strip.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    if (tabBox.left >= stripBox.left && tabBox.right <= stripBox.right) return;
    // Centre the tab in the strip, so its neighbours show on both sides.
    const offset = tabBox.left - stripBox.left - (stripBox.width - tabBox.width) / 2;
    strip.scrollTo({
      left: Math.max(0, strip.scrollLeft + offset),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [stripRef, current]);
}
