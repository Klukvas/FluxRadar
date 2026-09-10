export const COOKIE_CONSENT_KEY = 'fluxradar.cookieConsent';
export const COOKIE_CONSENT_VERSION = 'v1';
export const COOKIE_CONSENT_CHANGE_EVENT = 'fluxradar:cookie-consent-change';
export const COOKIE_CONSENT_TTL_MS = 180 * 24 * 60 * 60 * 1000;
let saveFailed = false;

export type CookieConsentRecord = {
  readonly version: typeof COOKIE_CONSENT_VERSION;
  readonly preferences: boolean;
  readonly updatedAt: number;
  readonly expiresAt: number;
};

export function readCookieConsent(): CookieConsentRecord | null {
  // A failed withdrawal must override a previously saved allowance in this tab.
  if (saveFailed) return null;
  try {
    const stored = window.localStorage.getItem(COOKIE_CONSENT_KEY);
    if (stored === null) return null;
    const record: unknown = JSON.parse(stored);
    const now = Date.now();
    if (
      typeof record !== 'object' ||
      record === null ||
      !('version' in record) ||
      record.version !== COOKIE_CONSENT_VERSION ||
      !('preferences' in record) ||
      typeof record.preferences !== 'boolean' ||
      !('updatedAt' in record) ||
      typeof record.updatedAt !== 'number' ||
      !Number.isSafeInteger(record.updatedAt) ||
      record.updatedAt <= 0 ||
      record.updatedAt > now ||
      !('expiresAt' in record) ||
      typeof record.expiresAt !== 'number' ||
      !Number.isSafeInteger(record.expiresAt) ||
      record.expiresAt <= now ||
      record.expiresAt - record.updatedAt !== COOKIE_CONSENT_TTL_MS
    )
      return null;
    return {
      version: record.version,
      preferences: record.preferences,
      updatedAt: record.updatedAt,
      expiresAt: record.expiresAt,
    };
  } catch {
    return null;
  }
}

export function preferencesAllowed(): boolean {
  return readCookieConsent()?.preferences === true;
}

export function saveCookieConsent(preferences: boolean): boolean {
  const updatedAt = Date.now();
  const record: CookieConsentRecord = {
    version: COOKIE_CONSENT_VERSION,
    preferences,
    updatedAt,
    expiresAt: updatedAt + COOKIE_CONSENT_TTL_MS,
  };
  try {
    if (!preferences) {
      window.localStorage.removeItem('fluxradar.language');
      // Remove an earlier allowance before writing the refusal. If the new
      // write is blocked, a reload must not revive the stale opt-in.
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
