// Can we read this site? — asked on the scan form, before the pay button.
//
// A customer could buy a $120 audit of a site that refuses our crawler, wait
// for the scan and get a refund instead of a report. The server now refuses
// that sale (`createCheckoutSession`), and this panel is how the buyer finds
// out before they meet the refusal: it runs the same probe, shows what the site
// answered, and says what to do about it.
//
// The panel never decides anything. `canPurchase` comes from the API, which
// re-reads its own stored probe when the checkout opens — a browser that has
// been told the site is fine proves nothing.

import { useCallback, useEffect, useState } from 'react';

import { apiRequest, type SiteReachability } from './api';
import { Button, Panel, StatusChip } from './components';
import { copy, fillCopy, type Language } from './i18n';

export interface SiteReachabilityPanelProps {
  readonly language: Language;
  /**
   * The profile to check, or null when the form has no site yet. A typed
   * address has no profile until it is resolved, so the panel asks the form for
   * one only when the reader presses the button — typing must not create
   * profiles, and each probe reaches somebody else's server.
   */
  readonly resolveProfileId: () => Promise<string | null>;
  /** The saved profile currently selected, so a change re-reads its last answer. */
  readonly profileId: string | null;
  /**
   * The egress location the scan will leave from, or null for the default. A
   * site can let one country in and refuse another, so the probe leaves from
   * the same one — and a change of country re-reads the answer for it.
   */
  readonly egressLocationId?: string | null;
  /** Tells the form whether the purchase may proceed. */
  readonly onResult: (canPurchase: boolean) => void;
}

type PanelState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'result'; readonly result: SiteReachability }
  | { readonly kind: 'failed' };

export function SiteReachabilityPanel(props: SiteReachabilityPanelProps) {
  const t = copy[props.language].reachability;
  const [state, setState] = useState<PanelState>({ kind: 'idle' });
  const { egressLocationId = null, onResult, profileId, resolveProfileId } = props;

  // A saved profile may already have been checked. Reading that costs nothing
  // and is not rate-limited, so the reader does not press a button to be told
  // something we already know.
  useEffect(() => {
    if (profileId === null) {
      setState({ kind: 'idle' });
      onResult(false);
      return;
    }
    let current = true;
    const query =
      egressLocationId === null ? '' : `?egressLocation=${encodeURIComponent(egressLocationId)}`;
    apiRequest<SiteReachability>(`/profiles/${encodeURIComponent(profileId)}/reachability${query}`)
      .then((result) => {
        if (!current) return;
        setState(result.state === null ? { kind: 'idle' } : { kind: 'result', result });
        onResult(result.canPurchase);
      })
      .catch(() => {
        if (!current) return;
        // An unreadable last answer is not a verdict on the site: the reader is
        // offered the check rather than a failure they did not cause.
        setState({ kind: 'idle' });
        onResult(false);
      });
    return () => {
      current = false;
    };
  }, [egressLocationId, profileId, onResult]);

  const check = useCallback(async (): Promise<void> => {
    setState({ kind: 'checking' });
    onResult(false);
    try {
      const id = await resolveProfileId();
      if (id === null) {
        // The form is already saying why — an address it cannot read.
        setState({ kind: 'idle' });
        return;
      }
      const result = await apiRequest<SiteReachability>(
        `/profiles/${encodeURIComponent(id)}/reachability`,
        {
          method: 'POST',
          body: JSON.stringify(
            egressLocationId === null ? {} : { egressLocation: egressLocationId },
          ),
        },
      );
      setState({ kind: 'result', result });
      onResult(result.canPurchase);
    } catch {
      // Every message an ApiRequestError carries is written in English by the
      // API; the panel says what happened in the language it is read in, and
      // the retry is the part that was ever actionable.
      setState({ kind: 'failed' });
      onResult(false);
    }
  }, [egressLocationId, onResult, resolveProfileId]);

  return (
    <Panel title={t.title}>
      <p className="muted panel-help">{t.lead}</p>
      <Body language={props.language} state={state} />
      <div className="button-row">
        <Button onClick={() => void check()} disabled={state.kind === 'checking'}>
          {state.kind === 'result' || state.kind === 'failed' ? t.again : t.check}
        </Button>
      </div>
    </Panel>
  );
}

function Body(props: { language: Language; state: PanelState }) {
  const t = copy[props.language].reachability;
  if (props.state.kind === 'checking') return <p className="muted">{t.checking}</p>;
  if (props.state.kind === 'failed')
    return (
      <p className="muted" role="alert">
        {t.failed}
      </p>
    );
  if (props.state.kind === 'idle') return <p className="muted">{t.unchecked}</p>;

  const { result } = props.state;
  const expired = result.expired === true;
  return (
    <>
      <div className="split">
        <StatusChip
          // The machine word the chip colours itself from (`statusKind`); the
          // label beside it is what the reader actually reads.
          status={result.canPurchase ? 'ok' : 'warning'}
          label={expired ? t.states.expired.label : stateCopy(props.language, result.state).label}
        />
      </div>
      <p role="status">
        {expired ? t.states.expired.body : stateCopy(props.language, result.state).body}
      </p>
      {result.startStatus === null || result.canPurchase ? null : (
        <p className="muted">{fillCopy(t.answeredWith, { status: String(result.startStatus) })}</p>
      )}
      {result.accessControlSignals !== undefined && result.accessControlSignals.length > 0 ? (
        // Named, not interpreted: a site may sit behind Cloudflare and answer
        // perfectly well, so this is evidence for its owner rather than a verdict.
        <p className="muted">
          {fillCopy(t.signals, { signals: result.accessControlSignals.join(', ') })}
        </p>
      ) : null}
    </>
  );
}

/** The sentence for one reach verdict; an unknown state gets the neutral one. */
function stateCopy(
  language: Language,
  state: SiteReachability['state'],
): { label: string; body: string } {
  const t = copy[language].reachability;
  switch (state) {
    case 'reachable':
      return t.states.reachable;
    case 'access-denied':
      return t.states.accessDenied;
    case 'blocked-by-robots':
      return t.states.blockedByRobots;
    case 'unreachable':
      return t.states.unreachable;
    case 'bad-response':
      return t.states.badResponse;
    default:
      return t.states.unknown;
  }
}
