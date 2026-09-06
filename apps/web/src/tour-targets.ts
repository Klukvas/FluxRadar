// Stable hooks the onboarding tour uses to find what it highlights. Elements
// opt in with `data-tour-target="<name>"`, so the tour never has to match on
// text, class names or geometry — those change with copy edits and restyling.

export const TOUR_TARGET_ATTRIBUTE = 'data-tour-target';

export const tourTargets = {
  /** The whole application header: brand, tab strip and system controls. */
  workspaceHeader: 'workspace-header',
  /** The navigation container itself: the desktop tab strip and the mobile sheet. */
  workspaceTabs: 'workspace-tabs',
  /** Website address field of the add-site form. */
  profileDomain: 'profile-domain',
  /** Submit button of the add-site form. */
  saveProfile: 'save-profile',
} as const;

export function tourTargetSelector(name: string): string {
  return `[${TOUR_TARGET_ATTRIBUTE}="${name}"]`;
}

/**
 * Pick the first candidate that can actually anchor a spotlight.
 *
 * The header is responsive: on desktop the tab strip is a `display: contents`
 * wrapper (it has no box of its own, so its rect is empty and the header is the
 * element that visually contains the tabs), on a narrow viewport the same
 * wrapper is hidden until the burger opens it as a full-screen sheet. Ordering
 * the tab strip before the header therefore highlights the open mobile sheet
 * when it is on screen, and the full header — tabs on desktop, burger on
 * mobile — in every other case.
 *
 * If nothing is laid out (an environment without CSS, or a target that is not
 * mounted yet) the first existing candidate is returned so the tour still has
 * something to point at.
 */
export function resolveTourTarget(
  candidates: readonly string[],
  root: ParentNode = document,
): HTMLElement | null {
  const mounted = candidates
    .map((name) => root.querySelector<HTMLElement>(tourTargetSelector(name)))
    .filter((element): element is HTMLElement => element !== null);
  return mounted.find(canAnchorSpotlight) ?? mounted[0] ?? null;
}

function canAnchorSpotlight(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  if (view === null) return true;
  const { display, visibility } = view.getComputedStyle(element);
  // `display: contents` renders the children but no box for the element itself,
  // so its bounding rect is empty and would collapse the spotlight.
  return display !== 'none' && display !== 'contents' && visibility !== 'hidden';
}
