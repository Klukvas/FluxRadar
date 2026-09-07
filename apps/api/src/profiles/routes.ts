// SiteProfile CRUD. Домен — строгий https-origin (D-111, схема contracts
// нормализует к new URL(v).origin); уникальность (account, domain) — на уровне
// БД. Все запросы скоупятся accountId сессии; чужой профиль — 404.

import { Router } from 'express';
import type { PrismaClient, SiteProfile } from '@prisma/client';
import { siteProfileInputSchema } from '@fluxradar/contracts';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import { openCheckoutSessionWhere } from '../billing/checkout-lifecycle.ts';
import { isUniqueViolation } from '../billing/prisma-errors.ts';
import { sendOk } from '../http/envelope.ts';
import { conflict, notFound } from '../http/errors.ts';
import {
  MAX_PAGE_SIZE,
  pageMetaFrom,
  pageQuerySchema,
  pageRequestFrom,
} from '../http/pagination.ts';
import { requiredParam } from '../http/params.ts';
import { parseInput } from '../http/validate.ts';

export interface ProfilesRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
}

const siteProfilePatchSchema = siteProfileInputSchema.partial();

function toProfileDto(profile: SiteProfile): Record<string, unknown> {
  return {
    id: profile.id,
    name: profile.name,
    domain: profile.domain,
    industry: profile.industry,
    region: profile.region,
    language: profile.language,
    createdAt: profile.createdAt.toISOString(),
  };
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

  router.post('/profiles', auth, async (req, res) => {
    const input = parseInput(siteProfileInputSchema, req.body);
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
    if (input.domain !== undefined && input.domain !== profile.domain) {
      await assertDomainChangeAllowed(prisma, profile.id, deps.now());
    }
    const data = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.domain !== undefined ? { domain: input.domain } : {}),
      ...(input.industry !== undefined ? { industry: input.industry } : {}),
      ...(input.region !== undefined ? { region: input.region } : {}),
      ...(input.language !== undefined ? { language: input.language } : {}),
    };
    try {
      const updated = await prisma.siteProfile.update({ where: { id: profile.id }, data });
      sendOk(res, toProfileDto(updated));
    } catch (error) {
      if (isUniqueViolation(error, 'domain')) {
        throw conflict('DOMAIN_EXISTS', 'a profile for this domain already exists');
      }
      throw error;
    }
  });

  router.delete('/profiles/:profileId', auth, async (req, res) => {
    const profile = await findOwnProfile(
      prisma,
      accountIdFrom(res),
      requiredParam(req.params.profileId, 'profileId'),
    );
    const [scanCount, purchaseCount, openCheckoutCount] = await Promise.all([
      prisma.scan.count({ where: { siteProfileId: profile.id } }),
      prisma.purchase.count({ where: { siteProfileId: profile.id } }),
      prisma.checkoutSession.count({
        where: { siteProfileId: profile.id, ...openCheckoutSessionWhere(deps.now()) },
      }),
    ]);
    if (scanCount > 0 || purchaseCount > 0) {
      // Сканы и покупки — финансовые/исторические записи (§18): профиль с ними
      // не удаляется, чтобы не рвать FK и retention-обязательства.
      throw conflict('PROFILE_HAS_HISTORY', 'profile has scans or purchases and cannot be deleted');
    }
    // CheckoutSession cascades from SiteProfile (the rollback-safe foreign key),
    // so deleting a profile mid-checkout would drop the binding the provider
    // webhook needs and turn a real charge into a rejected order. An open
    // checkout therefore blocks the deletion — but only while it can still be
    // paid: a session past its provider deadline binds nothing chargeable, and
    // an abandoned tab must never make a profile permanently undeletable.
    if (openCheckoutCount > 0) {
      throw conflict(
        'PROFILE_HAS_OPEN_CHECKOUT',
        'profile has a checkout in progress and cannot be deleted',
      );
    }
    await prisma.siteGoogleBinding.deleteMany({ where: { siteProfileId: profile.id } });
    await prisma.siteProfile.delete({ where: { id: profile.id } });
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
