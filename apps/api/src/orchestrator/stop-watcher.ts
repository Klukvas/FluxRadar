// "Should this run stop now?" — asked by the crawler before every request and
// by the attempt between stages.

import type { PrismaClient } from '@prisma/client';

/**
 * A cheap, synchronous answer to whether the owner cancelled this scan.
 *
 * The crawler asks it before every request and the attempt asks it between
 * stages, so it cannot be a database round trip. It polls instead. The
 * cancellation watcher (cancellation.ts) owns the AbortSignal that reaches the
 * transports; this one is what the stage boundaries consult, with a poll
 * interval tests can shorten.
 */
export class ScanStopWatcher {
  private readonly prisma: PrismaClient;
  private readonly scanId: string;
  private readonly timer: NodeJS.Timeout;
  private cancelled = false;

  constructor(prisma: PrismaClient, scanId: string, pollMs: number = 1_000) {
    this.prisma = prisma;
    this.scanId = scanId;
    this.timer = setInterval(() => void this.poll(), pollMs);
    this.timer.unref();
  }

  /** True once the owner cancelled the scan. */
  isStopRequested(): boolean {
    return this.cancelled;
  }

  /** One immediate read, for the boundaries where staleness would matter. */
  async refresh(): Promise<boolean> {
    await this.poll();
    return this.cancelled;
  }

  close(): void {
    clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    if (this.cancelled) return;
    try {
      const scan = await this.prisma.scan.findUnique({
        where: { id: this.scanId },
        select: { status: true },
      });
      if (scan?.status === 'Cancelled') this.cancelled = true;
    } catch {
      // A transient database error must not stop a running scan: the next poll
      // asks again, and a cancellation is not lost because the status persists.
    }
  }
}
