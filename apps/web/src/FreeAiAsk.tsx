// "Ask an AI what it knows about your business?" on the progress screen of a
// Free check that was started without its AI question.
//
// A check started from the address on the public page skips the scan form, and
// with it the consent box (auto-free-check.ts). The eleven seconds the check
// takes are when its owner is looking at this screen with nothing to do, so the
// question is put here: one model, one question, and what a paid check asks
// instead.
//
// The click is the consent, exactly as on a finished report (FreeAiAddAnswer):
// the same disclosure sits open beside the button and the same Anthropic-only
// record is sent. The API adds the answer to a finished check only, so a yes
// given while the check is still running is held here and sent when it ends.
// Nothing is sent before that, and nothing at all after a no.

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiRequestError, apiRequest, type Scan } from './api';
import { freeAiConsentRecord } from './ai-processing-notice';
import { Button, Panel } from './components';
import { freePreviewCopy } from './free-preview-copy';
import { copy, type Language } from './i18n';
import { publicPagePath } from './public-page-routing';
import { leftOutAtLaunch } from './use-late-free-answer';

import './styles/free-ai-preview.css';

const GEO_MODULE = 'AI SEO / GEO';
const DISCLOSURE_ID = 'free-ai-ask-disclosure';

/** Statuses a Free check ends in with a report the answer can be added to. */
const FINISHED_WITH_REPORT: ReadonlySet<string> = new Set(['Completed', 'Partial']);

/**
 * The scan reads as finished a moment before its job row does, and the API
 * refuses the request in between. A few short retries cover that gap.
 */
const NOT_FINISHED_CODE = 'FREE_AI_PREVIEW_SCAN_NOT_FINISHED';
/** The consent is already on record: the answer is on its way, by another press. */
const ALREADY_ADDED_CODE = 'FREE_AI_PREVIEW_ALREADY_ADDED';
/** An operator-allowlisted site never gets the answer; the report says so itself. */
const ALLOWLISTED_CODE = 'FREE_AI_PREVIEW_ALLOWLISTED';
export const ASK_RETRY_MS = 1500;
export const ASK_MAX_RETRIES = 4;

/**
 * `declined`: the owner said no; one line says so, and nothing is sent.
 * `closed`: this check takes no late answer and its report explains why; the
 * card is gone and nothing is sent from it.
 */
type Phase = 'asking' | 'queued' | 'sending' | 'requested' | 'failed' | 'declined' | 'closed';

/** The phases in which a yes has been given and not yet sent. */
const HELD: ReadonlySet<Phase> = new Set(['queued', 'sending']);

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Sends the consent, retrying only the "not finished yet" refusal. */
async function requestAnswer(
  scanId: string,
  retriesLeft: number,
): Promise<'requested' | 'failed' | 'closed'> {
  try {
    await apiRequest<unknown>(`/scans/${scanId}/free-ai-preview`, {
      method: 'POST',
      body: JSON.stringify({ aiConsent: freeAiConsentRecord() }),
    });
    return 'requested';
  } catch (error) {
    const code = error instanceof ApiRequestError ? error.code : null;
    if (code === NOT_FINISHED_CODE && retriesLeft > 0) {
      await wait(ASK_RETRY_MS);
      return requestAnswer(scanId, retriesLeft - 1);
    }
    if (code === ALREADY_ADDED_CODE) return 'requested';
    if (code === ALLOWLISTED_CODE) return 'closed';
    console.error('FluxRadar could not request the Free AI answer', error);
    return 'failed';
  }
}

export function FreeAiAsk(props: {
  scan: Scan;
  /** The check has ended and its report is readable. */
  settled: boolean;
  language: Language;
  /**
   * Whether a yes is waiting to be sent. The screen around the card hides what
   * would take the owner away from it meanwhile — leaving drops the yes.
   */
  onHeldChange?: (held: boolean) => void;
}) {
  const c = freePreviewCopy[props.language];
  const links = copy[props.language].newScan;
  const { scan, settled, onHeldChange } = props;
  const [phase, setPhase] = useState<Phase>('asking');
  const statusRef = useRef<HTMLDivElement>(null);
  const geo = scan.modules.find((module) => module.module === GEO_MODULE);
  // The finished check holds a skipped AI row: the one state the API accepts.
  const sendable =
    settled && FINISHED_WITH_REPORT.has(scan.status) && geo !== undefined && leftOutAtLaunch(geo);
  const scanId = scan.id;
  const send = useCallback(async (): Promise<void> => {
    setPhase('sending');
    setPhase(await requestAnswer(scanId, ASK_MAX_RETRIES));
  }, [scanId]);
  useEffect(() => {
    if (phase !== 'queued') return;
    if (sendable) void send();
    // Ended with no skipped AI row to fill: the report says what is there, and
    // "the question could not be sent" would promise a button it does not have.
    else if (settled) setPhase('closed');
  }, [phase, sendable, settled, send]);
  const held = HELD.has(phase);
  useEffect(() => {
    onHeldChange?.(held);
    // Gone while holding (another scan opened on the same screen): the screen
    // must not keep hiding its buttons for a yes nobody is waiting on.
    return () => {
      if (held) onHeldChange?.(false);
    };
  }, [held, onHeldChange]);
  // The pressed button is gone once the card answers; the answer takes the
  // focus, so a keyboard reader is not dropped back at the top of the page.
  // Only the two phases a press leads to: what follows on its own — the check
  // ending, the answer being sent — must not pull the focus from wherever the
  // reader has moved it since.
  useEffect(() => {
    if (phase === 'queued' || phase === 'declined') statusRef.current?.focus();
  }, [phase]);

  if (phase === 'closed') return null;
  // A check that ended without a report has nothing to add an answer to.
  if (settled && !FINISHED_WITH_REPORT.has(scan.status)) return null;
  // Finished without a skipped AI row (an allowlisted site, a row already
  // filled): a question here could not be acted on.
  if (phase === 'asking' && settled && !sendable) return null;
  const status: Readonly<Record<Exclude<Phase, 'asking' | 'closed'>, string>> = {
    queued: c.ask.queued,
    sending: c.ask.sending,
    requested: c.ask.requested,
    failed: c.ask.failed,
    declined: c.ask.declined,
  };
  return (
    <Panel title={c.ask.heading}>
      <div className="free-ai-ask">
        {phase === 'asking' ? (
          <>
            <p className="free-ai-ask__one-model">{c.ask.oneModel}</p>
            <p id={DISCLOSURE_ID} className="free-ai-add__disclosure">
              {c.consent.body}{' '}
              <a href={publicPagePath('privacy', props.language)}>{links.aiConsentPrivacy}</a>
              {' · '}
              <a href={publicPagePath('terms', props.language)}>{links.aiConsentTerms}</a>
            </p>
            <div className="button-row">
              <Button
                variant="primary"
                aria-describedby={DISCLOSURE_ID}
                onClick={() => setPhase('queued')}
              >
                {c.ask.yes}
              </Button>
              <Button onClick={() => setPhase('declined')}>{c.ask.no}</Button>
            </div>
          </>
        ) : (
          // The focus sits on this wrapper, which stays put; the answer inside it
          // is a status, and a failure an alert of its own, so the one node that
          // changes role is remounted without taking the focus with it.
          <div ref={statusRef} tabIndex={-1} className="free-ai-ask__answer">
            <p
              className="free-ai-ask__status"
              role={phase === 'failed' ? 'alert' : 'status'}
              key={phase === 'failed' ? 'alert' : 'status'}
            >
              {status[phase]}
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
