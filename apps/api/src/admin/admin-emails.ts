// Who may read the owner dashboard (GET /admin/stats).
//
// The same exact-email list shape as FLUXRADAR_INTERNAL_FREE_EMAILS, and the
// same failure direction: an unset or empty variable is an empty list, and an
// empty list switches the dashboard off for everyone rather than on for anyone.

import { normalizeEmail } from '../billing/internal-access.ts';

export const ADMIN_EMAILS_ENV = 'FLUXRADAR_ADMIN_EMAILS';

/** The normalized admin addresses; empty entries are dropped so "," means nobody. */
export function readAdminEmails(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  return new Set(
    (env[ADMIN_EMAILS_ENV] ?? '')
      .split(',')
      .map(normalizeEmail)
      .filter((email) => email !== ''),
  );
}

export function isAdminEmail(email: string, admins: ReadonlySet<string>): boolean {
  return admins.has(normalizeEmail(email));
}
