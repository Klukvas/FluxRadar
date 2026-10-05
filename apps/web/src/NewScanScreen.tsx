import { useEffect, useRef, useState } from 'react';

import { Button, Checkbox, FieldRow, Panel, SelectField, StatusChip, Window } from './components';
import {
  apiRequest,
  type CheckoutConfig,
  type GoogleBinding,
  type IntegrationStatus,
  type SiteProfile,
} from './api';
import { AdvancedCrawlRules, ExpertSettings } from './NewScanExpertSettings';
import { SiteReachabilityPanel } from './SiteReachability';
import { LaunchSummary } from './LaunchSummary';
import { RobotsConfirmation } from './RobotsConfirmation';
import { ScanCallout } from './ScanCallout';
import { copy, type Language } from './i18n';
import { newScanCopy } from './new-scan-copy';
import { useNewScanForm, type NewScanForm, type NewScanFormProps } from './new-scan-form';
import { PLAN_MODULES, type Plan } from './plan-modules';
import './styles/new-scan.css';

/**
 * What to tell a buyer who cannot pay yet.
 *
 * The server answers with a closed code and never with its configuration, so the
 * distinction the buyer sees is made here: "this deployment does not sell scans"
 * reads differently from "payments are set up and currently broken", and a
 * config we could not read at all says neither.
 */
function paidUnavailableCopy(t: (typeof copy)[Language], config: CheckoutConfig | null): string {
  if (config === null) return t.newScan.paidUnavailable;
  return config.unavailableReason === 'misconfigured'
    ? t.checkout.unavailableTemporary
    : t.checkout.unavailable;
}

/**
 * Who takes the payment, for the note beside the pay button.
 *
 * Creem is the only provider this deployment sells through. With no config
 * yet, the note closes on the policies instead of naming a merchant nothing
 * has confirmed.
 */
function purchaseTermsMerchant(
  t: (typeof copy)[Language],
  config: CheckoutConfig | null,
): string | null {
  return config === null ? null : t.newScan.purchaseTermsMerchant;
}

/**
 * The new-scan screen: what is being checked, and what it costs.
 *
 * The state, the saved-configuration sync and the submission live in
 * `new-scan-form.ts`; the screen is the two columns the stylesheet lays out,
 * one component each. They take the whole form object rather than twenty props:
 * it is one type with one owner, and threading its fields separately is how a
 * column ends up quietly deciding something the form already decided.
 */
