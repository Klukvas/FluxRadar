import type { EgressLocation } from './api';
import { FieldRow } from './components';
import { egressLocationLabel } from './egress-location';
import { copy, type Language } from './i18n';
import { PLAN_MODULES, type Plan } from './plan-modules';
import type { ScanScopeForm } from './scan-scope';

/**
 * What the crawler will actually do, in the words of the settings around it.
 *
 * This used to be the "What will run" table in the launch column, and four
 * persona reviews named it the hardest part of the hardest screen: depth,
 * subdomains and URL parameters, read by a salon owner about to pay. The site,
 * the plan and the page count now live in the order summary in plain words
 * (`NewScanOrderSummary.tsx`); the technical rows live here, inside "For
 * advanced users", beside the controls that change them.
 *
 * Every "what does Free actually do" answer is resolved here rather than by the
 * caller. Splitting them left half the plan cascade in the screen and half in
 * this file, which is how a summary starts disagreeing with the form it claims
 * to describe.
 */
type NewScanCopy = (typeof copy)[Language]['newScan'];

/** What the AI row says for one plan: which AI work it buys, if any. */
function aiValue(plan: Plan, t: NewScanCopy): string {
  const modules = PLAN_MODULES[plan];
  if (modules.includes('AI SEO / GEO')) return t.launchSummaryEnabled;
  if (modules.includes('UX/Conversion')) return t.launchSummaryAiUxOnly;
  return t.launchSummaryDisabled;
}

export function LaunchSummary(props: {
  language: Language;
  plan: Plan;
  /** Names the rows for the heading the caller renders above them. */
  labelledBy: string;
  scope: ScanScopeForm;
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
  const robots = !ignoresRobots
    ? t.launchSummaryRespected
    : scope.robotsOverrideConfirmed
      ? t.launchSummaryOverridden
      : t.launchSummaryDisabled;
  return (
    <div className="launch-summary" role="group" aria-labelledby={props.labelledBy}>
      <FieldRow label={t.launchSummaryDepth} value={free ? '—' : scope.maxDepth.trim() || '—'} />
      <FieldRow
        label={t.launchSummarySubdomains}
        value={scope.includeSubdomains ? t.launchSummaryEnabled : t.launchSummaryDisabled}
      />
      {/* Ignoring robots.txt reads pages the site asked crawlers to skip, so
            it is never just one more row in the list — but its warning and the
            tick that answers it live together beside the button
            (RobotsConfirmation), not here, two screens above the control. */}
      <FieldRow label={t.launchSummaryRobots} value={robots} />
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
  );
}
