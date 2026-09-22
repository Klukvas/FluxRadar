import type { CheckoutConfig } from './api';
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
import { EgressLocationField } from './EgressLocationField';
import { copy, type Language } from './i18n';
import { LaunchSummary } from './LaunchSummary';
import { NEW_ADDRESS_TARGET, useNewScanForm, type NewScanFormProps } from './new-scan-form';
import { ScanCallout } from './ScanCallout';
import { clampScopeToPlan, invalidScopeFields, type ScanScopeForm } from './scan-scope';
import { SiteReachabilityPanel } from './SiteReachability';

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

export function NewScanScreen(props: NewScanFormProps) {
  const t = copy[props.language];
  // The form's state, its saved-configuration sync and its submission live in
  // new-scan-form.ts. Destructured rather than read off an object, so what this
  // screen renders reads the same as when the two were one function.
  const {
    address,
    addressError,
    advancedOpen,
    aiIndustry,
    aiOfferings,
    busy,
    carriedOver,
    checkoutConfig,
    checkoutPending,
    configurationState,
    configurationStatusLabel,
    egressBlocked,
    egressLocation,
    invalidScope,
    launchConfig,
    launchSite,
    paidAvailable,
    paidScopeControls,
    plan,
    planLabel,
    planOptions,
    robotsUnconfirmed,
    resolveTargetProfileId,
    saveConfiguration,
    savingConfiguration,
    scope,
    setAddress,
    setAddressError,
    setAdvancedChoice,
    setAiIndustry,
    setAiOfferings,
    setInvalidScope,
    setSiteReachable,
    setPlan,
    setScope,
    setTarget,
    siteReachable,
    submit,
    target,
    targetLabel,
    unavailablePlanFallback,
    updateScope,
    usingSavedProfile,
  } = useNewScanForm(props);
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
      <form className="launch-form" onSubmit={submit}>
        <div className="launch-form__controls">
          <Panel title={t.newScan.panelTarget}>
            {/* The field picks a saved profile, so it is named after what it
                picks. The public-site semantics the old "Public origin" label
                carried live in the hint, where they describe the scan rather than
                renaming the thing being chosen. The last option is the way out of
                the list entirely: an address nobody has saved yet. */}
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
                onChange={setTarget}
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
                onChange={(value) => {
                  setAddress(value);
                  if (addressError !== null) setAddressError(null);
                }}
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
            {/* Free does not choose a country: it leaves from the default one,
                which the launch summary names. */}
            {paidScopeControls ? (
              <EgressLocationField
                language={props.language}
                config={launchConfig}
                selected={egressLocation}
                onChange={(value) => updateScope({ egressLocation: value })}
              />
            ) : null}
          </Panel>
          <Panel title={t.newScan.panelDepth}>
            <SelectField
              label={t.newScan.labelScanPlan}
              name="scan-plan"
              autoComplete="off"
              value={plan}
              onChange={(value) => {
                const chosen = value as typeof plan;
                setPlan(chosen);
                // A site last checked on Complete opens on Complete-sized limits;
                // carrying those into Basic asks for more pages than Basic sells,
                // which the API refuses. The numbers move to the chosen plan here,
                // where the owner can see what they are about to buy.
                setScope((current) => clampScopeToPlan(current, chosen));
                setInvalidScope([]);
              }}
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
                {/* Path patterns and the query policy shape which URLs the
                    crawler takes, and most scans ship with the defaults. They
                    stay behind a disclosure so the plan and its two limits —
                    the numbers being bought — are what the panel opens on. */}
                <details
                  className="scan-advanced"
                  open={advancedOpen}
                  onToggle={(event) => setAdvancedChoice(event.currentTarget.open)}
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
                  </div>
                </details>
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
                {/* Open, unlike the robots.txt explanation above it: this one
                    and the performance disclosure below say what leaves the
                    site and who processes it, and the buyer agrees to both by
                    paying. Folding them would trade a guarantee for height. */}
                <ScanCallout
                  eyebrow="AI SEO / GEO · UX"
                  title={t.newScan.aiConsentTitle}
                  titleId="ai-consent-title"
                  mode={t.newScan.aiConsentOptional}
                  bodyId="ai-consent-description"
                  defaultOpen
                >
                  {t.newScan.aiConsentBody}{' '}
                  <a href={`/privacy?lang=${props.language}`}>{t.newScan.aiConsentPrivacy}</a>
                  {' · '}
                  <a href={`/terms?lang=${props.language}`}>{t.newScan.aiConsentTerms}</a>
                </ScanCallout>
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
          {/* What Free actually is, in place of the controls it does not have.
              The two rows are the enforced settings, not suggestions: the crawler
              reads the homepage and obeys robots.txt on this plan whatever the
              request says. */}
          {paidScopeControls ? null : (
            <Panel title={t.newScan.freeScopeTitle}>
              <p className="muted panel-help">{t.newScan.freeScopeNote}</p>
              <FieldRow label={t.newScan.freeScopePages} value={t.newScan.freeScopePagesValue} />
              <FieldRow label={t.newScan.freeScopeRobots} value={t.newScan.freeScopeRobotsValue} />
              <p className="muted panel-help">{t.newScan.freeScopeLocked}</p>
            </Panel>
          )}
          {/* What the AI visibility section needs before it can ask anything
              neutral. Without either field `neutralContext` has no topic, the
              discovery questions are never generated, and the section falls
              back to two questions that name the brand — which measure nothing.
              The fields are optional; what is not optional is saying so first.
              With the settings rather than in the launch column: these are
              inputs the owner fills, not a summary of what they chose. */}
          {plan === 'Free' ? null : (
            <Panel title={t.newScan.aiContextTitle}>
              <p className="muted panel-help">
                {/* Either field is enough for `neutralContext` to build a topic,
                    so the warning is only true when both are empty. */}
                {aiIndustry.trim() === '' && aiOfferings.trim() === ''
                  ? t.newScan.aiContextMissing
                  : t.newScan.aiContextHelp}
              </p>
              <Field
                label={t.workspace.businessType}
                name="scan-ai-industry"
                autoComplete="off"
                value={aiIndustry}
                onChange={setAiIndustry}
                placeholder={t.workspace.businessTypePlaceholder}
                hint={t.workspace.businessTypeHint}
              />
              <TextAreaField
                label={t.workspace.offerings}
                name="scan-ai-offerings"
                autoComplete="off"
                value={aiOfferings}
                onChange={setAiOfferings}
                placeholder={t.workspace.offeringsPlaceholder}
                hint={t.workspace.offeringsHint}
              />
            </Panel>
          )}
        </div>
        {/* Not an `aside`: a complementary landmark is content beside the page,
            and this column carries the form's own submit. */}
        <div className="launch-form__launch">
          {/* The part that may scroll inside the pinned column, so the actions
              below it cannot be pushed off a short viewport. */}
          <div className="launch-form__review">
            <LaunchSummary
              language={props.language}
              site={launchSite}
              plan={plan}
              planLabel={planLabel}
              scope={scope}
              egressLocation={egressLocation}
              egressDirect={
                launchConfig.status === 'ready' && launchConfig.egress.mode === 'direct'
              }
            />
            {/* In the launch column, directly above the button it gates: this
                is the one thing on the form that can stop the purchase, and a
                buyer should meet it here rather than as a 409 after pressing
                pay. Free is not a purchase, so it is not gated. */}
            {plan === 'Free' || props.internalFreeAccess ? null : (
              <SiteReachabilityPanel
                language={props.language}
                profileId={usingSavedProfile ? target : null}
                egressLocationId={egressLocation?.id ?? null}
                resolveProfileId={resolveTargetProfileId}
                onResult={setSiteReachable}
              />
            )}
            {plan === 'Free' || props.internalFreeAccess ? null : (
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
            )}
          </div>
          {/* The buy button first, then the way to keep the settings without
              buying anything. They used to sit the other way round, with the
              secondary action spanning the full width under the primary one. */}
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
              {...(robotsUnconfirmed || egressBlocked
                ? { 'aria-describedby': 'launch-blocked' }
                : {})}
              disabled={
                busy ||
                savingConfiguration ||
                (usingSavedProfile ? target === '' : address.trim() === '') ||
                robotsUnconfirmed ||
                egressBlocked ||
                // A paid scan of a site the crawler cannot read is a refund
                // waiting to happen, and the server refuses to sell it.
                (plan !== 'Free' && !props.internalFreeAccess && !siteReachable)
              }
            >
              {busy
                ? plan !== 'Free' && !props.internalFreeAccess
                  ? t.newScan.openingCheckout
                  : t.newScan.creating
                : plan === 'Free'
                  ? t.newScan.runFree
                  : props.internalFreeAccess
                    ? t.newScan.runInternal
                    : t.newScan.runPaid}
            </Button>
            <Button
              type="button"
              disabled={
                unavailablePlanFallback ||
                busy ||
                savingConfiguration ||
                (usingSavedProfile ? target === '' : address.trim() === '') ||
                invalidScopeFields(scope, plan).length > 0 ||
                robotsUnconfirmed
              }
              onClick={() => void saveConfiguration()}
            >
              {savingConfiguration ? t.newScan.savingConfiguration : t.newScan.saveConfiguration}
            </Button>
          </div>
        </div>
      </form>
    </Window>
  );
}
