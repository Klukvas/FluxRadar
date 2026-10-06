import { apiRequest, type Scan, type SiteProfile } from './api';
import { copy, fillCopy, type Language } from './i18n';
import type { Plan } from './plan-modules';
import {
  clampScopeToPlan,
  profileScanConfigFingerprint,
  profileScanConfigFromForm,
  scopeFormFromProfileConfig,
  scopeFormFromScan,
  type ScanScopeForm,
} from './scan-scope';

/**
 * Where the new-scan form's starting settings come from, and what it calls them.
 *
 * A profile saves the settings its next scan opens on. Profiles made before
 * that existed have none, so the form falls back to the last scan they ran —
 * a compatibility read, which is why a failure here is a missing prefill and
 * not a failed submission.
 */

/** What the form can say about the settings it is holding. */
export type ConfigurationState = 'new' | 'loading' | 'dirty' | 'saved';

/**
 * The settings a profile's last scan ran with, or null when it has none.
 *
 * Brought inside the chosen plan on the way in, not only on the way out: the
 * payload is clamped as well (`scanScopeFrom`), but a form showing a
 * Complete-sized page count while Basic is selected is offering a scan that is
 * not the one the checkout would open on.
 */
export async function scopeFromLastScan(
  profileId: string,
  plan: Plan,
): Promise<ScanScopeForm | null> {
  let latest: Scan | undefined;
  try {
    const scans = await apiRequest<readonly Scan[] | null>(
      `/profiles/${encodeURIComponent(profileId)}/scans?limit=1&offset=0`,
    );
    latest = Array.isArray(scans) ? scans[0] : undefined;
  } catch (caught) {
    // The form opens on its defaults, which is what a profile with no scans
    // gets anyway. Logged because a prefill silently missing every time is how
    // a broken endpoint stays unnoticed.
    console.error('FluxRadar previous scan settings unavailable', caught);
    return null;
  }
  return latest === undefined ? null : clampScopeToPlan(scopeFormFromScan(latest), plan);
}

/** The state of the settings: unsaved edits, a stored version, or neither yet. */
export function configurationStateOf(input: {
  readonly usingSavedProfile: boolean;
  readonly loading: boolean;
  readonly savedFingerprint: string | null;
  readonly dirty: boolean;
}): ConfigurationState {
  if (!input.usingSavedProfile) return 'new';
  if (input.loading) return 'loading';
  if (input.savedFingerprint === null) return 'new';
  return input.dirty ? 'dirty' : 'saved';
}

/** The chip beside the settings, in the shell's language. */
export function configurationStatusLabel(
  state: ConfigurationState,
  language: Language,
  savedVersion: number | null,
): string {
  const t = copy[language].newScan;
  if (state === 'dirty') return t.configurationUnsaved;
  if (state === 'new') return t.configurationNew;
  if (state === 'loading') return t.configurationLoading;
  return fillCopy(t.configurationSaved, { version: savedVersion ?? 1 });
}

/** The form state a profile's own saved configuration opens on. */
export interface RestoredProfileForm {
  readonly plan: Plan;
  readonly scope: ScanScopeForm;
  /** The fingerprint of what the profile holds, which "Saved · version N" is read against. */
  readonly fingerprint: string;
  readonly version: number;
  /**
   * Whether the form already differs from the profile the moment it loads.
   *
   * The clamp can move a saved value: a page count saved when the plan's
   * ceiling was higher comes back inside today's ceiling, so the form no longer
   * holds what the profile holds. The panel said "Saved · version N" over it
   * and the launch then PATCHed a new version without the screen ever saying it
   * would. Compared on the saved plan, not the restored one, so the transient
   * Free-instead-of-Basic fallback is not read as an edit (that one is
   * suppressed by `unavailablePlanFallback` as well).
   */
  readonly hasUnsavedChanges: boolean;
}

/**
 * What a saved profile puts in the form: its plan, its scope under today's
 * ceiling, and whether the two already disagree.
 *
 * Derivation only — the effect below applies it. Called with a profile whose
 * `scanConfig` is known to be there.
 */
export function restoredProfileForm(
  profile: SiteProfile,
  paidAvailable: boolean,
): RestoredProfileForm {
  const savedConfig = profile.scanConfig;
  if (savedConfig == null) throw new Error('restoredProfileForm needs a saved configuration');
  const scope = clampScopeToPlan(scopeFormFromProfileConfig(savedConfig), savedConfig.plan);
  return {
    plan: paidAvailable ? savedConfig.plan : 'Free',
    scope,
    fingerprint: profileScanConfigFingerprint(savedConfig),
    version: profile.scanConfigVersion ?? 1,
    // Assigned rather than only raised: loading a profile's settings is not an
    // edit, so a clean load clears the flag.
    hasUnsavedChanges:
      profileScanConfigFingerprint(profileScanConfigFromForm(scope, savedConfig.plan)) !==
      profileScanConfigFingerprint(savedConfig),
  };
}
