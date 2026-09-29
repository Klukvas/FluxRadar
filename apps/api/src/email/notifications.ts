import type { PrismaClient } from '@prisma/client';

import { emailText, type Mailer } from './mailer.ts';

export const EMAIL_NOTIFICATION_MAX_ATTEMPTS = 5;
export const EMAIL_NOTIFICATION_LEASE_MS = 10 * 60_000;
export const EMAIL_NOTIFICATION_SWEEP_LIMIT = 25;

const activeDeliveries = new WeakMap<PrismaClient, Set<Promise<unknown>>>();

/**
 * Money events only. A scan's own progress — started, completed, failed — is not
 * mailed: it runs in about two minutes with the workspace open in front of the
 * owner, so the mail would arrive after they have already seen the result.
 */
export type ScanNotificationKind = 'purchase_confirmed' | 'refund_created';

interface NotifiedPurchase {
  readonly checkout: { readonly liveMode: boolean } | null;
}

// The web app's address: the same variable, and the same local default, that
// the account emails build their links from (auth/routes.ts).
const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5174';

// Every email links to the scan's page, which shows its progress, its report,
// or why it stopped. A signed-out owner is sent there again after signing in.
const LINK_LABELS: Readonly<Record<ScanNotificationKind, string>> = {
  purchase_confirmed: 'Follow the scan',
  refund_created: 'See the scan',
};

function scanPageUrl(frontendOrigin: string, scanId: string): string {
  return `${frontendOrigin.replace(/\/+$/, '')}/scans/${encodeURIComponent(scanId)}`;
}

/**
 * A test-mode checkout is a test-mode checkout whoever ran it: today's Creem
 * E2E runs and historical FastSpring ones (production still holds Purchase
 * rows from that provider) are both production test traffic, not customers,
 * so mailing them would deliver a purchase or refund email for a payment
 * that never happened. Only an explicit test-mode checkout is silenced, so a
 * live, Free or legacy scan — or a purchase whose checkout row is gone — is
 * still mailed.
 */
function isProviderTestModePurchase(purchase: NotifiedPurchase | null): boolean {
  return purchase?.checkout?.liveMode === false;
}

/** Sends one idempotent scan notification on a best-effort basis. */
export async function notifyScanEvent(
  prisma: PrismaClient,
  mailer: Mailer | undefined,
  scanId: string,
  kind: ScanNotificationKind,
  detail: string,
  frontendOrigin: string = process.env.FRONTEND_ORIGIN ?? DEFAULT_FRONTEND_ORIGIN,
  now: Date = new Date(),
): Promise<void> {
  return trackDelivery(
    prisma,
    notifyScanEventNow(prisma, mailer, scanId, kind, detail, frontendOrigin, now),
  );
}

async function notifyScanEventNow(
  prisma: PrismaClient,
  mailer: Mailer | undefined,
  scanId: string,
  kind: ScanNotificationKind,
  detail: string,
  frontendOrigin: string = process.env.FRONTEND_ORIGIN ?? DEFAULT_FRONTEND_ORIGIN,
  now: Date = new Date(),
): Promise<void> {
  if (mailer === undefined) return;
  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    select: {
      accountId: true,
      domain: true,
      account: { select: { email: true } },
      purchase: { select: { checkout: { select: { liveMode: true } } } },
    },
  });
  if (scan === null || isProviderTestModePurchase(scan.purchase)) return;
  const eventKey = `${kind}:${scanId}`;
  try {
    await prisma.emailNotification.create({
      data: {
        accountId: scan.accountId,
        eventKey,
        kind,
        detail,
        status: 'queued',
        nextAttemptAt: now,
      },
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      // A unique event key means another worker owns the durable delivery.
      return;
    }
    throw error;
  }
  await deliverDueScanNotifications(prisma, mailer, now, 1, frontendOrigin);
}

/**
 * Delivers due queued events and reclaims work stranded by a stopped process.
 *
 * The row is the outbox: an accepted message becomes `sent`, while a failure
 * stays queued until its bounded backoff expires. No event is deleted merely
 * because Resend had a temporary outage.
 */
export async function deliverDueScanNotifications(
  prisma: PrismaClient,
  mailer: Mailer,
  now: Date | (() => Date) = () => new Date(),
  limit = EMAIL_NOTIFICATION_SWEEP_LIMIT,
  frontendOrigin: string = process.env.FRONTEND_ORIGIN ?? DEFAULT_FRONTEND_ORIGIN,
): Promise<number> {
  return trackDelivery(
    prisma,
    deliverDueScanNotificationsNow(prisma, mailer, now, limit, frontendOrigin),
  );
}

async function trackDelivery<T>(prisma: PrismaClient, delivery: Promise<T>): Promise<T> {
  const active = activeDeliveries.get(prisma) ?? new Set<Promise<unknown>>();
  activeDeliveries.set(prisma, active);
  active.add(delivery);
  try {
    return await delivery;
  } finally {
    active.delete(delivery);
  }
}

/** Lets server shutdown wait for direct lifecycle sends as well as scheduled sweeps. */
export async function waitForScanNotificationDeliveries(prisma: PrismaClient): Promise<void> {
  const active = activeDeliveries.get(prisma);
  if (active === undefined || active.size === 0) return;
  await Promise.allSettled([...active]);
}

