// One autofill read per account and address at a time.
//
// The rate limiter bounds how many reads an account may start in ten minutes;
// it says nothing about how many may be running at once. That gap matters now
// that the form reads a site by itself: two tabs on the same address, a retried
// request, or a client that sends the same body twice would each point two or
// three outbound fetches at one stranger's server for a single answer.
//
// A duplicate is refused rather than joined to the running read. Sharing one
// promise would be cheaper, but it couples the two requests' lifetimes: the
// first client disconnecting would abort the read the second one is still
// waiting for, and a 429 with a Retry-After is both honest and something a
// caller already knows how to handle.

/** Long enough for a homepage read to finish, short enough to feel like a retry. */
export const SUGGESTION_RETRY_AFTER_SECONDS = 15;

export const SUGGESTION_ALREADY_RUNNING_MESSAGE =
  'a read of this site is already running, wait for it to finish';

/**
 * The set of reads running right now, by whatever key the caller chooses.
 *
 * Bounded by the rate limits in front of it: a key is removed as soon as its
 * read settles, and only a limited number of reads may be started at all.
 */
export class InFlightReads {
  private readonly running = new Set<string>();

  /** True when this caller took the slot; false when an identical read holds it. */
  tryAcquire(key: string): boolean {
    if (this.running.has(key)) return false;
    this.running.add(key);
    return true;
  }

  release(key: string): void {
    this.running.delete(key);
  }

  get size(): number {
    return this.running.size;
  }
}
