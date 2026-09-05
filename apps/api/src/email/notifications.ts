import type { PrismaClient } from '@prisma/client';

import { emailText, type Mailer } from './mailer.ts';

export type ScanNotificationKind =
  'purchase_confirmed' | 'scan_started' | 'scan_completed' | 'scan_failed' | 'refund_created';

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
    select: { accountId: true, domain: true, account: { select: { email: true } } },
  });
  if (scan === null) return;
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
