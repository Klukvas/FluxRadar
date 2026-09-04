const INTERNAL_FREE_EMAILS_ENV = 'FLUXRADAR_INTERNAL_FREE_EMAILS';

/** Normalizes an email before comparing it with the server-side allowlist. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Reads the exact-email allowlist from the environment. Empty list entries are
 * ignored so an unset variable fails closed.
 */
export function getInternalFreeEmails(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  return new Set(
    (env[INTERNAL_FREE_EMAILS_ENV] ?? '')
      .split(',')
      .map(normalizeEmail)
      .filter((email) => email !== ''),
  );
}

export function isInternalFreeEmail(email: string, allowlist: ReadonlySet<string>): boolean {
  return allowlist.has(normalizeEmail(email));
}
