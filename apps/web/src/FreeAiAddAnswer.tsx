// "Add the AI answer" on a finished Free report whose AI box was unticked at
// launch (D-236).
//
// The click is the consent, so the disclosure the launch form shows sits open
// beside the button rather than folded into a <details>: the same body text,
// the same Anthropic-only record (ai-processing-notice.ts), and the same
// Privacy and Terms links. The API refuses any other record
// (apps/api/src/scans/late-free-preview.ts).

import { useState } from 'react';

import { ApiRequestError, apiRequest, type ScanModule } from './api';
import { freeAiConsentRecord } from './ai-processing-notice';
import { Button } from './components';
import { freePreviewCopy } from './free-preview-copy';
import { copy, type Language } from './i18n';
import { publicPagePath } from './public-page-routing';
import { lateAttemptOf } from './use-late-free-answer';

const DISCLOSURE_ID = 'free-ai-add-disclosure';

/** `retry`: worth pressing again shortly; `refused`: the server said no for good. */
type AddState = 'idle' | 'sending' | 'retry' | 'refused';

/**
 * A request that never arrived, was rate-limited or met a server fault can
 * succeed on a later press; any other refusal (already added, not a Free
 * check, check not finished) will not, so no button is offered for it.
 */
function isTransient(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return true;
  return error.status === 0 || error.status === 429 || error.status >= 500;
}

/** Why the last attempt never started, in the owner's words, when one was handed back. */
function LastAttemptNote(props: { module: ScanModule; language: Language }) {
  const note = lateAttemptOf(props.module);
  if (note === null) return null;
  const c = freePreviewCopy[props.language].addAnswer;
  // The homepage-read reasons are the scan's own (SiteUnreachable,
  // SiteDeniedAccess, SiteBlockedByRobots, SiteReturnedNoReadablePage). A
  // robots.txt refusal will not clear by pressing again, so it says what will.
  const robots = note.reason === 'SiteBlockedByRobots';
  const text = robots
    ? c.lastAttemptRobots
    : note.reason.startsWith('Site')
      ? c.lastAttemptSiteUnread
      : c.lastAttemptPlatform;
  // The API says how many presses are left; the bound itself lives there.
  const lastOne =
    note.remaining === 1 ? (robots ? c.oneAttemptLeftRobots : c.oneAttemptLeft) : null;
  return (
    <p className="muted free-ai-add__last-attempt" role="note">
      {lastOne === null ? text : `${text} ${lastOne}`}
    </p>
  );
}

export function FreeAiAddAnswer(props: {
  scanId: string;
  module: ScanModule;
  language: Language;
  /** The request was accepted: the parent shows the running state from here. */
  onRequested: () => void;
  /** Re-reads the report, so a refused press shows what is really there. */
  onRefresh?: () => Promise<unknown>;
}) {
  const c = freePreviewCopy[props.language];
  const links = copy[props.language].newScan;
  const [state, setState] = useState<AddState>('idle');
  const add = async (): Promise<void> => {
    setState('sending');
    try {
      await apiRequest<unknown>(`/scans/${props.scanId}/free-ai-preview`, {
        method: 'POST',
        body: JSON.stringify({ aiConsent: freeAiConsentRecord() }),
      });
    } catch (error) {
      setState(isTransient(error) ? 'retry' : 'refused');
      void props.onRefresh?.();
      return;
    }
    props.onRequested();
  };
  return (
    <div className="free-ai-add">
      <LastAttemptNote module={props.module} language={props.language} />
      <p className="free-ai-add__lead">{c.addAnswer.lead}</p>
      <p className="free-ai-add__lead">{c.ask.oneModel}</p>
      <p id={DISCLOSURE_ID} className="free-ai-add__disclosure">
        {c.consent.body}{' '}
        <a href={publicPagePath('privacy', props.language)}>{links.aiConsentPrivacy}</a>
        {' · '}
        <a href={publicPagePath('terms', props.language)}>{links.aiConsentTerms}</a>
      </p>
      {state === 'refused' ? null : (
        <div className="button-row">
          <Button
            variant="primary"
            disabled={state === 'sending'}
            aria-describedby={DISCLOSURE_ID}
            onClick={() => void add()}
          >
            {state === 'sending' ? c.addAnswer.sending : c.addAnswer.button}
          </Button>
        </div>
      )}
      {state === 'retry' || state === 'refused' ? (
        <p className="muted free-ai-add__failed" role="alert">
          {state === 'retry' ? c.addAnswer.retryShortly : c.addAnswer.refused}
        </p>
      ) : null}
    </div>
  );
}
