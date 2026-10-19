// Can we read this site? — asked on the scan form, before the pay button.
//
// A customer could buy a paid audit of a site that refuses our crawler, wait
// for the scan and get a refund instead of a report. The server now refuses
// that sale (`createCreemCheckoutSession`), and this panel is how the buyer finds
// out before they meet the refusal: it runs the same probe, shows what the site
// answered, and says what to do about it.
//
// The panel never decides anything. `canPurchase` comes from the API, which
// re-reads its own stored probe when the checkout opens — a browser that has
// been told the site is fine proves nothing.

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiRequest, type SiteReachability } from './api';
import { Button } from './components';
import { copy, fillCopy, type Language } from './i18n';
import { readSiteReachability } from './site-reachability-response';

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
  /**
   * Run the probe without a click when the site has never been checked.
   *
   * Absent means never: the panel only probes on request. When present, the
   * panel probes only after the stored answer came back as "never checked",
   * only once `ready` says the egress location is settled (a probe from the
   * wrong country would be stored and then read as "never checked" for the
   * right one), and only when `claim` agrees — the screen owns that memory,
   * because this panel unmounts whenever the plan goes to Free and back.
   */
  readonly autoCheck?: {
    readonly ready: boolean;
    readonly claim: (profileId: string) => boolean;
  };
}

type PanelState =
  | { readonly kind: 'idle' }
  /** The API's own answer that this site has no current probe for `key`. */
  | { readonly kind: 'unchecked'; readonly key: string }
  | { readonly kind: 'checking' }
  | { readonly kind: 'result'; readonly result: SiteReachability }
  | { readonly kind: 'failed' };

/** Which stored answer a state describes: one per profile and country. */
function answerKey(profileId: string, egressLocationId: string | null): string {
  return `${profileId}|${egressLocationId ?? ''}`;
}

