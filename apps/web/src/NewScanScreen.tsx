import { useEffect, useRef, useState } from 'react';

import {
  Button,
  Checkbox,
  Field,
  FieldRow,
  Panel,
  SelectField,
  StatusChip,
  TextAreaField,
  Window,
} from './components';
import {
  apiRequest,
  type CheckoutConfig,
  type GoogleBinding,
  type IntegrationStatus,
  type SiteProfile,
} from './api';
import { EgressLocationField } from './EgressLocationField';
import { SiteReachabilityPanel } from './SiteReachability';
import { LaunchSummary } from './LaunchSummary';
import { ScanCallout } from './ScanCallout';
import { copy, type Language } from './i18n';
import { useNewScanForm, type NewScanForm, type NewScanFormProps } from './new-scan-form';
import { PLAN_MODULES, PLAN_URL_LIMIT, type Plan } from './plan-modules';
import type { ScanScopeForm } from './scan-scope';

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

/** The left column: which site, on which plan, and how far the crawl goes. */
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
    egressLocation,
    launchConfig,
    paidScopeControls,
    scope,
    target,
    updateScope,
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
      {paidScopeControls ? (
        <Checkbox
          name="scan-include-subdomains"
          label={t.newScan.labelSubdomains}
          checked={scope.includeSubdomains}
          onChange={(checked) => updateScope({ includeSubdomains: checked })}
        />
      ) : null}
      <SelectField
        label={t.newScan.labelUserAgent}
        name="scan-user-agent"
        autoComplete="off"
        value={scope.userAgent}
        onChange={(value) => updateScope({ userAgent: value as ScanScopeForm['userAgent'] })}
        options={[
          { value: 'desktop', label: t.newScan.userAgentDesktop },
          { value: 'mobile', label: t.newScan.userAgentMobile },
        ]}
      />
      {/* Free does not choose a country: it leaves from the default one, which
          the launch summary names (D-228). */}
      {paidScopeControls ? (
        <EgressLocationField
          language={props.language}
          config={launchConfig}
          selected={egressLocation}
          onChange={(value) => updateScope({ egressLocation: value })}
        />
      ) : null}
    </Panel>
  );
}

