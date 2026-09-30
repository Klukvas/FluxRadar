// SiteProfile CRUD. Домен — строгий https-origin (D-111, схема contracts
// нормализует к new URL(v).origin); уникальность (account, domain) — на уровне
// БД. Все запросы скоупятся accountId сессии; чужой профиль — 404.

import { Router } from 'express';
import type { PrismaClient, SiteProfile } from '@prisma/client';
import {
  competitorsListProblem,
  defaultProfileScanConfig,
  httpsOriginSchema,
  profileScanConfigSchema,
  siteProfileInputSchema,
  siteProfilePatchInputSchema,
} from '@fluxradar/contracts';
import { z } from 'zod';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import { RequestRateLimiter, scanActionRules } from '../auth/rate-limit.ts';
import { openCheckoutSessionWhere } from '../billing/checkout-lifecycle.ts';
import { isUniqueViolation } from '../billing/prisma-errors.ts';
import { sendOk } from '../http/envelope.ts';
import { conflict, notFound, validationError } from '../http/errors.ts';
import type { ApiLogger } from '../http/logger.ts';
import {
  MAX_PAGE_SIZE,
  pageMetaFrom,
  pageQuerySchema,
  pageRequestFrom,
} from '../http/pagination.ts';
import { requiredParam } from '../http/params.ts';
import { parseInput } from '../http/validate.ts';
import type { PrivateObjectStore } from '../integrations/s3.ts';
import { scopeTargetMessage, scopeTargetProblems } from '../scans/scope-targets.ts';
import { competitorsFromJson } from './competitors.ts';
import { deleteSiteProfileData, type ProfileDeletionBlocker } from './profile-deletion.ts';
import { resolveOwnProfile } from './resolve.ts';
import { suggestProfileFromSite, type ProfileSuggestions } from './profile-suggestions.ts';

export interface ProfilesRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly requestRateLimiter?: RequestRateLimiter;
  /** Where exported reports live; a deleted profile's reports are removed from it. */
  readonly objectStore?: PrivateObjectStore | null;
  readonly logger?: ApiLogger;
  /** Test seam for the one bounded public homepage read used by profile autofill. */
  readonly suggestProfile?: (
    domain: string,
    targetLanguage: 'en' | 'uk',
    signal?: AbortSignal,
  ) => Promise<ProfileSuggestions>;
}

const PROFILE_DELETION_BLOCKED_MESSAGES: Readonly<Record<ProfileDeletionBlocker, string>> = {
  PROFILE_HAS_ACTIVE_SCAN: 'profile has a scan in progress and cannot be deleted',
  PROFILE_HAS_OPEN_CHECKOUT: 'profile has a checkout in progress and cannot be deleted',
  PROFILE_HAS_OPEN_REFUND: 'profile has a refund in progress and cannot be deleted',
};

const siteProfilePatchSchema = siteProfilePatchInputSchema;

// Only the address. A name is never accepted here: this endpoint exists for a
// scan started from a raw URL, where nobody typed one, and accepting one would
// be a second way to overwrite the name on a profile that already exists.
const profileResolveInputSchema = z.object({ domain: httpsOriginSchema });
const profileSuggestionsInputSchema = profileResolveInputSchema.extend({
  targetLanguage: z.enum(['en', 'uk']).default('en'),
});

function toProfileDto(profile: SiteProfile): Record<string, unknown> {
  return {
    id: profile.id,
    name: profile.name,
    domain: profile.domain,
    industry: profile.industry,
    region: profile.region,
    language: profile.language,
    businessDescription: profile.businessDescription,
    offerings: profile.offerings,
    targetLanguages: profile.targetLanguages,
    targetAudience: profile.targetAudience,
    competitors: competitorsFromJson(profile.competitorsJson),
    scanConfig: profileScanConfigFromJson(profile.scanConfigJson),
    scanConfigVersion: profile.scanConfigVersion,
    createdAt: profile.createdAt.toISOString(),
  };
}

function profileScanConfigFromJson(value: string): unknown {
  try {
    const parsed = profileScanConfigSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : defaultProfileScanConfig;
  } catch {
    return defaultProfileScanConfig;
  }
}