export function NewScanScreen(props: NewScanFormProps) {
  const t = copy[props.language];
  const form = useNewScanForm(props);
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
  const discard =
    props.language === 'uk'
      ? {
          title: 'Відкинути незбережені налаштування?',
          body: 'Зміни до нового сканування буде втрачено.',
          keep: 'Продовжити редагування',
          discard: 'Відкинути зміни',
        }
      : {
          title: 'Discard unsaved scan setup?',
          body: 'Your changes to this new scan will be lost.',
          keep: 'Keep editing',
          discard: 'Discard changes',
        };
  return (
    <>
      <Window
        title={t.newScan.windowTitle}
        className="window--dialog window--launch"
        onClose={requestClose}
        closeLabel={props.language === 'uk' ? 'Закрити вікно' : 'Close window'}
      >
        {/* Two columns from 1100px: the settings on the left, and on the right a
          sticky launch column holding the summary, the purchase terms and the
          buttons. The screen was a 520px ribbon 2300px tall with the pay button
          under every word of it; below 1100px it collapses back to that single
          stack, which is the right shape for a phone. */}
        <form className="launch-form" onSubmit={form.submit}>
          <ScanSettingsColumn form={form} language={props.language} profiles={props.profiles} />
          <ScanLaunchColumn
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

/** The left column: which site, on which plan, and the folded crawl settings. */
function ScanSettingsColumn(props: {
  form: NewScanForm;
  language: Language;
  profiles: readonly SiteProfile[];
}) {
  const t = copy[props.language];
  return (
    <div className="launch-form__controls">
      <ScanTargetPanel form={props.form} language={props.language} profiles={props.profiles} />
      <ScanDepthPanel form={props.form} language={props.language} />
      {/* What Free actually is, in place of the controls it does not have. The
          two rows are the enforced settings, not suggestions: the crawler reads
          the homepage and obeys robots.txt on this plan whatever the request
          says. */}
      {props.form.paidScopeControls ? null : (
        <Panel title={t.newScan.freeScopeTitle}>
          <p className="muted panel-help">{t.newScan.freeScopeNote}</p>
          <FieldRow label={t.newScan.freeScopePages} value={t.newScan.freeScopePagesValue} />
          <FieldRow label={t.newScan.freeScopeRobots} value={t.newScan.freeScopeRobotsValue} />
          <p className="muted panel-help">{t.newScan.freeScopeLocked}</p>
        </Panel>
      )}
      {/* Everything below is optional crawl tuning, folded so the site, the
          plan and the button are what the screen opens on. */}
      <ExpertSettings form={props.form} language={props.language} />
      {props.form.paidScopeControls ? (
        <AdvancedCrawlRules form={props.form} language={props.language} />
      ) : null}
    </div>
  );
}

/** Which site the scan runs against, and the settings stored with it. */
function ScanTargetPanel(props: {
  form: NewScanForm;
  language: Language;
  profiles: readonly SiteProfile[];
}) {
  const t = copy[props.language];
  const {
    carriedOver,
    chooseTarget,
    configurationState,
    configurationStatusLabel,
    target,
    usingSavedProfile,
  } = props.form;
  return (
    <Panel title={t.newScan.panelTarget}>
      {/* The field picks a saved profile, so it is named after what it picks.
            The public-site semantics the old "Public origin" label carried live
            in the hint, where they describe the scan rather than renaming the
            saved profile being chosen. */}
      {props.profiles.length === 0 ? (
        <>
          <p className="muted panel-help">{t.newScan.noProfilesLead}</p>
          <a className="button" href="/profiles">
            {props.language === 'uk' ? 'Створити профіль' : 'Create profile'}
          </a>
        </>
      ) : (
        <SelectField
          label={t.newScan.labelProfile}
          name="scan-profile"
          autoComplete="off"
          // The hint describes a saved profile, so it goes away with the
          // profile: no separate address can be launched from this form.
          {...(usingSavedProfile ? { hint: t.newScan.hintProfile } : {})}
          value={target}
          onChange={chooseTarget}
          options={props.profiles.map((profile) => ({
            value: profile.id,
            label: `${profile.name} · ${profile.domain}`,
          }))}
        />
      )}
      {carriedOver ? <p className="muted panel-help">{t.newScan.prefillNote}</p> : null}
      <section
        className={`configuration-status configuration-status--${configurationState}`}
        aria-live="polite"
      >
        <div className="configuration-status__header">
          <strong>{t.newScan.configurationTitle}</strong>
          <StatusChip
            status={
              configurationState === 'dirty'
                ? 'warning'
                : configurationState === 'saved'
                  ? 'Completed'
                  : 'info'
            }
            label={configurationStatusLabel}
          />
        </div>
        {configurationState === 'dirty' ? (
          <p>{t.newScan.configurationUnsavedBody}</p>
        ) : configurationState === 'new' ? (
          <p>{t.newScan.configurationNewBody}</p>
        ) : null}
      </section>
    </Panel>
  );
}

/** The plan, and the disclosures that come with it. */
function ScanDepthPanel(props: { form: NewScanForm; language: Language }) {
  const t = copy[props.language];
  const {
    checkoutConfig,
    checkoutPending,
    choosePlan,
    offeredOptInAiProviders,
    optInAiProviders,
    paidAvailable,
    paidScopeControls,
    plan,
    planOptions,
    toggleOptInAiProvider,
  } = props.form;
  return (
    <Panel title={t.newScan.panelDepth}>
      <SelectField
        label={t.newScan.labelScanPlan}
        name="scan-plan"
        autoComplete="off"
        value={plan}
        onChange={(value) => choosePlan(value as Plan)}
        options={planOptions}
      />
      {paidAvailable ? null : checkoutPending ? (
        <p className="muted">{t.newScan.paidChecking}</p>
      ) : (
        <p className="muted">{paidUnavailableCopy(t, checkoutConfig)}</p>
      )}
      {paidAvailable && checkoutConfig?.mode === 'test' ? (
        <p className="muted">{t.checkout.testMode}</p>
      ) : null}
      {paidScopeControls ? (
        <>
          {/* Open, unlike the JavaScript and robots.txt explanations folded
                under "For experienced users": this one and the performance
                disclosure below say what leaves the site and who processes it,
                and the buyer agrees to both by paying. Folding them would trade
                a guarantee for height. */}
          {/* The disclosure names the AI work THIS plan does. A plan without
              AI SEO / GEO sends no brand or domain to a provider for discovery
              or awareness questions, so it must not be shown a notice that says
              it does — and it is not AI-free either: its UX review still sends
              bounded page evidence. */}
          <ScanCallout
            eyebrow={PLAN_MODULES[plan].includes('AI SEO / GEO') ? 'AI SEO / GEO · UX' : 'UX'}
            title={t.newScan.aiConsentTitle}
            titleId="ai-consent-title"
            mode={t.newScan.aiConsentOptional}
            // The plain sentence first, the full disclosure under it and still
            // open: the paragraph is what the buyer agrees to by paying, so the
            // summary is added above it and nothing is folded away.
            lead={
              PLAN_MODULES[plan].includes('AI SEO / GEO')
                ? t.newScan.aiConsentSummary
                : t.newScan.aiConsentSummaryUxOnly
            }
            defaultOpen
          >
            {PLAN_MODULES[plan].includes('AI SEO / GEO')
              ? t.newScan.aiConsentBody
              : t.newScan.aiConsentBodyUxOnly}{' '}
            <a href={`/privacy?lang=${props.language}`}>{t.newScan.aiConsentPrivacy}</a>
            {' · '}
            <a href={`/terms?lang=${props.language}`}>{t.newScan.aiConsentTerms}</a>
          </ScanCallout>
          {/* Separate from the notice above, because it is a choice and that
              one is not. Both providers stay off until one of these is ticked,
              and the body names the recipient first.

              Rendered from the declared list rather than written out twice, and
              only for the recipients this deployment can actually send to: an
              offer it cannot keep would cost the buyer a Partial GEO module on
              a scan they paid for. A deployment with neither key shows no
              optional block at all.

              And only on a plan that runs AI SEO / GEO. These recipients exist
              to answer GEO's discovery and awareness questions; a plan that
              asks none of them would offer a choice with nothing behind it —
              directly under the notice that has just said no such question is
              sent. The request drops the same selections (new-scan-form.ts), so
              the offer and what is sent stay one answer. */}
          {offeredOptInAiProviders.length === 0 ||
          !PLAN_MODULES[plan].includes('AI SEO / GEO') ? null : (
            <>
              <ScanCallout
                eyebrow="AI SEO / GEO · OPTIONAL"
                title={t.newScan.aiConsentOptInTitle}
                titleId="ai-consent-opt-in-title"
                mode={t.newScan.aiConsentOptInMode}
                bodyId="ai-consent-opt-in-description"
                defaultOpen
              >
                {t.newScan.aiConsentOptInBody}
              </ScanCallout>
              {offeredOptInAiProviders.map((provider) => (
                <Checkbox
                  key={provider}
                  name={`scan-ai-opt-in-${provider}`}
                  label={t.newScan.aiConsentOptIn[provider]}
                  checked={optInAiProviders.includes(provider)}
                  describedBy="ai-consent-opt-in-description"
                  onChange={(checked) => toggleOptInAiProvider(provider, checked)}
                />
              ))}
            </>
          )}
          {PLAN_MODULES[plan].includes('Performance') ? (
            <ScanCallout
              eyebrow="PERFORMANCE · GOOGLE"
              title={t.newScan.performanceInfoTitle}
              titleId="performance-info-title"
              mode={t.newScan.performanceInfoMode}
              defaultOpen
            >
              {t.newScan.performanceInfoBody}
            </ScanCallout>
          ) : null}
        </>
      ) : null}
    </Panel>
  );
}

/** The right column: what is about to be bought, and the two buttons. */
function ScanLaunchColumn(props: {
  form: NewScanForm;
  language: Language;
  internalFreeAccess: boolean;
}) {
  const t = copy[props.language];
  const {
    canLaunch,
    canSave,
    checkoutConfig,
    egressBlocked,
    egressLocation,
    launchConfig,
    launchLabel,
    launchSite,
    paidScopeControls,
    plan,
    planLabel,
    resolveTargetProfileId,
    robotsOverrideStale,
    robotsUnconfirmed,
    saveConfiguration,
    savingConfiguration,
    scope,
    setSiteReachable,
    showsPurchaseTerms,
    target,
    updateScope,
    usingSavedProfile,
  } = props.form;
  const merchant = purchaseTermsMerchant(t, checkoutConfig);
  const c = newScanCopy[props.language];
  return (
    // Not an `aside`: a complementary landmark is content beside the page, and
    // this column carries the form's own submit.
    <div className="launch-form__launch">
      {/* The part that may scroll inside the pinned column, so the actions below
          it cannot be pushed off a short viewport. */}
      <div className="launch-form__review">
        <LaunchSummary
          language={props.language}
          site={launchSite}
          plan={plan}
          planLabel={planLabel}
          scope={scope}
          egressLocation={egressLocation}
          egressDirect={launchConfig.status === 'ready' && launchConfig.egress.mode === 'direct'}
        />
        {/* In the launch column, directly above the button it gates: this is
            the one thing on the form that can stop the purchase, and a buyer
            should meet it here rather than as a 409 after pressing pay. Free is
            not a purchase, so it is not gated. */}
        {plan === 'Free' || props.internalFreeAccess ? null : (
          <SiteReachabilityPanel
            language={props.language}
            profileId={usingSavedProfile ? target : null}
            egressLocationId={egressLocation?.id ?? null}
            resolveProfileId={resolveTargetProfileId}
            onResult={setSiteReachable}
          />
        )}
        {usingSavedProfile && (plan === 'WebsiteAudit' || plan === 'Complete') ? (
          <GoogleLaunchContext profileId={target} language={props.language} />
        ) : null}
        {showsPurchaseTerms ? (
          <p
            className="muted checkout-legal-note"
            role="note"
            aria-label={t.newScan.purchaseTermsLabel}
          >
            {t.newScan.purchaseTermsPrefix}{' '}
            <a href={`/terms?lang=${props.language}`}>{t.newScan.aiConsentTerms}</a>{' '}
            {t.newScan.purchaseTermsJoin}{' '}
            <a href={`/privacy?lang=${props.language}`}>{t.newScan.aiConsentPrivacy}</a>
            {' · '}
            <a href={`/cookies?lang=${props.language}`}>{t.legal.cookies.title}</a>
            {'.'}
            {merchant === null ? null : ` ${merchant}`}
          </p>
        ) : null}
      </div>
      {/* The buy button first, then the way to keep the settings without buying
          anything. They used to sit the other way round, with the secondary
          action spanning the full width under the primary one. */}
      <div className="launch-form__actions">
        <LaunchTarget form={props.form} language={props.language} />
        {/* Warning, the two ways out, the reason the button is held, then the
            button — one stack, in reading order. */}
        <RobotsConfirmation
          language={props.language}
          ignoresRobots={paidScopeControls && !scope.respectRobots}
          stale={robotsOverrideStale}
          confirmed={scope.robotsOverrideConfirmed}
          onChange={updateScope}
        />
        {robotsUnconfirmed ? (
          <p className="muted launch-form__blocked" id="launch-blocked" role="note">
            {robotsOverrideStale ? c.blockedByRobotsStale : c.blockedByRobots}
          </p>
        ) : egressBlocked ? (
          <p className="muted launch-form__blocked" id="launch-blocked" role="note">
            {t.newScan.blockedByEgress}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          {...(robotsUnconfirmed || egressBlocked ? { 'aria-describedby': 'launch-blocked' } : {})}
          disabled={!canLaunch}
        >
          {launchLabel}
        </Button>
        <Button type="button" disabled={!canSave} onClick={() => void saveConfiguration()}>
          {savingConfiguration ? t.newScan.savingConfiguration : t.newScan.saveConfiguration}
        </Button>
      </div>
    </div>
  );
}

/**
 * "Checking: Eva Grace, https://evagrace.example, plan Basic", directly above
 * the button. The owner arrived from one site's row; this is the last thing
 * they read before paying, so it names the site and the plan in words rather
 * than leaving them to the dropdown and the summary further up.
 */
function LaunchTarget(props: { form: NewScanForm; language: Language }) {
  const t = copy[props.language];
  const c = newScanCopy[props.language];
  const { plan, targetLabel, targetName } = props.form;
  return (
    <p className="launch-form__target" aria-live="polite">
      <strong>
        {targetName === null
          ? c.noSiteChosen
          : c.checking({ name: targetName, domain: targetLabel }, c.planNames[plan])}
      </strong>{' '}
      <span className="muted">{t.newScan.publicSiteOnly}</span>
    </p>
  );
}

/** A binding is optional, but the audit plans can use its real Google context. */
function GoogleLaunchContext(props: { profileId: string; language: Language }) {
  const [state, setState] = useState<'loading' | 'missing' | 'ready' | 'unavailable'>('loading');
  useEffect(() => {
    let active = true;
    setState('loading');
    void Promise.all([
      apiRequest<GoogleBinding | null>(
        `/profiles/${encodeURIComponent(props.profileId)}/google-binding`,
      ),
      apiRequest<readonly IntegrationStatus[]>('/integrations'),
    ])
      .then(([binding, integrations]) => {
        if (!active) return;
        const google = integrations.find((integration) => integration.provider === 'google');
        setState(
          google?.status === 'connected' &&
            binding !== null &&
            (binding.searchConsoleSiteUrl !== null || binding.ga4PropertyId !== null)
            ? 'ready'
            : 'missing',
        );
      })
      .catch(() => {
        if (active) setState('unavailable');
      });
    return () => {
      active = false;
    };
  }, [props.profileId]);
  return (
    <Panel
      title={props.language === 'uk' ? 'Дані Google (необов’язково)' : 'Google data (optional)'}
    >
      <p className="muted panel-help">
        {state === 'loading'
          ? props.language === 'uk'
            ? 'Перевіряємо підключені властивості Google…'
            : 'Checking connected Google properties…'
          : state === 'ready'
            ? props.language === 'uk'
              ? 'Search Console або GA4 підключено для цього профілю. Цей контекст буде додано до аудиту; PageSpeed від підключення не залежить.'
              : 'Search Console or GA4 is connected for this profile. That context will be included in the audit; PageSpeed is independent of this connection.'
            : state === 'missing'
              ? props.language === 'uk'
                ? 'Підключіть Search Console або GA4, щоб додати контекст Google до цього аудиту. PageSpeed цього не потребує.'
                : 'Connect Search Console or GA4 to add Google context to this audit. PageSpeed does not need a connection.'
              : props.language === 'uk'
                ? 'Не вдалося перевірити підключення Google. Аудит все одно може продовжитися.'
                : 'Google connection status is unavailable. The audit can still continue.'}
      </p>
      {state === 'missing' || state === 'unavailable' ? (
        <a className="button" href="/integrations">
          {props.language === 'uk' ? 'Відкрити інтеграції' : 'Open integrations'}
        </a>
      ) : null}
    </Panel>
  );
}