/** The plan, the two limits it sells, and the disclosures that come with it. */
function ScanDepthPanel(props: { form: NewScanForm; language: Language }) {
  const t = copy[props.language];
  const {
    advancedOpen,
    apiCheckProblems,
    checkoutConfig,
    checkoutPending,
    choosePlan,
    invalidScope,
    invalidSeedUrls,
    offeredOptInAiProviders,
    optInAiProviders,
    paidAvailable,
    paidScopeControls,
    plan,
    planOptions,
    scope,
    toggleAdvanced,
    toggleOptInAiProvider,
    updateScope,
  } = props.form;
  // Both lists name the offending lines rather than only saying "invalid": on a
  // twenty-line paste, "which one" is the whole question.
  const seedUrlsError =
    invalidSeedUrls.length === 0
      ? undefined
      : `${t.newScan.seedUrlsError} (${invalidSeedUrls.slice(0, 3).join(', ')})`;
  const apiChecksError =
    apiCheckProblems.length === 0
      ? undefined
      : `${t.newScan.apiChecksError} (${apiCheckProblems
          .slice(0, 3)
          .map((problem) => `${problem.line}`)
          .join(', ')})`;
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
          <Field
            label={t.newScan.labelMaxPages}
            name="scan-max-pages"
            autoComplete="off"
            technical
            value={scope.maxPages}
            onChange={(value) => updateScope({ maxPages: value })}
            type="number"
            error={invalidScope.includes('maxPages') ? t.newScan.maxPagesError : undefined}
          />
          <p className="muted panel-help">
            {scope.maxPages.trim() === ''
              ? t.newScan.planPageLimit(PLAN_URL_LIMIT[plan])
              : t.newScan.ownerPageLimit(scope.maxPages)}
          </p>
          <Field
            label={t.newScan.labelMaxDepth}
            name="scan-max-depth"
            autoComplete="off"
            technical
            value={scope.maxDepth}
            onChange={(value) => updateScope({ maxDepth: value })}
            type="number"
            error={invalidScope.includes('maxDepth') ? t.newScan.maxDepthError : undefined}
          />
          <p className="muted panel-help">
            {props.language === 'uk'
              ? '0 — лише головна сторінка; порожнє поле — без обмеження глибини.'
              : '0 = homepage only; leave blank for unlimited depth.'}
          </p>
          {/* Path patterns and the query policy shape which URLs the crawler
                takes, and most scans ship with the defaults. They stay behind a
                disclosure so the plan and its two limits — the numbers being
                bought — are what the panel opens on. */}
          <details
            className="scan-advanced"
            open={advancedOpen}
            onToggle={(event) => toggleAdvanced(event.currentTarget.open)}
          >
            <summary className="scan-advanced__summary">{t.newScan.advancedTitle}</summary>
            <div className="scan-advanced__fields">
              <Field
                label={t.newScan.labelIncludePatterns}
                name="scan-include-patterns"
                autoComplete="off"
                technical
                value={scope.includePatterns}
                onChange={(value) => updateScope({ includePatterns: value })}
                placeholder="/docs/*, /blog/*"
              />
              <Field
                label={t.newScan.labelExcludePatterns}
                name="scan-exclude-patterns"
                autoComplete="off"
                technical
                value={scope.excludePatterns}
                onChange={(value) => updateScope({ excludePatterns: value })}
                placeholder="/admin/*, /private/*"
              />
              <SelectField
                label={t.newScan.labelQueryPolicy}
                name="scan-query-policy"
                autoComplete="off"
                value={scope.queryPolicy}
                onChange={(value) =>
                  updateScope({ queryPolicy: value as ScanScopeForm['queryPolicy'] })
                }
                options={[
                  { value: 'ignore', label: t.newScan.queryIgnore },
                  { value: 'include', label: t.newScan.queryInclude },
                ]}
              />
              {/* Pages discovery would not reach: a page nothing links to, or
                  the handful that actually matter on a large site. They are
                  crawled under the same scope, robots and page limit as
                  anything else. */}
              <TextAreaField
                label={t.newScan.labelSeedUrls}
                name="scan-seed-urls"
                autoComplete="off"
                rows={3}
                value={scope.seedUrls}
                onChange={(value) => updateScope({ seedUrls: value })}
                placeholder={`https://example.com/pricing\nhttps://example.com/docs/start`}
                hint={t.newScan.seedUrlsHint}
                error={seedUrlsError}
              />
              {/* Public endpoints, read with GET or HEAD and nothing else. The
                  expected statuses are what tells an endpoint that is meant to
                  answer 404 from one that has broken. */}
              <TextAreaField
                label={t.newScan.labelApiChecks}
                name="scan-api-checks"
                autoComplete="off"
                rows={3}
                value={scope.apiChecks}
                onChange={(value) => updateScope({ apiChecks: value })}
                placeholder={`GET https://example.com/api/health 200\nHEAD https://example.com/api/feed`}
                hint={t.newScan.apiChecksHint}
                error={apiChecksError}
              />
            </div>
          </details>
          {/* Rendering is a real browser per scan, so it is a decision, not a
              default — and a deployment without the runtime says so in the
              report rather than reading the static HTML as if the scripts had
              run. */}
          <ScanCallout
            eyebrow="JAVASCRIPT"
            title={t.newScan.renderInfoTitle}
            titleId="render-info-title"
            mode={t.newScan.renderInfoMode}
            bodyId="render-info-description"
          >
            {t.newScan.renderInfoBody}
          </ScanCallout>
          <Checkbox
            name="scan-render-js"
            label={t.newScan.labelRenderJs}
            checked={scope.renderJs}
            describedBy="render-info-description"
            onChange={(checked) => updateScope({ renderJs: checked })}
          />
          <ScanCallout
            eyebrow="robots.txt"
            title={t.newScan.robotsInfoTitle}
            titleId="robots-info-title"
            mode={t.newScan.robotsInfoMode}
            bodyId="robots-info-description"
          >
            {t.newScan.robotsInfoBody}
          </ScanCallout>
          <Checkbox
            name="scan-respect-robots"
            label={t.newScan.labelRespectRobots}
            checked={scope.respectRobots}
            describedBy="robots-info-description"
            onChange={(checked) =>
              updateScope({
                respectRobots: checked,
                // Turning the rule back on withdraws the override with it.
                ...(checked ? { robotsOverrideConfirmed: false } : {}),
              })
            }
          />
          {scope.respectRobots ? null : (
            <Checkbox
              label={t.newScan.labelRobotsOverride}
              name="scan-robots-override"
              checked={scope.robotsOverrideConfirmed}
              describedBy="robots-info-description"
              onChange={(checked) => updateScope({ robotsOverrideConfirmed: checked })}
            />
          )}
          {/* Open, unlike the robots.txt explanation above it: this one and
                the performance disclosure below say what leaves the site and who
                processes it, and the buyer agrees to both by paying. Folding
                them would trade a guarantee for height. */}
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
    plan,
    planLabel,
    resolveTargetProfileId,
    robotsUnconfirmed,
    saveConfiguration,
    savingConfiguration,
    scope,
    setSiteReachable,
    showsPurchaseTerms,
    target,
    targetLabel,
    usingSavedProfile,
  } = props.form;
  const merchant = purchaseTermsMerchant(t, checkoutConfig);
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
        <span className="muted">
          {targetLabel} {t.newScan.publicSiteOnly}
        </span>
        {robotsUnconfirmed ? (
          <p className="muted launch-form__blocked" id="launch-blocked" role="note">
            {t.newScan.blockedByRobots}
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
