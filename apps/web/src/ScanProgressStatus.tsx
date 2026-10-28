// The lines under the bar of a scan that has not finished: what is happening
// now, how long it tends to take, and where the result will be.
//
// Written for the owner of a small site, not for whoever runs the worker: the
// stage is named in plain words, the time is a rough expectation rather than a
// promise, and the page limit reads as a ceiling rather than as the size of
// the job.

import type { Scan } from './api';
import { formatCount } from './format-count';
import { copy, fillCopy, type Language } from './i18n';
import { PLAN_URL_LIMIT, isLegacyPlan } from './plan-modules';
import { moduleLabel } from './rule-titles';
import { isRunningLong, progressStage, type ProgressStage } from './scan-progress-state';

type ProgressCopy = (typeof copy)[Language]['scanProgress'];

export function ScanProgressStatus(props: { scan: Scan; language: Language; now: number }) {
  const t = copy[props.language].scanProgress;
  const stage = progressStage(props.scan);
  const pagesRead = props.scan.progress.scannedUrls ?? 0;
  // The count belongs to the crawl; once the sections run it would sit frozen
  // under a headline about something else.
  const showPages = pagesRead > 0 && stage.kind === 'reading';
  return (
    <>
      <p role="status" aria-live="polite">
        <strong>{stageHeadline(stage, t, props.language)}</strong>
      </p>
      {showPages ? (
        <p className="muted tabular-nums">
          {t.pagesRead(pagesRead, formatCount(pagesRead, props.language))}
        </p>
      ) : null}
      <p className="muted">{t.typicalDuration}</p>
      {isRunningLong(props.scan, props.now) ? <p>{t.runningLong}</p> : null}
      <p className="muted">{t.closePage}</p>
      <p className="muted">{t.whereReport}</p>
      <p className="muted">
        <small>{scopeLine(props.scan, t, props.language)}</small>
      </p>
    </>
  );
}

function stageHeadline(stage: ProgressStage, t: ProgressCopy, language: Language): string {
  switch (stage.kind) {
    case 'queued':
      return t.stageQueued;
    case 'reading':
      return t.stageReading;
    case 'checking':
      return stage.module === null
        ? t.stageCheckingBetween
        : fillCopy(t.stageChecking, { area: moduleArea(stage.module, t, language) });
    case 'finishing':
      return t.finalizing;
  }
}

/** The plain name of a section; the report's own name for one this list lacks. */
function moduleArea(module: string, t: ProgressCopy, language: Language): string {
  const areas: Readonly<Record<string, string>> = t.moduleAreas;
  return areas[module] ?? moduleLabel(module, language);
}

/**
 * The most pages the crawl may read, said as a limit.
 *
 * "Scope: up to 5,000 pages" read on a five-page site as the amount of work
 * ahead. An absent `maxPages` means the whole plan (`scanScopeSchema`); a
 * Free check is its homepage and nothing else.
 */
function scopeLine(scan: Scan, t: ProgressCopy, language: Language): string {
  if (scan.plan === 'Free') return t.scopeHomepage;
  // A retired plan has no tariff row; Website Audit crawled to Complete's ceiling.
  const planLimit = PLAN_URL_LIMIT[isLegacyPlan(scan.plan) ? 'Complete' : scan.plan];
  const owner = scan.scope.maxPages;
  if (owner !== undefined && owner < planLimit)
    return t.scopeOwnerLimit(owner, formatCount(owner, language));
  return t.scopePlanLimit(planLimit, formatCount(planLimit, language));
}
