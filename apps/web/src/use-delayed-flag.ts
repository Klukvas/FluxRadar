import { useEffect, useState } from 'react';

/**
 * True only after `active` has stayed true for `ms` milliseconds.
 *
 * The loading holdback behind every skeleton: a fetch that answers in under
 * `ms` never renders its placeholder, so a fast response cannot flash one, and
 * a slow response shows the skeleton after the delay instead of a spinner that
 * replaces a layout the screen already knows.
 */
export function useDelayedFlag(active: boolean, ms = 200): boolean {
  const [flagged, setFlagged] = useState(false);
  useEffect(() => {
    if (!active) {
      setFlagged(false);
      return;
    }
    const timer = window.setTimeout(() => setFlagged(true), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return flagged;
}
