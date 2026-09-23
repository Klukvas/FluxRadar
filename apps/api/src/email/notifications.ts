import type { PrismaClient } from '@prisma/client';

import { FASTSPRING_PROVIDER } from '../billing/fastspring/config.ts';
import { emailText, type Mailer } from './mailer.ts';

/**
 * Money events only. A scan's own progress — started, completed, failed — is not
 * mailed: it runs in about two minutes with the workspace open in front of the
 * owner, so the mail would arrive after they have already seen the result.
 */
export type ScanNotificationKind = 'purchase_confirmed' | 'refund_created';

interface NotifiedPurchase {
  readonly provider: string;
  readonly checkout: { readonly liveMode: boolean } | null;
}

/**
 * FastSpring test-mode orders are production E2E runs, not customers: mailing
 * them would deliver a real purchase or refund email for a payment that never
 * happened. Only an explicit test-mode checkout is silenced, so a live, Free or
 * legacy scan — or a purchase whose checkout row is gone — is still mailed.
 */
function isFastSpringTestModePurchase(purchase: NotifiedPurchase | null): boolean {
  return purchase?.provider === FASTSPRING_PROVIDER && purchase.checkout?.liveMode === false;
}

/** Sends one idempotent scan notification on a best-effort basis. */
export async function notifyScanEvent(
  prisma: PrismaClient,
  mailer: Mailer | undefined,
  scanId: string,
  kind: ScanNotificationKind,
  detail: string,
): Promise<void> {
  if (mailer === undefined) return;
  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    select: {
      accountId: true,
      domain: true,
      account: { select: { email: true } },
      purchase: { select: { provider: true, checkout: { select: { liveMode: true } } } },
    },
  });
  if (scan === null || isFastSpringTestModePurchase(scan.purchase)) return;
  const eventKey = `${kind}:${scanId}`;
  try {
    await prisma.emailNotification.create({ data: { accountId: scan.accountId, eventKey, kind } });
  } catch {
    // A unique event key means another worker already claimed this event.
    return;
  }
  const title = kind.replaceAll('_', ' ');
  const safeDomain = emailText(scan.domain);
  const safeDetail = emailText(detail);
  try {
    const delivery = await mailer.send({
      to: scan.account.email,
      subject: `FluxRadar: ${title}`,
      html: `<p><strong>FluxRadar</strong></p><p>${safeDomain}</p><p>${safeDetail}</p>`,
      text: `FluxRadar\n${scan.domain}\n${detail}`,
    });
    if (delivery.status === 'provider-error' || delivery.status === 'not-configured') {
      await prisma.emailNotification.deleteMany({ where: { eventKey } });
    }
  } catch {
    await prisma.emailNotification.deleteMany({ where: { eventKey } });
  }
}
