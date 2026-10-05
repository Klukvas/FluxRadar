import { Checkbox, Field, SelectField, TextAreaField } from './components';
import { EgressLocationField } from './EgressLocationField';
import { ROBOTS_OVERRIDE_WARNING_ID } from './LaunchSummary';
import { ScanCallout } from './ScanCallout';
import { copy, type Language } from './i18n';
import { newScanCopy } from './new-scan-copy';
import type { NewScanForm } from './new-scan-form';
import { PLAN_URL_LIMIT } from './plan-modules';
import type { ScanScopeForm } from './scan-scope';

/**
 * The new-scan screen's folded crawl settings: the parts an owner rarely
 * needs, kept out of the way of the site, the plan and the button.
 *
 * Folding hides nothing from the request — the values live in the form state,
 * and a closed `<details>` keeps its controls in the form — and each block
 * opens by itself whenever a setting inside it differs from the default, so a
 * saved setting cannot change the scan out of sight (new-scan-form.ts).
 */

/** "For experienced users": subdomains, user agent, country, limits, JavaScript, robots.txt. */
export function ExpertSettings(props: { form: NewScanForm; language: Language }) {
  const t = copy[props.language];
  const c = newScanCopy[props.language];
  const { expertOpen, launchConfig, paidScopeControls, scope } = props.form;
  const { egressLocation, toggleExpert, updateScope } = props.form;
  return (
    <details
      className="scan-advanced scan-expert"
      open={expertOpen}
      onToggle={(event) => toggleExpert(event.currentTarget.open)}
    >
      <summary className="scan-advanced__summary scan-expert__summary">{c.expertTitle}</summary>
      <div className="scan-advanced__fields">
        <p className="muted panel-help">{c.expertLead}</p>
        {paidScopeControls ? (
          <div>
            <Checkbox
              name="scan-include-subdomains"
              label={t.newScan.labelSubdomains}
              checked={scope.includeSubdomains}
              onChange={(checked) => updateScope({ includeSubdomains: checked })}
            />
            <p className="muted panel-help">{c.hints.subdomains}</p>
          </div>
        ) : null}
        <SelectField
          label={t.newScan.labelUserAgent}
          name="scan-user-agent"
          autoComplete="off"
          hint={c.hints.userAgent}
          value={scope.userAgent}
          onChange={(value) => updateScope({ userAgent: value as ScanScopeForm['userAgent'] })}
          options={[
            { value: 'desktop', label: t.newScan.userAgentDesktop },
            { value: 'mobile', label: t.newScan.userAgentMobile },
          ]}
        />
        {/* Free does not choose a country: it leaves from the default one, which
            the launch summary names (D-228). The picker carries its own hint. */}
        {paidScopeControls ? (
          <EgressLocationField
            language={props.language}
            config={launchConfig}
            selected={egressLocation}
            onChange={(value) => updateScope({ egressLocation: value })}
          />
        ) : null}
        {paidScopeControls ? (
          <>
            <CrawlLimits form={props.form} language={props.language} />
            <RenderAndRobots form={props.form} language={props.language} />
          </>
        ) : null}
      </div>
    </details>
  );
}

/** The two limits a paid plan sells: how many pages, and how deep. */
function CrawlLimits(props: { form: NewScanForm; language: Language }) {
  const t = copy[props.language];
  const c = newScanCopy[props.language];
  const { invalidScope, plan, scope, updateScope } = props.form;
  return (
    <>
      <Field
        label={t.newScan.labelMaxPages}
        name="scan-max-pages"
        autoComplete="off"
        technical
        hint={c.hints.maxPages}
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
        hint={c.hints.maxDepth}
        value={scope.maxDepth}
        onChange={(value) => updateScope({ maxDepth: value })}
        type="number"
        error={invalidScope.includes('maxDepth') ? t.newScan.maxDepthError : undefined}
      />
    </>
  );
}

/** JavaScript rendering and robots.txt, each with its folded explanation. */
function RenderAndRobots(props: { form: NewScanForm; language: Language }) {
  const t = copy[props.language];
  const c = newScanCopy[props.language];
  const { robotsOverrideStale, scope, updateScope } = props.form;
  // While a saved override waits to be confirmed again, the box is also read
  // with the summary's warning and with the reason the button is held — the
  // two say why it is unticked. Otherwise it keeps the one description
  // free-scan-controls.test.tsx pins.
  const overrideDescribedBy = robotsOverrideStale
    ? `robots-info-description ${ROBOTS_OVERRIDE_WARNING_ID} launch-blocked`
    : 'robots-info-description';
  return (
    <>
      {/* Rendering is a real browser per scan, so it is a decision, not a
          default — and a deployment without the runtime says so in the report
          rather than reading the static HTML as if the scripts had run. */}
      <ScanCallout
        eyebrow="JAVASCRIPT"
        title={t.newScan.renderInfoTitle}
        titleId="render-info-title"
        mode={t.newScan.renderInfoMode}
        bodyId="render-info-description"
      >
        {t.newScan.renderInfoBody}
      </ScanCallout>
      <div>
        <Checkbox
          name="scan-render-js"
          label={t.newScan.labelRenderJs}
          checked={scope.renderJs}
          describedBy="render-info-description"
          onChange={(checked) => updateScope({ renderJs: checked })}
        />
        <p className="muted panel-help">{c.hints.renderJs}</p>
      </div>
      <ScanCallout
        eyebrow="robots.txt"
        title={t.newScan.robotsInfoTitle}
        titleId="robots-info-title"
        mode={t.newScan.robotsInfoMode}
        bodyId="robots-info-description"
      >
        {t.newScan.robotsInfoBody}
      </ScanCallout>
      <div>
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
        <p className="muted panel-help">{c.hints.robots}</p>
      </div>
      {/* Ticked only by a confirmation given on this screen: a saved profile's
          is never restored (scopeFormFromProfileConfig). */}
      {scope.respectRobots ? null : (
        <Checkbox
          label={t.newScan.labelRobotsOverride}
          name="scan-robots-override"
          checked={scope.robotsOverrideConfirmed}
          describedBy={overrideDescribedBy}
          onChange={(checked) => updateScope({ robotsOverrideConfirmed: checked })}
        />
      )}
    </>
  );
}

/**
 * Path patterns, the query policy, start URLs and API checks: they shape which
 * URLs the crawler takes, and most scans ship with the defaults.
 */
export function AdvancedCrawlRules(props: { form: NewScanForm; language: Language }) {
  const t = copy[props.language];
  const { advancedOpen, apiCheckProblems, invalidSeedUrls, scope, toggleAdvanced, updateScope } =
    props.form;
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
          onChange={(value) => updateScope({ queryPolicy: value as ScanScopeForm['queryPolicy'] })}
          options={[
            { value: 'ignore', label: t.newScan.queryIgnore },
            { value: 'include', label: t.newScan.queryInclude },
          ]}
        />
        {/* Pages discovery would not reach: a page nothing links to, or the
            handful that actually matter on a large site. They are crawled under
            the same scope, robots and page limit as anything else. */}
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
            expected statuses are what tells an endpoint that is meant to answer
            404 from one that has broken. */}
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
  );
}
