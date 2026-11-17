// The late Free AI preview (D-236): the one AI answer a finished Free check
// adds after its owner presses "Add the AI answer" on the report.
//
// Kept free of imports on purpose. The report-readiness rule, the route and the
// worker all read these names, and the runner itself (late-free-preview.ts)
// pulls in the whole crawl and AI stack.

/**
 * The scan's one Job row is reused for the late run, under this type, so a
 * process that dies mid-run is requeued by the existing lease recovery
 * (claim.ts `recoverClaimedJobs`) instead of leaving the row Pending forever.
 * It is deliberately not a `module-retry:` job: that path replaces the module
 * and counts as "already requested" for the preview (free-geo.ts
 * `geoStageReached`), and it runs the scan state machine, which a finished
 * Free report must not re-enter.
 */
export const LATE_FREE_PREVIEW_JOB_TYPE = 'free-ai-preview';

export const LATE_PREVIEW_MODULE = 'AI SEO / GEO';

/** Where the queued row keeps the skipped row's own metadata (readiness facts). */
export const SKIPPED_ROW_KEY = 'skippedRow';

/** Where a released row says why the last attempt did not start. */
export const LATE_ATTEMPT_KEY = 'lateAttempt';

/** Where a queued row carries how many earlier attempts were handed back. */
export const RELEASED_ATTEMPTS_KEY = 'releasedAttempts';

/**
 * Each handed-back attempt still costs an egress probe and a read of the
 * homepage through the scan's proxy, so a scan gets this many and no more.
 */
export const MAX_RELEASED_ATTEMPTS = 3;

/**
 * Written by the claim (the route's transaction) on a GEO row that was the
 * skipped ConsentMissing one. Pending: nothing has been sent yet. A failure of
 * any kind while the row is still Pending releases the claim
 * (late-free-preview.ts `releaseLatePreview`): the row goes back to the
 * skipped state the report's button keys on, so a later press may try again.
 */
export const LATE_PREVIEW_QUEUED_METADATA: Readonly<Record<string, unknown>> = {
  freePreview: true,
  latePreview: true,
};

/**
 * Added by the runner the moment before the first request can leave. The same
 * sticky `previewRequested` marker the scan run uses (module-rows.ts): a row
 * that has carried it is never released and never asked again.
 */
export const LATE_PREVIEW_STARTED_METADATA: Readonly<Record<string, unknown>> = {
  ...LATE_PREVIEW_QUEUED_METADATA,
  previewRequested: true,
};

/**
 * What one late attempt may do, read off the GEO row it starts from.
 *
 *  - `ask`     the row is still the queued claim: read the homepage, then ask.
 *  - `refuse`  the row is Running: an earlier attempt reached the provider step
 *              (or may have), so this one only records that and asks nothing.
 *  - `nothing` the row has settled already, or is gone: a duplicate job.
 */
export type LateRunDecision = 'ask' | 'refuse' | 'nothing';

export function lateRunDecision(row: { readonly runtimeStatus: string } | null): LateRunDecision {
  if (row?.runtimeStatus === 'Pending') return 'ask';
  if (row?.runtimeStatus === 'Running') return 'refuse';
  return 'nothing';
}

/** Parses a stored metadata column; unreadable JSON proves nothing and reads as empty. */
export function metadataRecord(json: string | null | undefined): Record<string, unknown> {
  if (json === null || json === undefined) return {};
  try {
    const value = JSON.parse(json) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    // A damaged column carries no facts; the caller rebuilds from defaults.
    return {};
  }
}

/**
 * How many attempts of this scan were handed back so far: the count a released
 * row's note carries, or the one its queued row carried forward.
 */
export function releasedAttemptsOf(metadata: Readonly<Record<string, unknown>>): number {
  const note = metadata[LATE_ATTEMPT_KEY];
  const noted =
    typeof note === 'object' && note !== null ? (note as Record<string, unknown>).count : undefined;
  const carried = metadata[RELEASED_ATTEMPTS_KEY];
  return Math.max(typeof noted === 'number' ? noted : 0, typeof carried === 'number' ? carried : 0);
}

/** The skipped row's own metadata, as the claim kept it on the queued row. */
export function skippedRowMetadata(queuedJson: string | null): Record<string, unknown> {
  const kept = metadataRecord(queuedJson)[SKIPPED_ROW_KEY];
  return typeof kept === 'object' && kept !== null && !Array.isArray(kept)
    ? (kept as Record<string, unknown>)
    : {};
}
