export const COOKIE_CONSENT_KEY = 'fluxradar.cookieConsent';
// Each version is one question. v2 added the analytics category; v3 widened it,
// because allowing analytics now also lets Google Analytics measure whether the
// visit came from a Google Ads click and report that back to Google Ads. An
// earlier record answered a narrower question — the v2 banner said "no
// advertising" — so it no longer counts as a choice and the banner asks again.
export const COOKIE_CONSENT_VERSION = 'v3';
const SUPERSEDED_CONSENT_VERSIONS: readonly string[] = ['v1', 'v2'];
export const COOKIE_CONSENT_CHANGE_EVENT = 'fluxradar:cookie-consent-change';
export const COOKIE_CONSENT_TTL_MS = 180 * 24 * 60 * 60 * 1000;
let saveFailed = false;

/** The optional categories. Necessary storage needs no choice, so it has no flag. */
export type CookieConsentChoice = {
  readonly preferences: boolean;
  readonly analytics: boolean;
};

export const NECESSARY_ONLY: CookieConsentChoice = { preferences: false, analytics: false };
export const EVERYTHING_ALLOWED: CookieConsentChoice = { preferences: true, analytics: true };

export type CookieConsentRecord = CookieConsentChoice & {
  readonly version: typeof COOKIE_CONSENT_VERSION;
  readonly updatedAt: number;
  readonly expiresAt: number;
};

type StoredRecord = { readonly [field: string]: unknown };

function readStoredRecord(): StoredRecord | null {
  const stored = window.localStorage.getItem(COOKIE_CONSENT_KEY);
  if (stored === null) return null;
  const record: unknown = JSON.parse(stored);
  return typeof record === 'object' && record !== null && !Array.isArray(record)
    ? (record as StoredRecord)
    : null;
}

/** Stamped by `saveCookieConsent`: a past save time and exactly 180 days still to run. */
function hasLiveWindow(
  record: StoredRecord,
  now: number,
): record is StoredRecord & { readonly updatedAt: number; readonly expiresAt: number } {
  const { updatedAt, expiresAt } = record;
  return (
    typeof updatedAt === 'number' &&
    Number.isSafeInteger(updatedAt) &&
    updatedAt > 0 &&
    updatedAt <= now &&
    typeof expiresAt === 'number' &&
    Number.isSafeInteger(expiresAt) &&
    expiresAt > now &&
    expiresAt - updatedAt === COOKIE_CONSENT_TTL_MS
  );
}

export function readCookieConsent(): CookieConsentRecord | null {
  // A failed withdrawal must override a previously saved allowance in this tab.
  if (saveFailed) return null;
  try {
    const record = readStoredRecord();
    if (
      record === null ||
      record.version !== COOKIE_CONSENT_VERSION ||
      typeof record.preferences !== 'boolean' ||
      typeof record.analytics !== 'boolean' ||
      !hasLiveWindow(record, Date.now())
    )
      return null;
    return {
      version: COOKIE_CONSENT_VERSION,
      preferences: record.preferences,
      analytics: record.analytics,
      updatedAt: record.updatedAt,
      expiresAt: record.expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * A visitor who allowed preferences under an earlier version answered a
 * narrower analytics question, but the language permission they did give still
 * stands for the rest of its 180 days, so it survives the banner coming back.
 */
function legacyPreferencesAllowed(): boolean {
  try {
    const record = readStoredRecord();
    return (
      record !== null &&
      typeof record.version === 'string' &&
      SUPERSEDED_CONSENT_VERSIONS.includes(record.version) &&
      record.preferences === true &&
      hasLiveWindow(record, Date.now())
    );
  } catch {
    return false;
  }
}

export function preferencesAllowed(): boolean {
  if (saveFailed) return false;
  const consent = readCookieConsent();
  return consent === null ? legacyPreferencesAllowed() : consent.preferences;
}

export function analyticsAllowed(): boolean {
  return readCookieConsent()?.analytics === true;
}

export function saveCookieConsent(choice: CookieConsentChoice): boolean {
  const updatedAt = Date.now();
  const record: CookieConsentRecord = {
    version: COOKIE_CONSENT_VERSION,
    preferences: choice.preferences,
    analytics: choice.analytics,
    updatedAt,
    expiresAt: updatedAt + COOKIE_CONSENT_TTL_MS,
  };
  try {
    if (!choice.preferences) window.localStorage.removeItem('fluxradar.language');
    if (!choice.preferences || !choice.analytics) {
      // Remove an earlier allowance before writing a refusal. If the new write
      // is blocked, a reload must not revive the stale opt-in.
      window.localStorage.removeItem(COOKIE_CONSENT_KEY);
    }
    const serialized = JSON.stringify(record);
    window.localStorage.setItem(COOKIE_CONSENT_KEY, serialized);
    if (window.localStorage.getItem(COOKIE_CONSENT_KEY) !== serialized) {
      throw new Error('Consent was not stored');
    }
    saveFailed = false;
    window.dispatchEvent(new Event(COOKIE_CONSENT_CHANGE_EVENT));
    return true;
  } catch {
    saveFailed = true;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(COOKIE_CONSENT_CHANGE_EVENT));
    }
    return false;
  }
}
