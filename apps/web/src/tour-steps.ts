import { tourTargets } from './tour-targets';

// Which element each tour step highlights lives here, not in the translations,
// so the English and Ukrainian copy can never drift apart on what is on screen.
// Translations supply only the title and body for each step id.

export type TourStepId = 'workspace-tabs' | 'profile-domain' | 'save-profile' | 'run-scan';

export interface TourStep {
  readonly id: TourStepId;
  /** Targets in priority order; the first one that is laid out is highlighted. */
  readonly targets: readonly string[];
}

const headerTargets = [tourTargets.workspaceTabs, tourTargets.workspaceHeader] as const;

export interface TourStepText {
  readonly title: string;
  readonly body: string;
}

/**
 * Identity helper that forces every locale to supply copy for every step id,
 * so a new or renamed step cannot ship translated in one language only.
 */
export function tourStepCopy(
  steps: Record<TourStepId, TourStepText>,
): Record<TourStepId, TourStepText> {
  return steps;
}

export const tourSteps: readonly TourStep[] = [
  { id: 'workspace-tabs', targets: headerTargets },
  { id: 'profile-domain', targets: [tourTargets.profileDomain] },
  { id: 'save-profile', targets: [tourTargets.saveProfile] },
  { id: 'run-scan', targets: headerTargets },
];
