import type { PrismaClient } from '@prisma/client';

import { FASTSPRING_PROVIDER } from '../billing/fastspring/config.ts';
import { emailText, type Mailer } from './mailer.ts';

export type ScanNotificationKind =
  'purchase_confirmed' | 'scan_started' | 'scan_completed' | 'scan_failed' | 'refund_created';

interface NotifiedPurchase {
  readonly provider: string;
  readonly checkout: { readonly liveMode: boolean } | null;
}

// The web app's address: the same variable, and the same local default, that
// the account emails build their links from (auth/routes.ts).
const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5174';

// Every email links to the scan's page, which shows its progress, its report,
// or why it stopped. A signed-out owner is sent there again after signing in.
const LINK_LABELS: Readonly<Record<ScanNotificationKind, string>> = {
  purchase_confirmed: 'Follow the scan',
  scan_started: 'Follow the scan',
  scan_completed: 'Open the report',
  scan_failed: 'See what happened',
  refund_created: 'See the scan',
};

function scanPageUrl(frontendOrigin: string, scanId: string): string {
  return `${frontendOrigin.replace(/\/+$/, '')}/scans/${encodeURIComponent(scanId)}`;
}

/**
 * FastSpring test-mode orders are production E2E runs, not customers: mailing
 * them would deliver real purchase/scan emails for a payment that never
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
  frontendOrigin: string = process.env.FRONTEND_ORIGIN ?? DEFAULT_FRONTEND_ORIGIN,
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
  const link = scanPageUrl(frontendOrigin, scanId);
  const label = LINK_LABELS[kind];
  try {
    const delivery = await mailer.send({
      to: scan.account.email,
      subject: `FluxRadar: ${title}`,
      html: `<p><strong>FluxRadar</strong></p><p>${safeDomain}</p><p>${safeDetail}</p><p><a href="${emailText(link)}">${label}</a></p>`,
      text: `FluxRadar\n${scan.domain}\n${detail}\n\n${label}: ${link}`,
    });
    if (delivery.status === 'provider-error' || delivery.status === 'not-configured') {
      await prisma.emailNotification.deleteMany({ where: { eventKey } });
    }
  } catch {
    await prisma.emailNotification.deleteMany({ where: { eventKey } });
  }
}
