// The origins a deployment lets run the Free check as often as it likes.
//
// The Free check is limited twice over (§18): once per account, by the account's
// freeCheckUsedAt flag, and once per domain for everyone, by the global
// FreeCheckClaim row. Both are anti-abuse limits aimed at strangers, and both
// stand in the way of the sites this deployment runs itself — the demo site, the
// marketing site, a customer's site being reproduced during support. Those get
// re-checked constantly, and today the only way to do it is to edit the database.
//
// So this allowlist is the one exception, and it is deliberately narrow:
//   - exact, normalized https origins, comma-separated;
//   - no wildcards, and a subdomain is a different site (a wildcard over
//     "*.example.com" is an unlimited free scan on hosts nobody meant to give
//     away);
//   - it fails closed — unset, empty or unparsable means every account keeps the
//     one-time limit it has today.
//
// The origins are normalized with the same schema a profile domain goes through
// on its way into the database, so "EXAMPLE.com/", "https://example.com:443" and
// "https://example.com" are one entry rather than three near-misses.

import { httpsOriginSchema } from '@fluxradar/contracts';

export const FREE_CHECK_ALLOWED_ORIGINS_ENV = 'FLUXRADAR_FREE_CHECK_ALLOWED_ORIGINS';

/**
 * The canonical form of one origin, or null when it is not an https origin at
 * all. A bare host ("example.com") is deliberately not accepted: the value this
 * is compared against is a stored profile domain, which is always a full origin,
 * and guessing a scheme for the operator would make the allowlist read as if it
 * covered http:// sites too.
 */
export function normalizeFreeCheckOrigin(value: string): string | null {
  const parsed = httpsOriginSchema.safeParse(value.trim());
  return parsed.success ? parsed.data : null;
}

export interface FreeCheckAllowlist {
  /** Normalized origins that skip both Free-check limits. */
  readonly origins: ReadonlySet<string>;
  /**
   * Entries that are not an https origin, kept verbatim so a typo is reported
   * at startup by value. Silently dropping one would leave an operator certain a
   * domain is exempt while every check still refuses it.
   */
  readonly rejected: readonly string[];
}

export function readFreeCheckAllowlist(env: NodeJS.ProcessEnv = process.env): FreeCheckAllowlist {
  const entries = (env[FREE_CHECK_ALLOWED_ORIGINS_ENV] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    // Trailing commas and a blank variable are not mistakes worth reporting.
    .filter((entry) => entry !== '');
  const origins = new Set<string>();
  const rejected: string[] = [];
  for (const entry of entries) {
    const origin = normalizeFreeCheckOrigin(entry);
    if (origin === null) {
      rejected.push(entry);
      continue;
    }
    origins.add(origin);
  }
  return { origins, rejected };
}

/** Whether a profile domain is exempt from both Free-check limits. */
export function isFreeCheckAllowedOrigin(domain: string, allowlist: ReadonlySet<string>): boolean {
  if (allowlist.size === 0) {
    return false;
  }
  const origin = normalizeFreeCheckOrigin(domain);
  return origin !== null && allowlist.has(origin);
}
