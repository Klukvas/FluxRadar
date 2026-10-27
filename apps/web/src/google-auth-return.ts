import { isWorkspaceScreen, type InitialRoute } from './app-routes';
import type { VisitorIntent } from './app-state';

const DRAFT_KEY = 'fluxradar.google-intent';
const RETURN_KEY = 'fluxradar.google-return';
const LIFETIME_MS = 10 * 60 * 1000;
const PLANS = ['Free', 'Basic', 'Complete'];

export type GoogleReturn = {
  readonly intent: VisitorIntent | null;
  readonly route: Pick<InitialRoute, 'screen' | 'scanId' | 'profileId'>;
};

function readStored(key: string): unknown {
  try {
    const raw = sessionStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function validIntent(value: unknown): value is VisitorIntent {
  return (
    record(value) &&
    (value.site === null || (typeof value.site === 'string' && value.site.length <= 2048)) &&
    (value.plan === null || (typeof value.plan === 'string' && PLANS.includes(value.plan)))
  );
}

function fresh(value: unknown): value is Record<string, unknown> {
  return (
    record(value) &&
    typeof value.expiresAt === 'number' &&
    value.expiresAt > Date.now() &&
    value.expiresAt <= Date.now() + LIFETIME_MS
  );
}

export function rememberGoogleIntent(intent: VisitorIntent | null): void {
  try {
    if (intent === null) sessionStorage.removeItem(DRAFT_KEY);
    else
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ intent, expiresAt: Date.now() + LIFETIME_MS }),
      );
  } catch {
    /* A browser that blocks storage can still sign in. */
  }
}

export function googleRetryIntent(): VisitorIntent | null {
  if (typeof window === 'undefined') return null;
  if (!new URLSearchParams(window.location.search).has('google_auth_error')) return null;
  const saved = readStored(DRAFT_KEY);
  return fresh(saved) && validIntent(saved.intent) ? saved.intent : null;
}

export function prepareGoogleReturn(route: InitialRoute): void {
  const saved = readStored(DRAFT_KEY);
  const intent = fresh(saved) && validIntent(saved.intent) ? saved.intent : null;
  try {
    sessionStorage.setItem(
      RETURN_KEY,
      JSON.stringify({
        intent,
        route: { screen: route.screen, scanId: route.scanId, profileId: route.profileId },
        expiresAt: Date.now() + LIFETIME_MS,
      }),
    );
  } catch {
    /* Return to Profiles when storage is unavailable. */
  }
}

/** Only the successful, session-authenticated return consumes a short-lived navigation hint. */
export function consumeGoogleReturn(): GoogleReturn | null {
  if (new URLSearchParams(window.location.search).get('google_auth') !== 'success') return null;
  const saved = readStored(RETURN_KEY);
  try {
    sessionStorage.removeItem(RETURN_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* Storage is optional. */
  }
  if (
    !fresh(saved) ||
    !record(saved.route) ||
    (saved.intent !== null && !validIntent(saved.intent))
  )
    return null;
  const route = saved.route;
  if (
    typeof route.screen !== 'string' ||
    !(
      isWorkspaceScreen(route.screen as InitialRoute['screen']) ||
      ['home', 'auth'].includes(route.screen)
    ) ||
    !(route.scanId === null || (typeof route.scanId === 'string' && route.scanId.length <= 200)) ||
    !(
      route.profileId === null ||
      (typeof route.profileId === 'string' && route.profileId.length <= 200)
    )
  )
    return null;
  return {
    intent: saved.intent as VisitorIntent | null,
    route: {
      screen: route.screen as InitialRoute['screen'],
      scanId: route.scanId,
      profileId: route.profileId,
    },
  };
}
