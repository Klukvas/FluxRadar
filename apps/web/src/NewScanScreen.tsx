import { useCallback, useEffect, useRef, useState } from 'react';

import type { SiteProfile } from './api';
import { Window } from './components';
import { copy, type Language } from './i18n';
import { newScanCopy } from './new-scan-copy';
import { useNewScanForm, type NewScanForm, type NewScanFormProps } from './new-scan-form';
import { AdvancedSection } from './NewScanAdvancedSection';
import { OrderSummary } from './NewScanOrderSummary';
import { PlanStep } from './NewScanPlanStep';
import { ReachStep, SiteStep } from './NewScanSteps';
import './styles/new-scan.css';

/**
 * The new-scan screen: three numbered steps on the left (which site, what to
 * check, can we read it) with everything technical folded under them, and on
 * the right the order summary with the price and the one button.
 *
 * The state, the saved-configuration sync and the submission live in
 * `new-scan-form.ts`; the screen is the two columns the stylesheet lays out,
 * one component each. They take the whole form object rather than twenty props:
 * it is one type with one owner, and threading its fields separately is how a
 * column ends up quietly deciding something the form already decided.
 */
export function NewScanScreen(props: NewScanFormProps & { onCreateProfile: () => void }) {
  const t = copy[props.language];
  const c = newScanCopy[props.language];
  const form = useNewScanForm(props);
  const claimAutoCheck = useAutoCheckClaims();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const discardButton = useRef<HTMLButtonElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!confirmDiscard) return;
    priorFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    keepEditing.current?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      if (document.activeElement === keepEditing.current) discardButton.current?.focus();
      else if (document.activeElement === discardButton.current) keepEditing.current?.focus();
      else if (event.shiftKey) discardButton.current?.focus();
      else keepEditing.current?.focus();
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      document.removeEventListener('keydown', trapFocus);
      priorFocus.current?.focus();
    };
  }, [confirmDiscard]);
  const requestClose = () => {
    if (form.hasUnsavedChanges) setConfirmDiscard(true);
    else props.onClose();
  };
  const discard = c.discard;
  return (
    <>
      <Window
        title={t.newScan.windowTitle}
        className="window--dialog window--launch"
        onClose={requestClose}
        closeLabel={c.closeWindow}
      >
        {/* Two columns above 820px: the steps on the left, and on the right a
          sticky order summary holding the price, the button and the purchase
          terms. Narrower, it collapses to one stack with the summary after the
          steps, which is the right shape for a phone. */}
        <form className="launch-form" onSubmit={form.submit}>
          <ScanStepsColumn
            form={form}
            language={props.language}
            profiles={props.profiles}
            internalFreeAccess={props.internalFreeAccess}
            onCreateProfile={props.onCreateProfile}
            claimAutoCheck={claimAutoCheck}
          />
          <OrderSummary
            form={form}
            language={props.language}
            internalFreeAccess={props.internalFreeAccess}
          />
        </form>
      </Window>
      {confirmDiscard ? (
        <div className="modal-backdrop" onMouseDown={() => setConfirmDiscard(false)}>
          <section
            className="window window--dialog discard-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="discard-title"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setConfirmDiscard(false);
            }}
          >
            <div className="window__content stack">
              <h2 id="discard-title" className="section-heading">
                {discard.title}
              </h2>
              <p>{discard.body}</p>
              <div className="button-row">
                <button
                  ref={keepEditing}
                  className="button"
                  type="button"
                  onClick={() => setConfirmDiscard(false)}
                >
                  {discard.keep}
                </button>
                <button
                  ref={discardButton}
                  className="button button--danger"
                  type="button"
                  onClick={props.onClose}
                >
                  {discard.discard}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

/**
 * The sites this screen has already probed by itself, for as long as it is
 * open.
 *
 * Held here rather than in the reachability panel, which unmounts whenever the
 * plan goes to Free and back: a memory that died with it would probe again on
 * every toggle. Each probe is an outbound request to somebody else's server
 * and the API allows ten per account in ten minutes, so the automatic one is
 * spent once per site; "Check again" stays for every later attempt.
 */
function useAutoCheckClaims(): (profileId: string) => boolean {
  const claimed = useRef<ReadonlySet<string>>(new Set());
  return useCallback((profileId: string) => {
    if (claimed.current.has(profileId)) return false;
    claimed.current = new Set([...claimed.current, profileId]);
    return true;
  }, []);
}

/** The left column: the three steps, then everything technical, folded. */
function ScanStepsColumn(props: {
  form: NewScanForm;
  language: Language;
  profiles: readonly SiteProfile[];
  internalFreeAccess: boolean;
  onCreateProfile: () => void;
  claimAutoCheck: (profileId: string) => boolean;
}) {
  return (
    <div className="launch-form__controls">
      <SiteStep
        form={props.form}
        language={props.language}
        profiles={props.profiles}
        onCreateProfile={props.onCreateProfile}
      />
      <PlanStep
        form={props.form}
        language={props.language}
        internalFreeAccess={props.internalFreeAccess}
      />
      <ReachStep
        form={props.form}
        language={props.language}
        internalFreeAccess={props.internalFreeAccess}
        claimAutoCheck={props.claimAutoCheck}
      />
      <AdvancedSection form={props.form} language={props.language} />
    </div>
  );
}
