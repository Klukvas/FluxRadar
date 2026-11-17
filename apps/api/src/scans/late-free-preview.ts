// "Add the AI answer" on a finished Free report (D-236).
//
// A Free check launched with its AI box unticked stores the GEO row as
// Not applicable / ConsentMissing and sends nothing. The report then offers the
// same disclosure the launch form shows, beside a button; pressing it is the
// consent. This file decides whether that press may be honoured and, if so,
// claims the one late run.
//
// Writing the consent record IS the claim. One transaction moves the skipped
// GEO row to Pending, takes the scan's Job row from Done, and writes the
// AiConsent row, which is unique per scan. A second or concurrent press loses
// at least one of those three and gets a typed 409; nothing is half-written.
// The worker then runs the preview once (orchestrator/late-free-preview.ts).
// An attempt that fails before anything is sent releases the claim again, and
// takes this consent record with it, so the press can be repeated.

import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { JOB_STATUSES } from '../billing/constants.ts';
import { isUniqueViolation } from '../billing/prisma-errors.ts';
import { conflict, type ApiError } from '../http/errors.ts';
import {
  LATE_ATTEMPT_KEY,
  LATE_FREE_PREVIEW_JOB_TYPE,
  LATE_PREVIEW_MODULE,
  LATE_PREVIEW_QUEUED_METADATA,
  MAX_RELEASED_ATTEMPTS,
  RELEASED_ATTEMPTS_KEY,
  SKIPPED_ROW_KEY,
  metadataRecord,
  releasedAttemptsOf,
} from '../orchestrator/late-free-preview-job.ts';
import {
  freeAiConsentSchema,
  recordFreeAiConsent,
  type FreeAiConsentInput,
} from './free-ai-consent.ts';

/** The click's whole body: the Free record the launch form would have sent. */
export const lateFreePreviewBodySchema = z.object({ aiConsent: freeAiConsentSchema }).strict();

/** The skipped row a late preview may replace, and no other. */
const SKIPPED_STATUS = 'Not applicable';
const SKIPPED_REASON = 'ConsentMissing';

/** Statuses a Free check finishes in with a report to add the answer to. */
const FINISHED_STATUSES: ReadonlySet<string> = new Set(['Completed', 'Partial']);

export interface LateFreePreviewFacts {
  readonly plan: string;
  readonly scanStatus: string;
  /** Null for a legacy scan with no Job row: nothing can be queued for it. */
  readonly jobStatus: string | null;
  readonly geoRow: { readonly runtimeStatus: string; readonly statusReason: string | null } | null;
  readonly consentRecorded: boolean;
  /** An operator-allowlisted origin, whose preview is never asked (free-geo.ts). */
  readonly allowlistedOrigin: boolean;
  /** Earlier attempts of this scan that never started and were handed back. */
  readonly releasedAttempts: number;
}

function attemptsExhausted(): ApiError {
  return refusal(
    'FREE_AI_PREVIEW_ATTEMPTS_EXHAUSTED',
    `the AI answer could not start on ${MAX_RELEASED_ATTEMPTS} attempts and is not tried again`,
  );
}

function refusal(code: string, message: string): ApiError {
  return conflict(code, message);
}

/**
 * Why this press cannot be honoured, or null when it can. Every answer is a
 * typed 409 in the usual envelope: the scan is the caller's own (the route has
 * already given a foreign scan its 404), so the state is what refuses.
 */
export function lateFreePreviewRefusal(facts: LateFreePreviewFacts): ApiError | null {
  if (facts.plan !== 'Free') {
    return refusal('FREE_AI_PREVIEW_FREE_ONLY', 'only a Free check can add its AI answer later');
  }
  if (!FINISHED_STATUSES.has(facts.scanStatus) || facts.jobStatus !== JOB_STATUSES.done) {
    return refusal('FREE_AI_PREVIEW_SCAN_NOT_FINISHED', 'the check has not finished');
  }
  if (facts.allowlistedOrigin) {
    return refusal(
      'FREE_AI_PREVIEW_ALLOWLISTED',
      'repeated free checks of this site never include the AI answer',
    );
  }
  if (facts.consentRecorded) {
    return refusal('FREE_AI_PREVIEW_ALREADY_ADDED', 'this check already has its AI consent');
  }
  if (
    facts.geoRow === null ||
    facts.geoRow.runtimeStatus !== SKIPPED_STATUS ||
    facts.geoRow.statusReason !== SKIPPED_REASON
  ) {
    return refusal(
      'FREE_AI_PREVIEW_NOT_SKIPPED',
      'this check’s AI answer was not left out at launch',
    );
  }
  if (facts.releasedAttempts >= MAX_RELEASED_ATTEMPTS) return attemptsExhausted();
  return null;
}

