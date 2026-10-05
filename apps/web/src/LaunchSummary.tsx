import type { EgressLocation } from './api';
import { FieldRow, Panel } from './components';
import { egressLocationLabel } from './egress-location';
import { copy, type Language } from './i18n';
import { newScanCopy } from './new-scan-copy';
import { PLAN_MODULES, PLAN_URL_LIMIT, type Plan } from './plan-modules';
import type { ScanScopeForm } from './scan-scope';

/**
 * What this scan will actually do, in the words of the settings above it.
 *
 * It repeats the form on purpose: the owner is about to pay for one run of one
 * configuration, and the last thing they read before the button should be the
 * configuration, not a field they have to scroll back to. On a wide screen it
 * sits in the sticky launch column beside the controls, so the repetition costs
 * no height and updates as the fields change.
 *
 * Every "what does Free actually do" answer is resolved here rather than by the
 * caller. Splitting them left half the plan cascade in the screen and half in
 * this file, which is how a summary starts disagreeing with the form it claims
 * to describe.
 */
type NewScanCopy = (typeof copy)[Language]['newScan'];

/** The summary's robots.txt warning, which the override checkbox points at. */
export const ROBOTS_OVERRIDE_WARNING_ID = 'robots-override-warning';

/** What the AI row says for one plan: which AI work it buys, if any. */
function aiValue(plan: Plan, t: NewScanCopy): string {
  const modules = PLAN_MODULES[plan];
  if (modules.includes('AI SEO / GEO')) return t.launchSummaryEnabled;
  if (modules.includes('UX/Conversion')) return t.launchSummaryAiUxOnly;
  return t.launchSummaryDisabled;
}

export function LaunchSummary(props: {
  language: Language;
  /** The domain saved on the selected profile. */
  site: string;
  plan: Plan;
  /** The plan as the plan picker spells it, prices and all. */
  planLabel: string;
  scope: ScanScopeForm;
  /**
   * True while the saved profile carries a robots.txt override that has not
   * been confirmed again on this screen (the form never restores it).
   */
  robotsOverrideStale?: boolean;
  /** Where this launch will leave from, or null while nothing is on offer. */
  egressLocation: EgressLocation | null;
  /** A deployment without egress locations: there is no country to name. */
  egressDirect: boolean;
}) {
  const t = copy[props.language].newScan;
  const { scope } = props;
  // Free is the fixed homepage check: the crawl settings do not reach it, so
  // the summary reports what the crawler will do rather than what the form
  // happens to be holding (apps/api/src/orchestrator/run-attempt.ts enforces
  // the same thing whatever the request says).
  const free = props.plan === 'Free';
  const ignoresRobots = !free && !scope.respectRobots;
  const robotsStale = ignoresRobots && props.robotsOverrideStale === true;
  const robots = !ignoresRobots
    ? t.launchSummaryRespected
    : scope.robotsOverrideConfirmed
      ? t.launchSummaryOverridden
      : t.launchSummaryDisabled;
  const clarity = newScanCopy[props.language];
  return (
    <Panel title={t.launchSummaryTitle}>
      <div className="launch-summary">
        <FieldRow label={t.launchSummarySite} value={props.site} technical />
        <FieldRow label={t.launchSummaryPlan} value={props.planLabel} />
        <FieldRow
          label={t.launchSummaryPages}
          value={
            free
              ? t.launchSummaryHomepage
              : scope.maxPages.trim() || t.planPageLimit(PLAN_URL_LIMIT[props.plan])
          }
        />
        <FieldRow label={t.launchSummaryDepth} value={free ? '—' : scope.maxDepth.trim() || '—'} />
        <FieldRow
          label={t.launchSummarySubdomains}
          value={scope.includeSubdomains ? t.launchSummaryEnabled : t.launchSummaryDisabled}
        />
        <FieldRow label={t.launchSummaryRobots} value={robots} />
        {/* Ignoring robots.txt reads pages the site asked crawlers to skip, so
            it is never just one more row in the list. */}
        {ignoresRobots ? (
          <p className="launch-warning" id={ROBOTS_OVERRIDE_WARNING_ID} role="note">
            {clarity.robotsWarning}
            {robotsStale ? ` ${clarity.robotsWarningStale}` : null}
          </p>
        ) : null}
        <FieldRow
          label={t.launchSummaryQueries}
          value={
            !free && scope.queryPolicy === 'include'
              ? t.launchSummaryIncluded
              : t.launchSummaryIgnored
          }
        />
        <FieldRow
          label={t.launchSummaryUserAgent}
          value={scope.userAgent === 'desktop' ? t.userAgentDesktop : t.userAgentMobile}
        />
        {props.egressDirect ? null : (
          <FieldRow
            label={t.launchSummaryEgress}
            value={
              props.egressLocation === null
                ? '—'
                : free
                  ? `${egressLocationLabel(props.egressLocation, props.language)} · ${t.launchSummaryEgressDefault}`
                  : egressLocationLabel(props.egressLocation, props.language)
            }
          />
        )}
        {/* What this plan actually asks a provider, not "AI: on". Website Audit
            runs no AI SEO / GEO at all, so calling its AI visibility "enabled"
            would promise a section the report will not contain — while its UX
            review does send evidence to Anthropic, so "off" would be just as
            wrong. Each plan says its own truth. */}
        <FieldRow label={t.launchSummaryAi} value={aiValue(props.plan, t)} />
        {PLAN_MODULES[props.plan].includes('Performance') ? (
          <FieldRow label={t.launchSummaryPerformance} value={t.launchSummaryPerformanceValue} />
        ) : null}
      </div>
    </Panel>
  );
}
