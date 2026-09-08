// Find-or-create the profile behind a site address, for this account only.
//
// A scan used to be impossible without first saving a profile by hand, which
// made "check this site" a two-step form for someone who had only ever typed a
// URL. The scan can now start from the address itself — but everything the
// product hangs off a profile (billing, the Google binding, scan history, the
// per-domain Free-check claim) still hangs off one, so the address has to become
// a profile before anything else happens. That is what this does, and it is the
// only place that does it.
//
// Three properties this has to hold, none of them optional:
//
//   • Account-scoped. The lookup is keyed on (accountId, domain) — the same
//     unique constraint the database enforces — so two accounts checking the
//     same site get one profile each and neither can reach the other's.
//   • Race-safe. Two scans of the same address started at once both miss the
//     read and both try to create; the loser is a P2002 on that constraint, not
//     an error the owner should ever see, so it is resolved by re-reading the
//     row the winner wrote.
//   • Non-destructive. A profile that already exists is returned exactly as it
//     is. The derived name is written on creation and never again, so a name the
//     owner edited survives every later scan of the same address.

import type { PrismaClient, SiteProfile } from '@prisma/client';

import { isUniqueViolation } from '../billing/prisma-errors.ts';
import { siteProfileNameFor } from './site-profile-name.ts';

export interface ResolvedProfile {
  readonly profile: SiteProfile;
  /** True only when this call is the one that created the row. */
  readonly created: boolean;
}

/**
 * The account's profile for `domain`, creating it if there is none.
 *
 * `domain` must already be a normalized https origin (`httpsOriginSchema`):
 * matching is exact, so an unnormalized spelling would create a second profile
 * for a site that already has one.
 */
export async function resolveOwnProfile(
  prisma: PrismaClient,
  accountId: string,
  domain: string,
): Promise<ResolvedProfile> {
  const existing = await findByDomain(prisma, accountId, domain);
  if (existing !== null) {
    return { profile: existing, created: false };
  }
  try {
    const profile = await prisma.siteProfile.create({
      data: { accountId, name: siteProfileNameFor(domain), domain },
    });
    return { profile, created: true };
  } catch (error) {
    if (!isUniqueViolation(error, 'domain')) throw error;
    // Another request for the same address won the create. Its profile is the
    // one this scan belongs to; a 409 here would be a conflict with the owner's
    // own second click.
    const raced = await findByDomain(prisma, accountId, domain);
    if (raced === null) throw error;
    return { profile: raced, created: false };
  }
}

function findByDomain(
  prisma: PrismaClient,
  accountId: string,
  domain: string,
): Promise<SiteProfile | null> {
  return prisma.siteProfile.findUnique({ where: { accountId_domain: { accountId, domain } } });
}