/**
 * The queued row keeps the skipped row's own metadata (its crawler-readiness
 * facts), so a released or refused attempt can put that row back without
 * reading the site again. A previous attempt's failure note is not kept (the
 * new attempt is its own), but its count is: it is what bounds the attempts,
 * and it is checked again here, inside the claim, not only before it.
 */
async function queuedMetadata(
  tx: Prisma.TransactionClient,
  scanId: string,
): Promise<{ readonly read: string; readonly queued: string }> {
  const row = await tx.scanModule.findUnique({
    where: { scanId_module: { scanId, module: LATE_PREVIEW_MODULE } },
    select: { metadataJson: true },
  });
  if (row === null) throw notSkipped();
  const current = metadataRecord(row.metadataJson);
  const releasedAttempts = releasedAttemptsOf(current);
  if (releasedAttempts >= MAX_RELEASED_ATTEMPTS) throw attemptsExhausted();
  const skipped = Object.fromEntries(
    Object.entries(current).filter(
      ([key]) => key !== LATE_ATTEMPT_KEY && key !== RELEASED_ATTEMPTS_KEY,
    ),
  );
  return {
    read: row.metadataJson,
    queued: JSON.stringify({
      ...LATE_PREVIEW_QUEUED_METADATA,
      [SKIPPED_ROW_KEY]: skipped,
      [RELEASED_ATTEMPTS_KEY]: releasedAttempts,
    }),
  };
}

async function queueSkippedRow(tx: Prisma.TransactionClient, scanId: string): Promise<void> {
  const { read, queued: metadataJson } = await queuedMetadata(tx, scanId);
  // Pinned to the metadata the count was read from: a row that changed since
  // (another release, another claim) is not this claim's, and a stale count is
  // never written back over it.
  const { count } = await tx.scanModule.updateMany({
    where: {
      scanId,
      module: LATE_PREVIEW_MODULE,
      runtimeStatus: SKIPPED_STATUS,
      statusReason: SKIPPED_REASON,
      metadataJson: read,
    },
    data: {
      runtimeStatus: 'Pending',
      statusReason: null,
      coverage: null,
      score: null,
      usableOutput: false,
      metadataJson,
    },
  });
  if (count !== 1) throw notSkipped();
}

function notSkipped(): ApiError {
  return refusal(
    'FREE_AI_PREVIEW_NOT_SKIPPED',
    'this check’s AI answer was not left out at launch',
  );
}

async function takeFinishedJob(tx: Prisma.TransactionClient, scanId: string): Promise<void> {
  const { count } = await tx.job.updateMany({
    where: { scanId, status: JOB_STATUSES.done },
    data: {
      status: JOB_STATUSES.pending,
      type: LATE_FREE_PREVIEW_JOB_TYPE,
      claimedAt: null,
      leaseUntil: null,
    },
  });
  if (count !== 1) {
    throw refusal('FREE_AI_PREVIEW_SCAN_NOT_FINISHED', 'the check has not finished');
  }
}

/**
 * The claim, all or nothing. The caller enqueues the scan afterwards; a claim
 * whose enqueue is lost is still picked up by the queue drain, because the Job
 * row is Pending.
 */
export async function claimLateFreePreview(
  prisma: PrismaClient,
  params: {
    readonly accountId: string;
    readonly scanId: string;
    readonly consent: FreeAiConsentInput;
  },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await queueSkippedRow(tx, params.scanId);
    await takeFinishedJob(tx, params.scanId);
    try {
      await recordFreeAiConsent(tx, params);
    } catch (error) {
      if (isUniqueViolation(error, 'scanId')) {
        throw refusal('FREE_AI_PREVIEW_ALREADY_ADDED', 'this check already has its AI consent');
      }
      throw error;
    }
  });
}
