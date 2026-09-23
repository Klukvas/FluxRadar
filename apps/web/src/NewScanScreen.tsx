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
import type { CheckoutConfig, SiteProfile } from './api';
import { LaunchSummary } from './LaunchSummary';
import { ScanCallout } from './ScanCallout';
import { copy, type Language } from './i18n';
import {
  NEW_ADDRESS_TARGET,
  useNewScanForm,
  type NewScanForm,
  type NewScanFormProps,
} from './new-scan-form';
import type { Plan } from './plan-modules';
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
  return (
    <Window
      title={t.newScan.windowTitle}
      className="window--dialog window--launch"
      onClose={props.onClose}
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
    address,
    addressError,
    carriedOver,
    chooseTarget,
    configurationState,
    configurationStatusLabel,
    editAddress,
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
            thing being chosen. The last option is the way out of the list
            entirely: an address nobody has saved yet. */}
      {props.profiles.length === 0 ? (
        <p className="muted panel-help">{t.newScan.noProfilesLead}</p>
      ) : (
        <SelectField
          label={t.newScan.labelProfile}
          name="scan-profile"
          autoComplete="off"
          // The hint describes a saved profile, so it goes away with the
          // profile: the address field below states its own terms.
          {...(usingSavedProfile ? { hint: t.newScan.hintProfile } : {})}
          value={target}
          onChange={chooseTarget}
          options={[
            ...props.profiles.map((profile) => ({
              value: profile.id,
              label: `${profile.name} · ${profile.domain}`,
            })),
            { value: NEW_ADDRESS_TARGET, label: t.newScan.optionNewAddress },
          ]}
        />
      )}
      {usingSavedProfile ? null : (
        <Field
          label={t.newScan.labelAddress}
          name="scan-address"
          autoComplete="url"
          technical
          value={address}
          onChange={editAddress}
          placeholder={t.newScan.addressPlaceholder}
          hint={t.newScan.hintAddress}
          error={addressError ?? undefined}
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
          <ScanCallout
            eyebrow="AI SEO / GEO · UX"
            title={t.newScan.aiConsentTitle}
            titleId="ai-consent-title"
            mode={t.newScan.aiConsentOptional}
            defaultOpen
          >
            {t.newScan.aiConsentBody}{' '}
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
              optional block at all. */}
          {offeredOptInAiProviders.length === 0 ? null : (
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
          {plan === 'Complete' ? (
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
    launchLabel,
    launchSite,
    plan,
    planLabel,
    robotsUnconfirmed,
    saveConfiguration,
    savingConfiguration,
    scope,
    showsPurchaseTerms,
    targetLabel,
  } = props.form;
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
        />
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
            {t.newScan.purchaseTermsSuffix}
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
        ) : null}
        <Button
          type="submit"
          variant="primary"
          {...(robotsUnconfirmed ? { 'aria-describedby': 'launch-blocked' } : {})}
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
