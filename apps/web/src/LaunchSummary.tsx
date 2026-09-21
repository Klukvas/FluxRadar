import { FieldRow, Panel } from './components';
import { copy, type Language } from './i18n';
import type { Plan } from './plan-modules';
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
export function LaunchSummary(props: {
  language: Language;
  /** The address as the form resolved it — a profile domain or a typed site. */
  site: string;
  plan: Plan;
  /** The plan as the plan picker spells it, prices and all. */
  planLabel: string;
  scope: ScanScopeForm;
}) {
  const t = copy[props.language].newScan;
  const { scope } = props;
  // Free is the fixed homepage check: the crawl settings do not reach it, so
  // the summary reports what the crawler will do rather than what the form
  // happens to be holding (apps/api/src/orchestrator/run-attempt.ts enforces
  // the same thing whatever the request says).
  const free = props.plan === 'Free';
  const robots =
    free || scope.respectRobots
      ? t.launchSummaryRespected
      : scope.robotsOverrideConfirmed
        ? t.launchSummaryOverridden
        : t.launchSummaryDisabled;
  return (
    <Panel title={t.launchSummaryTitle}>
      <div className="launch-summary">
        <FieldRow label={t.launchSummarySite} value={props.site} technical />
        <FieldRow label={t.launchSummaryPlan} value={props.planLabel} />
        <FieldRow
          label={t.launchSummaryPages}
          value={free ? t.launchSummaryHomepage : scope.maxPages.trim() || '—'}
        />
        <FieldRow label={t.launchSummaryDepth} value={free ? '—' : scope.maxDepth.trim() || '—'} />
        <FieldRow
          label={t.launchSummarySubdomains}
          value={scope.includeSubdomains ? t.launchSummaryEnabled : t.launchSummaryDisabled}
        />
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
        <FieldRow
          label={t.launchSummaryAi}
          value={free ? t.launchSummaryDisabled : t.launchSummaryEnabled}
        />
        {props.plan === 'Complete' ? (
          <FieldRow label={t.launchSummaryPerformance} value={t.launchSummaryPerformanceValue} />
        ) : null}
      </div>
    </Panel>
  );
}
