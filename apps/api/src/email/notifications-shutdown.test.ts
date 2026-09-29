import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import type { Mailer } from './mailer.ts';
import { notifyScanEvent, waitForScanNotificationDeliveries } from './notifications.ts';

describe('notification shutdown tracking', () => {
  it('tracks notifyScanEvent before its first database read settles', async () => {
    let enteredScanRead = false;
    let releaseScan: ((value: null) => void) | undefined;
    const scanRead = new Promise<null>((resolve) => {
      releaseScan = resolve;
    });
    const prisma = {
      scan: {
        findUnique: () => {
          enteredScanRead = true;
          return scanRead;
        },
      },
    } as unknown as PrismaClient;
    const mailer: Mailer = {
      configured: true,
      async send() {
        throw new Error('a missing scan must not be mailed');
      },
    };
    const notification = notifyScanEvent(prisma, mailer, 'scan-1', 'purchase_confirmed', 'Paid.');
    let drained = false;
    const drain = waitForScanNotificationDeliveries(prisma).then(() => {
      drained = true;
    });

    try {
      await Promise.resolve();
      expect(enteredScanRead).toBe(true);
      expect(drained).toBe(false);
    } finally {
      releaseScan?.(null);
      await notification;
      await drain;
    }
    expect(drained).toBe(true);
  });
});
