import { useEffect, useRef } from 'react';

import type { NewScanFormProps } from './new-scan-form';
import { DEFAULT_SCOPE_FORM, type ScanScopeForm } from './scan-scope';

// Two decisions the new-scan form makes about what it opens on: which site,
// and whether the folded crawl settings have to be on screen. Kept beside
// `new-scan-form.ts` so the hook holding the form's state stays one subject.

/**
 * Whether anything inside "For experienced users" differs from what a new
 * profile starts on. Free shows only the user agent there, so only it counts.
 * The country counts once the deployment has named its default: before that,
 * a stored location cannot be told apart from the default one.
 */
export function expertSettingsChanged(
  scope: ScanScopeForm,
  paidScopeControls: boolean,
  defaultEgressLocation: string | null,
): boolean {
  if (scope.userAgent !== DEFAULT_SCOPE_FORM.userAgent) return true;
  if (!paidScopeControls) return false;
  const countryChanged =
    defaultEgressLocation !== null &&
    scope.egressLocation !== '' &&
    scope.egressLocation !== defaultEgressLocation;
  return (
    countryChanged ||
    scope.includeSubdomains !== DEFAULT_SCOPE_FORM.includeSubdomains ||
    scope.maxPages.trim() !== DEFAULT_SCOPE_FORM.maxPages ||
    scope.maxDepth.trim() !== DEFAULT_SCOPE_FORM.maxDepth ||
    scope.renderJs !== DEFAULT_SCOPE_FORM.renderJs ||
    scope.respectRobots !== DEFAULT_SCOPE_FORM.respectRobots
  );
}

/**
 * Keeps the selected site on the one the owner asked for.
 *
 * The screen opens on `selectedProfile` — the row whose "New scan" was pressed.
 * A selection made after the screen mounted (or a profile list that arrived
 * after it) used to be ignored, leaving the form on whichever site it first
 * picked. A refreshed profile list must not undo the owner's own pick in the
 * dropdown, so only a CHANGED selection moves the target; otherwise the target
 * moves only when it no longer names a saved profile.
 */
export function useFollowSelectedProfile(
  props: Pick<NewScanFormProps, 'profiles' | 'selectedProfile'>,
  target: string,
  setTarget: (target: string) => void,
): void {
  const requested = props.selectedProfile?.id ?? '';
  const lastRequested = useRef(requested);
  const { profiles } = props;
  useEffect(() => {
    const isSaved = (id: string): boolean =>
      id !== '' && profiles.some((profile) => profile.id === id);
    if (requested !== lastRequested.current) {
      lastRequested.current = requested;
      if (isSaved(requested)) {
        setTarget(requested);
        return;
      }
    }
    if (isSaved(target)) return;
    const fallback = isSaved(requested) ? requested : (profiles[0]?.id ?? '');
    if (fallback !== target) setTarget(fallback);
  }, [profiles, requested, setTarget, target]);
}
