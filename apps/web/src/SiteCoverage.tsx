// How much of the site this report is actually about.
//
// Every other coverage figure on the report is module coverage — checks
// completed over checks applicable — and that number cannot see the crawl. A
// scan that read fifteen pages of a 334-page site closed every check it had a
// page for, so every section said 100%, and the report told the owner of a
// $120 audit that it had covered their whole site.
//
// This panel is the other question, and it is the one the buyer thinks they are
// reading: of the addresses we found, how many did we read? When the answer is
// "not all of them" it says whose limit stopped the crawl, because an owner who
// typed 15 into the settings and an owner who bought a plan that ran out need
// opposite things from us.

import type { CrawlSummary } from './api';
import { Panel, ProgressBar } from './components';
import { copy, fillCopy, type Language } from './i18n';

export function SiteCoveragePanel(props: {
  readonly summary: CrawlSummary | null | undefined;
  readonly language: Language;
}) {
  const t = copy[props.language].report;
  const summary = props.summary;
  // A scan from before the crawl was recorded has no honest number to show, and
  // an invented one is the whole problem this panel exists to fix.
  if (summary === null || summary === undefined) return null;

  return (
    <Panel title={t.siteCoverageTitle}>
      <SiteCoverageBody summary={summary} language={props.language} />
    </Panel>
  );
}

function SiteCoverageBody(props: { summary: CrawlSummary; language: Language }) {
  const t = copy[props.language].report;
  const { summary } = props;

  if (summary.reach !== 'reachable') {
    return (
      <p className="muted" role="status">
        {t.siteCoverageUnread}
      </p>
    );
  }
  if (summary.urlsDiscovered === 0) {
    // Reachable with nothing found is possible — a one-page site whose only
    // address failed after the fact. There is no share of zero to draw.
    return <p className="muted">{t.siteCoverageNoAddresses}</p>;
  }

  const percent = Math.round((summary.pagesRead / summary.urlsDiscovered) * 100);
  const complete = summary.pagesRead === summary.urlsDiscovered;
  return (
    <>
      <p>
        {fillCopy(t.siteCoverageRead, {
          read: String(summary.pagesRead),
          found: String(summary.urlsDiscovered),
        })}
      </p>
      <ProgressBar
        variant="result"
        caption={t.siteCoverageCaption}
        // Rounded for the bar only. `complete` is decided on the counts, so a
        // crawl one address short of the whole site can never round up to a
        // sentence saying it read everything.
        value={percent}
        label={t.siteCoverageCaption}
      />
      {complete ? (
        <p className="muted">{t.siteCoverageComplete}</p>
      ) : (
        <p className="muted" role="status">
          {limitExplanation(summary, props.language)}
        </p>
      )}
      {summary.urlsBlockedByRobots > 0 ? (
        <p className="muted">
          {fillCopy(t.siteCoverageRobots, { count: String(summary.urlsBlockedByRobots) })}
        </p>
      ) : null}
    </>
  );
}

/**
 * Why the crawl stopped short, in the words that match who can change it.
 *
 * `owner` is the settings this account chose; `plan` is the tariff ceiling.
 * Anything else means addresses were found and not read for a reason the crawl
 * did not attribute — said plainly rather than guessed at.
 */
function limitExplanation(summary: CrawlSummary, language: Language): string {
  const t = copy[language].report;
  if (summary.limitedBy === 'owner') {
    return fillCopy(t.siteCoverageLimitedByOwner, { limit: String(summary.maxPages) });
  }
  if (summary.limitedBy === 'plan') {
    return fillCopy(t.siteCoverageLimitedByPlan, { limit: String(summary.maxPages) });
  }
  return t.siteCoveragePartial;
}
