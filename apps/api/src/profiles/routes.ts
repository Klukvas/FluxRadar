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

  router.get('/profiles', auth, async (_req, res) => {
    const accountId = accountIdFrom(res);
    const profiles = await prisma.siteProfile.findMany({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
    });
    sendOk(res, profiles.map(toProfileDto), {
      meta: { total: profiles.length, page: 1, limit: profiles.length },
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
