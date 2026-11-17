// The state of "Add the AI answer" on a finished Free report (D-236): whether
// the late answer is on its way, whether its last attempt never started, and a
// bounded re-read of the report while it runs.

import { useCallback, useEffect, useState } from 'react';

import type { ScanModule } from './api';

/** How often a report re-reads itself while its AI answer is being added. */
export const ADD_ANSWER_POLL_MS = 3000;

/**
 * How many re-reads before the report stops asking and says to reload: three
 * minutes, several times what one question and its check take.
 */
export const ADD_ANSWER_MAX_POLLS = 60;

const IN_PROGRESS = new Set(['Pending', 'Queued', 'Running']);

/** The skipped row a finished report may still add its one answer to. */
export function leftOutAtLaunch(module: ScanModule): boolean {
  return module.status === 'Not applicable' && module.statusReason === 'ConsentMissing';
}

/**
 * Why the last late attempt did not start, when one was handed back
 * (apps/api/src/orchestrator/late-free-preview-state.ts writes `lateAttempt`).
 */
export interface LateAttemptNote {
  readonly reason: string;
  readonly at: string | null;
  /** No further press will be accepted (the API's attempt bound was reached). */
  readonly final: boolean;
  /** Presses still accepted, as the API counted them; null on an older note. */
  readonly remaining: number | null;
}

export function lateAttemptOf(module: ScanModule): LateAttemptNote | null {
  const note = module.metadata?.lateAttempt;
  if (typeof note !== 'object' || note === null) return null;
  const { reason, at, final, remaining } = note as Record<string, unknown>;
  if (typeof reason !== 'string') return null;
  return {
    reason,
    at: typeof at === 'string' ? at : null,
    final: final === true,
    remaining: typeof remaining === 'number' ? remaining : null,
  };
}

export interface LateFreeAnswer {
  /** The answer is on its way: the report re-reads itself. */
  readonly running: boolean;
  /** Running because the owner asked for it, now or before a reload. */
  readonly adding: boolean;
  /** The re-reads ran out before the answer arrived. */
  readonly timedOut: boolean;
  /** The add request was accepted. */
  readonly onRequested: () => void;
}

export function useLateFreeAnswer(
  module: ScanModule | undefined,
  hasAnswer: boolean,
  onRefresh: (() => Promise<unknown>) | undefined,
): LateFreeAnswer {
  // The release note present when the owner pressed: the press is still being
  // waited for while the row reads the same as then. A new note means that
  // attempt was handed back, and the button returns with it.
  const [pressedOver, setPressedOver] = useState<{ readonly at: string | null } | null>(null);
  const [polls, setPolls] = useState(0);
  const awaitingQueue =
    module !== undefined &&
    pressedOver !== null &&
    leftOutAtLaunch(module) &&
    (lateAttemptOf(module)?.at ?? null) === pressedOver.at;
  const running =
    module !== undefined && !hasAnswer && (IN_PROGRESS.has(module.status) || awaitingQueue);
  const timedOut = running && polls >= ADD_ANSWER_MAX_POLLS;
  useEffect(() => {
    if (!running || timedOut || onRefresh === undefined) return undefined;
    const timer = setTimeout(() => {
      setPolls((count) => count + 1);
      void onRefresh();
    }, ADD_ANSWER_POLL_MS);
    return () => clearTimeout(timer);
  }, [running, timedOut, onRefresh, polls]);
  const onRequested = useCallback(() => {
    setPressedOver({ at: module === undefined ? null : (lateAttemptOf(module)?.at ?? null) });
    setPolls(0);
    void onRefresh?.();
  }, [module, onRefresh]);
  const adding = running && (pressedOver !== null || module?.metadata?.latePreview === true);
  return { running, adding, timedOut, onRequested };
}
