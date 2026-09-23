// Work that outlives the request that started it.
//
// An Action Plan takes a provider turn of a minute or two, so the POST answers
// 202 and the generation continues on its own. A bare `void promise` would do
// that, but it leaves two things unanswered: nothing can cancel the provider
// call when the process is shutting down — the request keeps being billed while
// the answer has nowhere to go — and nothing can wait for it, which is what a
// test needs to assert on the result rather than on a sleep.
//
// This holds both: one signal every run is started with, and the set of runs
// still in flight.

/** A unit of detached work; it must stop when the signal aborts. */
export type BackgroundRun = (signal: AbortSignal) => Promise<void>;

export class BackgroundRuns {
  private readonly controller = new AbortController();
  private readonly inFlight = new Set<Promise<void>>();

  /** Aborted when the process stops accepting work. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /**
   * Starts a run, or does nothing once stopped: a process on its way down must
   * not open a new paid request. Failures go to `onError` — this is the outer
   * boundary, and nothing below it may reject into an unhandled promise.
   */
  start(run: BackgroundRun, onError: (error: unknown) => void): void {
    if (this.controller.signal.aborted) return;
    const promise = run(this.controller.signal)
      .catch(onError)
      .finally(() => {
        this.inFlight.delete(promise);
      });
    this.inFlight.add(promise);
  }

  /**
   * Resolves once everything started so far has finished. A run may start
   * another, so this drains rather than awaiting one snapshot of the set.
   */
  async settled(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }

  /** Cancels what is in flight and waits for it to unwind. */
  async stop(): Promise<void> {
    this.controller.abort();
    await this.settled();
  }
}
