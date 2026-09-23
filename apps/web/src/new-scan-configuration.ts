import { apiRequest, type Scan } from './api';
import { copy, fillCopy, type Language } from './i18n';
import type { Plan } from './plan-modules';
import { clampScopeToPlan, scopeFormFromScan, type ScanScopeForm } from './scan-scope';

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