async function deliverDueScanNotificationsNow(
  prisma: PrismaClient,
  mailer: Mailer,
  now: Date | (() => Date) = () => new Date(),
  limit = EMAIL_NOTIFICATION_SWEEP_LIMIT,
  frontendOrigin: string = process.env.FRONTEND_ORIGIN ?? DEFAULT_FRONTEND_ORIGIN,
): Promise<number> {
  const clock = typeof now === 'function' ? now : () => now;
  const dueAt = clock();
  await prisma.emailNotification.updateMany({
    where: {
      status: 'sending',
      attemptCount: { gte: EMAIL_NOTIFICATION_MAX_ATTEMPTS },
      leaseUntil: { lte: dueAt },
    },
    data: {
      status: 'failed',
      leaseUntil: null,
      lastError: 'delivery lease expired after final attempt',
    },
  });
  const candidates = await prisma.emailNotification.findMany({
    where: {
      AND: [
        { attemptCount: { lt: EMAIL_NOTIFICATION_MAX_ATTEMPTS } },
        {
          OR: [
            { status: 'queued', nextAttemptAt: { lte: dueAt } },
            { status: 'sending', leaseUntil: { lte: dueAt } },
          ],
        },
      ],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  });
  let delivered = 0;
  for (const candidate of candidates) {
    // A production sweep reads the clock again for every claim. A long provider
    // call therefore cannot make a later row's lease start in the past. Tests
    // can still pass a fixed Date to make their assertions deterministic.
    const claimAt = clock();
    const leaseUntil = new Date(claimAt.getTime() + EMAIL_NOTIFICATION_LEASE_MS);
    const attemptCount = candidate.attemptCount + 1;
    const claimed = await prisma.emailNotification.updateMany({
      where: {
        id: candidate.id,
        attemptCount: candidate.attemptCount,
        AND: [
          { attemptCount: { lt: EMAIL_NOTIFICATION_MAX_ATTEMPTS } },
          {
            OR: [
              { status: 'queued', nextAttemptAt: { lte: claimAt } },
              { status: 'sending', leaseUntil: { lte: claimAt } },
            ],
          },
        ],
      },
      data: {
        status: 'sending',
        attemptCount: { increment: 1 },
        leaseUntil,
      },
    });
    if (claimed.count === 0) continue;
    // Keep the claim token computed above. Re-reading the row here could pick
    // up a later worker's reclaimed lease and let this worker settle its send.
    const notification = { ...candidate, attemptCount, leaseUntil };
    const scanId = scanIdFromEventKey(notification.eventKey, notification.kind);
    if (scanId === null) {
      await markDeliveryFailed(prisma, notification, claimAt, 'scan missing');
      continue;
    }
    const scan = await prisma.scan.findUnique({
      where: { id: scanId },
      select: { domain: true, account: { select: { email: true } } },
    });
    if (scan === null) {
      await markDeliveryFailed(prisma, notification, claimAt, 'scan missing');
      continue;
    }
    const kind = notification.kind as ScanNotificationKind;
    const detail = notification.detail === '' ? defaultDetail(kind) : notification.detail;
    try {
      const delivery = await mailer.send(messageFor(scan, scanId, kind, detail, frontendOrigin));
      if (delivery.status === 'sent') {
        const settled = await prisma.emailNotification.updateMany({
          where: {
            id: notification.id,
            status: 'sending',
            attemptCount: notification.attemptCount,
            leaseUntil: notification.leaseUntil,
          },
          data: { status: 'sent', sentAt: claimAt, leaseUntil: null, lastError: null },
        });
        delivered += settled.count;
      } else {
        await markDeliveryFailed(
          prisma,
          notification,
          claimAt,
          delivery.status ?? 'mail provider rejected delivery',
        );
      }
    } catch {
      await markDeliveryFailed(prisma, notification, claimAt, 'mail provider failed');
    }
  }
  return delivered;
}

function scanIdFromEventKey(eventKey: string, kind: string): string | null {
  const prefix = `${kind}:`;
  const scanId = eventKey.startsWith(prefix) ? eventKey.slice(prefix.length) : '';
  return scanId === '' ? null : scanId;
}

function defaultDetail(kind: ScanNotificationKind): string {
  return kind === 'purchase_confirmed'
    ? 'Your audit payment was confirmed.'
    : 'A refund record was created for this audit.';
}

function messageFor(
  scan: { readonly domain: string; readonly account: { readonly email: string } },
  scanId: string,
  kind: ScanNotificationKind,
  detail: string,
  frontendOrigin: string,
) {
  const title = kind.replaceAll('_', ' ');
  const safeDomain = emailText(scan.domain);
  const safeDetail = emailText(detail);
  const link = scanPageUrl(frontendOrigin, scanId);
  const label = LINK_LABELS[kind];
  return {
    to: scan.account.email,
    subject: `FluxRadar: ${title}`,
    html: `<p><strong>FluxRadar</strong></p><p>${safeDomain}</p><p>${safeDetail}</p><p><a href="${emailText(link)}">${label}</a></p>`,
    text: `FluxRadar\n${scan.domain}\n${detail}\n\n${label}: ${link}`,
  };
}

async function markDeliveryFailed(
  prisma: PrismaClient,
  notification: {
    readonly id: string;
    readonly attemptCount: number;
    readonly leaseUntil: Date | null;
  },
  now: Date,
  error: string,
): Promise<void> {
  const exhausted = notification.attemptCount >= EMAIL_NOTIFICATION_MAX_ATTEMPTS;
  await prisma.emailNotification.updateMany({
    where: {
      id: notification.id,
      status: 'sending',
      attemptCount: notification.attemptCount,
      leaseUntil: notification.leaseUntil,
    },
    data: exhausted
      ? { status: 'failed', leaseUntil: null, lastError: error.slice(0, 500) }
      : {
          status: 'queued',
          leaseUntil: null,
          nextAttemptAt: new Date(now.getTime() + retryDelayMs(notification.attemptCount)),
          lastError: error.slice(0, 500),
        },
  });
}

export function retryDelayMs(attemptCount: number): number {
  return Math.min(60 * 60 * 1000, 60_000 * 2 ** Math.max(0, attemptCount - 1));
}