/**
 * Rejects a competitors list that repeats the profile's own name/domain or
 * itself (T7). `brand`/`domain` are the values the row will actually have
 * once this request is applied — the patched value when the request touches
 * it, the stored one otherwise — never a guess at a merge.
 */
function assertCompetitorsAllowed(
  competitors: readonly string[] | null | undefined,
  brand: string,
  domain: string,
): void {
  const problem = competitorsListProblem(competitors, brand, domain);
  if (problem !== null) throw validationError(problem);
}

export async function findOwnProfile(
  prisma: PrismaClient,
  accountId: string,
  profileId: string,
): Promise<SiteProfile> {
  const profile = await prisma.siteProfile.findUnique({ where: { id: profileId } });
  if (profile === null || profile.accountId !== accountId) {
    // Чужой профиль неотличим от несуществующего — не раскрываем существование.
    throw notFound('site profile not found');
  }
  return profile;
}

export function profilesRouter(deps: ProfilesRouterDeps): Router {
  const router = Router();
  const { prisma } = deps;
  const auth = requireAuth(prisma, deps.now);
  const requestRateLimiter = deps.requestRateLimiter ?? new RequestRateLimiter();

  /**
   * The profile for a site address, created only if this account has none.
   *
   * This is the first step of a scan started from a raw URL, so it is limited
   * under the same ceiling as scan creation: it is a write, and it is the one
   * request between "someone typed an address" and "a scan exists". 200 for a
   * profile that was already there, 201 for one this call created — the caller
   * uses the difference only to tell the owner what happened.
   */
  router.post('/profiles/resolve', auth, async (req, res) => {
    const input = parseInput(profileResolveInputSchema, req.body);
    const accountId = accountIdFrom(res);
    requestRateLimiter.assertAllowedAll(
      scanActionRules('profile-resolve', accountId, req.ip ?? 'unknown'),
    );
    const resolved = await resolveOwnProfile(prisma, accountId, input.domain);
    sendOk(
      res,
      { profile: toProfileDto(resolved.profile), created: resolved.created },
      { status: resolved.created ? 201 : 200 },
    );
  });

  router.post('/profiles/suggestions', auth, async (req, res) => {
    const input = parseInput(profileSuggestionsInputSchema, req.body);
    const accountId = accountIdFrom(res);
    requestRateLimiter.assertAllowedAll(
      scanActionRules('profile-suggestions', accountId, req.ip ?? 'unknown'),
    );
    const aborted = new AbortController();
    const cancelIfDisconnected = () => {
      if (req.aborted || res.destroyed) aborted.abort();
    };
    req.once('aborted', cancelIfDisconnected);
    res.once('close', cancelIfDisconnected);
    try {
      sendOk(
        res,
        deps.suggestProfile === undefined
          ? await suggestProfileFromSite(
              input.domain,
              input.targetLanguage,
              undefined,
              aborted.signal,
            )
          : await deps.suggestProfile(input.domain, input.targetLanguage, aborted.signal),
      );
    } catch {
      if (aborted.signal.aborted) return;
      // Network/SSRF/parser details are not useful to the owner and must not
      // become an oracle. Saving their URL manually stays available.
      throw validationError(
        'Could not read public details from this site. You can still save it manually.',
      );
    }
  });

  router.post('/profiles', auth, async (req, res) => {
    const input = parseInput(siteProfileInputSchema, req.body);
    assertCompetitorsAllowed(input.competitors, input.name, input.domain);
    const accountId = accountIdFrom(res);
    try {
      const profile = await prisma.siteProfile.create({
        data: {
          accountId,
          name: input.name,
          domain: input.domain,
          industry: input.industry ?? null,
          region: input.region ?? null,
          language: input.language ?? null,
          businessDescription: input.businessDescription ?? null,
          offerings: input.offerings ?? null,
          targetLanguages: input.targetLanguages ?? null,
          targetAudience: input.targetAudience ?? null,
          competitorsJson:
            input.competitors === undefined || input.competitors.length === 0
              ? null
              : JSON.stringify(input.competitors),
          scanConfigJson: JSON.stringify(input.scanConfig ?? defaultProfileScanConfig),
          scanConfigVersion: 1,
        },
      });
      sendOk(res, toProfileDto(profile), { status: 201 });
    } catch (error) {
      if (isUniqueViolation(error, 'domain')) {
        throw conflict('DOMAIN_EXISTS', 'a profile for this domain already exists');
      }
      throw error;
    }
  });

  router.get('/profiles', auth, async (req, res) => {
    // A workspace holds one profile per domain, so this list is small and
    // bounded by the tenant. It is paged like every other list — the cap and the
    // deep-offset bound both apply — but a caller that asks for no page gets the
    // largest one, because the profile picker predates paging and shows them all.
    const page = pageRequestFrom(parseInput(pageQuerySchema, req.query), {
      limit: MAX_PAGE_SIZE,
    });
    const accountId = accountIdFrom(res);
    const where = { accountId };
    // The id tie-breaker keeps two profiles created in the same millisecond in a
    // stable order across pages; createdAt alone would let one hide the other.
    const [profiles, total] = await Promise.all([
      prisma.siteProfile.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: page.offset,
        take: page.limit,
      }),
      prisma.siteProfile.count({ where }),
    ]);
    sendOk(res, profiles.map(toProfileDto), {
      meta: pageMetaFrom(page, profiles.length, total),
    });
  });

  router.get('/profiles/:profileId', auth, async (req, res) => {
    const profile = await findOwnProfile(
      prisma,
      accountIdFrom(res),
      requiredParam(req.params.profileId, 'profileId'),
    );
    sendOk(res, toProfileDto(profile));
  });

  router.patch('/profiles/:profileId', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const profile = await findOwnProfile(
      prisma,
      accountId,
      requiredParam(req.params.profileId, 'profileId'),
    );
    const input = parseInput(siteProfilePatchSchema, req.body);
    if (
      input.expectedProfileConfigVersion !== undefined &&
      input.expectedProfileConfigVersion !== profile.scanConfigVersion
    ) {
      throw conflict(
        'PROFILE_CONFIG_CHANGED',
        'The profile changed. Reload it and review the configuration before trying again.',
      );
    }
    if (input.domain !== undefined && input.domain !== profile.domain) {
      await assertDomainChangeAllowed(prisma, profile.id, deps.now());
    }
    // Re-checked whenever the name, domain, or competitors themselves are part
    // of this request (T7-fix F3, narrowed by T7-fix2 N7): a PATCH that only
    // renames the profile or changes its domain can otherwise leave a stored
    // competitor equal to the row's own new name or domain, since the
    // invariant this call protects was never re-verified against the value
    // being renamed to. A PATCH that touches none of the three (a
    // `scanConfig`-only edit, say) has nothing new to re-check, so it must not
    // become blocked by a stored list a later rule tightening would now
    // reject — that list was valid when it was saved, and this request isn't
    // the one changing it.
    if (input.name !== undefined || input.domain !== undefined || input.competitors !== undefined) {
      assertCompetitorsAllowed(
        input.competitors === undefined
          ? competitorsFromJson(profile.competitorsJson)
          : input.competitors,
        input.name ?? profile.name,
        input.domain ?? profile.domain,
      );
    }
    const nextScanConfig =
      input.scanConfig === undefined ? undefined : profileScanConfigSchema.parse(input.scanConfig);
    if (nextScanConfig !== undefined) {
      // The saved configuration is what a later scan runs with, so its seed
      // URLs and API checks are checked against the site now rather than at
      // checkout, where the owner has already committed to paying.
      const problems = scopeTargetProblems(nextScanConfig.scope, input.domain ?? profile.domain);
      if (problems.length > 0) {
        throw validationError(scopeTargetMessage(problems));
      }
    }
    const scanConfigChanged =
      nextScanConfig !== undefined &&
      JSON.stringify(nextScanConfig) !==
        JSON.stringify(profileScanConfigFromJson(profile.scanConfigJson));
    const nextCompetitorsJson =
      input.competitors === undefined
        ? undefined
        : input.competitors === null || input.competitors.length === 0
          ? null
          : JSON.stringify(input.competitors);
    const identityChanged =
      (
        [
          'name',
          'domain',
          'industry',
          'region',
          'language',
          'businessDescription',
          'offerings',
          'targetLanguages',
          'targetAudience',
        ] as const
      ).some((key) => input[key] !== undefined && input[key] !== profile[key]) ||
      (nextCompetitorsJson !== undefined && nextCompetitorsJson !== profile.competitorsJson);
    const data = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.domain !== undefined ? { domain: input.domain } : {}),
      ...(input.industry !== undefined ? { industry: input.industry } : {}),
      ...(input.region !== undefined ? { region: input.region } : {}),
      ...(input.language !== undefined ? { language: input.language } : {}),
      ...(input.businessDescription !== undefined
        ? { businessDescription: input.businessDescription }
        : {}),
      ...(input.offerings !== undefined ? { offerings: input.offerings } : {}),
      ...(input.targetLanguages !== undefined ? { targetLanguages: input.targetLanguages } : {}),
      ...(input.targetAudience !== undefined ? { targetAudience: input.targetAudience } : {}),
      ...(nextCompetitorsJson !== undefined ? { competitorsJson: nextCompetitorsJson } : {}),
      ...(scanConfigChanged
        ? {
            scanConfigJson: JSON.stringify(nextScanConfig),
          }
        : {}),
      ...(scanConfigChanged || identityChanged ? { scanConfigVersion: { increment: 1 } } : {}),
    };
    try {
      const updated = await prisma.siteProfile.update({
        where: { id: profile.id, accountId, scanConfigVersion: profile.scanConfigVersion },
        data,
      });
      sendOk(res, toProfileDto(updated));
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2025'
      ) {
        throw conflict(
          'PROFILE_CONFIG_CHANGED',
          'The profile changed. Reload it and review the configuration before trying again.',
        );
      }
      if (isUniqueViolation(error, 'domain')) {
        throw conflict('DOMAIN_EXISTS', 'a profile for this domain already exists');
      }
      throw error;
    }
  });

  /**
   * Deletes the profile together with the audit and billing history of its site.
   *
   * Refused with a closed 409 code while a scan, a payable checkout or a refund
   * still being processed depends on it. An open checkout blocks only
   * while it can still be paid: a session past its provider deadline binds
   * nothing chargeable, and an abandoned tab must never make a profile
   * permanently undeletable. See profile-deletion.ts for what is removed.
   */
  router.delete('/profiles/:profileId', auth, async (req, res) => {
    const result = await deleteSiteProfileData(
      prisma,
      {
        accountId: accountIdFrom(res),
        profileId: requiredParam(req.params.profileId, 'profileId'),
        now: deps.now(),
      },
      deps.objectStore,
    );
    if (result.kind === 'not-found') {
      // Someone else's profile is indistinguishable from a missing one.
      throw notFound('site profile not found');
    }
    if (result.kind === 'blocked') {
      throw conflict(result.blocker, PROFILE_DELETION_BLOCKED_MESSAGES[result.blocker]);
    }
    if (result.orphanedArtifactCount > 0) {
      deps.logger?.warn('profile artifact cleanup incomplete', {
        deletedScanCount: result.deletedScanCount,
        orphanedArtifactCount: result.orphanedArtifactCount,
      });
    }
    sendOk(res, null);
  });

  return router;
}

