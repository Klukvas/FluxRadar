// Seeding shared by the db-backed tests of the owner-only routes
// (admin/routes.test.ts, admin/accounts-routes.test.ts): an app with an explicit admin list,
// accounts with a live session, and the scans, orders and checkouts they own.
//
// Every row is dated relative to ADMIN_TEST_NOW and every open checkout has a
// future deadline, so the retention sweep createApp starts in the background
// has nothing to remove or relabel while a test reads.

import { randomUUID } from 'node:crypto';

import { RULESET_VERSION } from '@fluxradar/contracts';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { SESSION_COOKIE_NAME, createSession } from '../auth/sessions.ts';
import { silentLogger } from '../http/logger.ts';
import { createApp } from '../index.ts';

export const ADMIN_TEST_NOW = new Date('2026-09-21T15:00:00.000Z');
export const ADMIN_EMAIL = 'Owner@Example.com';
export const ADMINS: ReadonlySet<string> = new Set(['owner@example.com']);

export const at = (iso: string): Date => new Date(iso);

/** The app with an explicit admin list, or the production env read when none is given. */
export function adminTestApp(prisma: PrismaClient, adminEmails?: ReadonlySet<string>) {
  return createApp({
    prisma,
    autoProcess: false,
    logger: silentLogger,
    now: () => ADMIN_TEST_NOW,
    supportChannel: null,
    ...(adminEmails === undefined ? {} : { adminEmails }),
  });
}

export type AdminTestApp = ReturnType<typeof adminTestApp>;

export interface SeededOwner {
  readonly accountId: string;
  readonly siteProfileId: string;
  readonly cookie: string;
}

export async function seedAccount(
  prisma: PrismaClient,
  options: { email: string; verified: boolean; createdAt: Date },
): Promise<SeededOwner> {
  const account = await prisma.account.create({
    data: {
      email: options.email,
      passwordHash: 'test-hash',
      emailVerifiedAt: options.verified ? options.createdAt : null,
      createdAt: options.createdAt,
    },
  });
  const profile = await prisma.siteProfile.create({
    data: { accountId: account.id, name: 'Site', domain: `https://${randomUUID()}.example` },
  });
  const session = await createSession(prisma, account.id, ADMIN_TEST_NOW);
  return {
    accountId: account.id,
    siteProfileId: profile.id,
    cookie: `${SESSION_COOKIE_NAME}=${session.token}`,
  };
}

/** What an unmounted path answers, to compare every refusal against. */
export async function unknownRouteAnswer(app: AdminTestApp, cookie?: string) {
  const unknown = request(app).get('/admin/unknown-route');
  const response = await (cookie === undefined ? unknown : unknown.set('Cookie', cookie));
  return { status: response.status, body: response.body as unknown };
}

export async function seedScan(
  prisma: PrismaClient,
  owner: SeededOwner,
  plan: 'Free' | 'Basic' | 'Complete',
  status: string,
  createdAt: string,
): Promise<void> {
  await prisma.scan.create({
    data: {
      accountId: owner.accountId,
      siteProfileId: owner.siteProfileId,
      plan,
      domain: 'https://example.com',
      status,
      scopeJson: '{}',
      rulesetVersion: RULESET_VERSION,
      createdAt: at(createdAt),
    },
  });
}

export async function seedPurchase(
  prisma: PrismaClient,
  owner: SeededOwner,
  options: {
    at: string;
    usd: number;
    settled?: { amount: number; currency: string };
    status?: string;
    provider?: string;
  },
): Promise<string> {
  const purchase = await prisma.purchase.create({
    data: {
      accountId: owner.accountId,
      siteProfileId: owner.siteProfileId,
      plan: options.usd === 55 ? 'Basic' : 'Complete',
      provider: options.provider ?? 'fastspring',
      providerTransactionId: `ord_${randomUUID()}`,
      amountUsd: options.usd,
      currency: 'USD',
      settledAmount: options.settled?.amount ?? null,
      settledCurrency: options.settled?.currency ?? null,
      status: options.status ?? 'paid',
      createdAt: at(options.at),
    },
  });
  return purchase.id;
}

export async function seedCheckout(
  prisma: PrismaClient,
  owner: SeededOwner,
  options: { at: string; status: string; purchaseId?: string; liveMode?: boolean },
): Promise<void> {
  await prisma.checkoutSession.create({
    data: {
      provider: 'fastspring',
      reference: randomUUID(),
      accountId: owner.accountId,
      siteProfileId: owner.siteProfileId,
      plan: 'Basic',
      productPath: 'fluxradar-basic',
      expectedAmountUsd: 55,
      liveMode: options.liveMode ?? true,
      status: options.status,
      scopeJson: '{}',
      purchaseId: options.purchaseId ?? null,
      // Far enough ahead that the retention sweep never calls it abandoned.
      expiresAt: new Date(ADMIN_TEST_NOW.getTime() + 24 * 60 * 60 * 1000),
      createdAt: at(options.at),
    },
  });
}
