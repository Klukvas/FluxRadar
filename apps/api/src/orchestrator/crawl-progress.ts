// The scan row's URL counters while a crawl is running.
//
// "Roughly current" is the design: the owner watching a progress bar needs to
// see it move, not to see every page the instant it is fetched, and a write per
// URL would make a 5000-page crawl 5000 extra transactions.

import type { PrismaClient } from '@prisma/client';

const PROGRESS_WRITE_INTERVAL_MS = 2_000;

export interface CrawlCounts {
  readonly scanned: number;
  readonly discovered: number;
}

/**
 * Writes `scannedUrlCount` / `discoveredUrlCount` throttled, and settles the
 * final value on `flush`. Writes are never awaited by the crawl itself.
 *
 * The counts the crawler reports are **absolute**: a resumed crawl carries its
 * restored pages in its own page list, so they are already inside `done` and
 * `total`. Adding the restored count on top of them counted every carried-over
 * page twice — which showed the owner more pages read than the scan's own page
 * limit allows, and seeded the next resume with the inflated number.
 */
export class CrawlProgressWriter {
  private readonly prisma: PrismaClient;
  private readonly scanId: string;
  private scanned: number;
  private discovered: number;
  private lastWriteAt = 0;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(prisma: PrismaClient, scanId: string, restoredPages: number, discovered: number) {
    this.prisma = prisma;
    this.scanId = scanId;
    // The starting values, shown until the crawl reports for the first time, so
    // the bar of a resumed scan does not drop back to zero before it moves.
    this.scanned = restoredPages;
    this.discovered = Math.max(discovered, restoredPages);
  }

  record(done: number, total: number): void {
    this.scanned = done;
    // Never backwards: the previous attempt may have discovered URLs whose
    // frontier entries did not survive the checkpoint's bounds.
    this.discovered = Math.max(this.discovered, total);
    const now = Date.now();
    if (now - this.lastWriteAt < PROGRESS_WRITE_INTERVAL_MS) return;
    this.lastWriteAt = now;
    this.pending = this.write();
  }

  counts(): CrawlCounts {
    return { scanned: this.scanned, discovered: this.discovered };
  }

  async flush(): Promise<void> {
    await this.pending.catch(() => undefined);
    await this.write();
  }

  private async write(): Promise<void> {
    await this.prisma.scan
      .updateMany({
        where: { id: this.scanId },
        data: { scannedUrlCount: this.scanned, discoveredUrlCount: this.discovered },
      })
      .catch(() => undefined);
  }
}