/**
 * Refuses to move a profile to another domain while a payment for it can still
 * land.
 *
 * A checkout binds a plan and a scope to a *profile id*, and the scan is created
 * from that profile when the signed provider webhook arrives — which is minutes
 * later, and out of the buyer's control. Nothing else stops the buyer from
 * pointing the profile at a different site in that window, so the audit the
 * money bought and the audit that runs would be of two different domains, with
 * only the second one recorded anywhere. That is the one place where the subject
 * of a paid scan is mutable after the purchase was authorised, so it is closed
 * here rather than by rejecting the payment afterwards: refunding a buyer who
 * renamed a profile is a far worse outcome than asking them to wait.
 *
 * It is deliberately the same rule, the same window and the same conflict code
 * as the deletion guard above — an open checkout freezes the binding it depends
 * on, and an expired one freezes nothing.
 */
async function assertDomainChangeAllowed(
  prisma: PrismaClient,
  siteProfileId: string,
  now: Date,
): Promise<void> {
  const openCheckoutCount = await prisma.checkoutSession.count({
    where: { siteProfileId, ...openCheckoutSessionWhere(now) },
  });
  if (openCheckoutCount > 0) {
    throw conflict(
      'PROFILE_HAS_OPEN_CHECKOUT',
      'profile has a checkout in progress; its domain cannot be changed until the checkout completes or expires',
    );
  }
}