export function SiteReachabilityPanel(props: SiteReachabilityPanelProps) {
  const t = copy[props.language].reachability;
  const [state, setState] = useState<PanelState>({ kind: 'idle' });
  const { autoCheck, egressLocationId = null, onResult, profileId, resolveProfileId } = props;
  // Which request may still write its answer. A read for another site or
  // country, or a newer probe, moves it on; anything that finishes after that
  // is about a purchase no longer on screen, and must not set this one's
  // state or unlock (or block) its pay button.
  const latestRequest = useRef(0);
  // Unmounting retires whatever is in flight as well: a probe the reader can
  // no longer see must not be sent, or answer, after the panel has gone.
  useEffect(
    () => () => {
      latestRequest.current += 1;
    },
    [],
  );

  // A saved profile may already have been checked. Reading that costs nothing
  // and is not rate-limited, so the reader does not press a button to be told
  // something we already know.
  useEffect(() => {
    if (profileId === null) {
      setState({ kind: 'idle' });
      onResult(false);
      return;
    }
    latestRequest.current += 1;
    const request = latestRequest.current;
    let current = true;
    const query =
      egressLocationId === null ? '' : `?egressLocation=${encodeURIComponent(egressLocationId)}`;
    apiRequest<unknown>(`/profiles/${encodeURIComponent(profileId)}/reachability${query}`)
      .then((value) => {
        if (!current || request !== latestRequest.current) return;
        const result = readSiteReachability(value);
        // An answer of the wrong shape is no answer: it must neither unlock
        // the purchase nor count as "never checked" and start a probe.
        if (result === null) {
          setState({ kind: 'idle' });
          onResult(false);
          return;
        }
        setState(
          result.state === null
            ? { kind: 'unchecked', key: answerKey(profileId, egressLocationId) }
            : { kind: 'result', result },
        );
        onResult(result.canPurchase);
      })
      .catch(() => {
        if (!current || request !== latestRequest.current) return;
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
    latestRequest.current += 1;
    const request = latestRequest.current;
    const stale = (): boolean => request !== latestRequest.current;
    setState({ kind: 'checking' });
    onResult(false);
    try {
      const id = await resolveProfileId();
      if (stale()) return;
      if (id === null) {
        // The form is already saying why — an address it cannot read.
        setState({ kind: 'idle' });
        return;
      }
      const result = readSiteReachability(
        await apiRequest<unknown>(`/profiles/${encodeURIComponent(id)}/reachability`, {
          method: 'POST',
          body: JSON.stringify(
            egressLocationId === null ? {} : { egressLocation: egressLocationId },
          ),
        }),
      );
      if (stale()) return;
      if (result === null) throw new Error('Unreadable reachability answer');
      setState({ kind: 'result', result });
      onResult(result.canPurchase);
    } catch {
      if (stale()) return;
      // Every message an ApiRequestError carries is written in English by the
      // API; the panel says what happened in the language it is read in, and
      // the retry is the part that was ever actionable.
      setState({ kind: 'failed' });
      onResult(false);
    }
  }, [egressLocationId, onResult, resolveProfileId]);

  // The probe a buyer would otherwise have to ask for. Only on the API's own
  // "never checked" for exactly this site and country — never on an expired or
  // refused answer, which already says something — and at most once per site
  // for as long as the screen is open (`claim`), so toggling plans cannot turn
  // it into a stream of requests to somebody else's server.
  const autoReady = autoCheck?.ready === true;
  const claimAutoCheck = autoCheck?.claim;
  const uncheckedKey = state.kind === 'unchecked' ? state.key : null;
  useEffect(() => {
    if (!autoReady || claimAutoCheck === undefined || profileId === null) return;
    if (uncheckedKey !== answerKey(profileId, egressLocationId)) return;
    if (!claimAutoCheck(profileId)) return;
    void check();
  }, [autoReady, check, claimAutoCheck, egressLocationId, profileId, uncheckedKey]);

  const answered = state.kind === 'result' || state.kind === 'failed';
  return (
    <div className="reach-step">
      <Body language={props.language} state={state} />
      {state.kind === 'checking' ? null : (
        <div className="button-row">
          <Button onClick={() => void check()}>{answered ? t.again : t.check}</Button>
        </div>
      )}
    </div>
  );
}

function Body(props: { language: Language; state: PanelState }) {
  const t = copy[props.language].reachability;
  if (props.state.kind === 'checking')
    return (
      <p className="muted" role="status">
        {t.checking}
      </p>
    );
  if (props.state.kind === 'failed')
    return (
      <p className="muted" role="alert">
        {t.failed}
      </p>
    );
  if (props.state.kind === 'idle' || props.state.kind === 'unchecked')
    return <p className="muted">{t.unchecked}</p>;

  const { result } = props.state;
  const expired = result.expired === true;
  const verdict = expired ? t.states.expired : stateCopy(props.language, result.state);
  // A refusal is the one thing on this form that stops the purchase, so it is
  // drawn as a verdict box the reader cannot scroll past, not as a chip and a
  // grey line. `canPurchase` is the API's word; the colour only repeats it.
  const tone = result.canPurchase ? 'ok' : 'blocked';
  return (
    <div className={`reach-verdict reach-verdict--${tone}`} role="status">
      <span className="reach-verdict__icon" aria-hidden="true">
        {result.canPurchase ? '✓' : '!'}
      </span>
      <div className="reach-verdict__text">
        <strong className="reach-verdict__label">{verdict.label}</strong>
        <p className="reach-verdict__body">{verdict.body}</p>
        {result.startStatus === null || result.canPurchase ? null : (
          <p className="reach-verdict__meta">
            {fillCopy(t.answeredWith, { status: String(result.startStatus) })}
          </p>
        )}
        {result.accessControlSignals !== undefined && result.accessControlSignals.length > 0 ? (
          // Named, not interpreted: a site may sit behind Cloudflare and answer
          // perfectly well, so this is evidence for its owner rather than a verdict.
          <p className="reach-verdict__meta">
            {fillCopy(t.signals, { signals: result.accessControlSignals.join(', ') })}
          </p>
        ) : null}
      </div>
    </div>
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
