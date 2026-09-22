// What one report section checked, opened from its card.
//
// A card says how a section ended — a score, a coverage bar, a status — but not
// what was looked at to get there. A rule-based section lists every automated
// check it ran and what each one found. The AI SEO / GEO section lists what
// robots.txt lets AI crawlers read, how ready its pages are to be quoted, and
// the questions it put to the AI provider together with the answers.
// Performance lists each measurement against its threshold, UX/Conversion
// adds what the page HTML showed and whether its AI review ran, and Analytics
// adds what its checks concluded and the Google data they read.
//
// Everything is read from what the audit recorded, never filled in from the
// plan: a scan run before a field existed shows less, not something assumed.

import { AnalyticsDetails } from './AnalyticsChecks';
import type { GeoObservation, MentionSignal, ScanModule } from './api';
import { CheckRow } from './CheckRow';
import { GoogleDataPanel, googleSnapshotIn } from './GoogleDataPanel';
import { copy, fillCopy, type Language } from './i18n';
import {
  geoChecksOf,
  ruleCheckResult,
  ruleChecksOf,
  uxChecksOf,
  type AiCrawlerStatus,
  type GeoChecks,
  type PageReadiness,
  type QueryGeneration,
  type RuleCheck,
  type RuleCheckResult,
  type UxChecks,
} from './module-metadata';
import { performanceChecksOf } from './performance-checks';
import { PerformanceChecksBody } from './PerformanceChecks';

const GEO_MODULE = 'AI SEO / GEO';
const PERFORMANCE_MODULE = 'Performance';
const UX_MODULE = 'UX/Conversion';
const ANALYTICS_MODULE = 'Analytics';

/** Class suffix per result. The colour repeats the word beside it, never replaces it. */
const RESULT_CLASS: Readonly<Record<RuleCheckResult, string>> = {
  passed: 'passed',
  issues: 'issues',
  noted: 'noted',
  notApplicable: 'skipped',
};

const CRAWLER_CLASS: Readonly<Record<AiCrawlerStatus, string>> = {
  allowed: 'passed',
  blocked: 'issues',
  unknown: 'skipped',
};

/** Whether a section card has a recorded check list to open. */
export function hasModuleChecks(
  module: ScanModule,
  observations: readonly GeoObservation[],
): boolean {
  if (module.module === GEO_MODULE) {
    return observations.length > 0 || geoChecksOf(module.metadata) !== null;
  }
  if (module.module === PERFORMANCE_MODULE) {
    return performanceChecksOf(module.metadata) !== null;
  }
  if (module.module === UX_MODULE) {
    return ruleChecksOf(module.metadata).length > 0 || uxChecksOf(module.metadata) !== null;
  }
  if (module.module === ANALYTICS_MODULE) {
    // A report from before the Analytics checks still opens to its Google data.
    return ruleChecksOf(module.metadata).length > 0 || googleSnapshotIn(module) !== null;
  }
  return ruleChecksOf(module.metadata).length > 0;
}

/** The id a card's toggle points at; stable per section name. */
export function moduleChecksId(module: string): string {
  return `module-checks-${module.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

export function ModuleChecksPanel(props: {
  module: ScanModule;
  observations: readonly GeoObservation[];
  language: Language;
}) {
  const t = copy[props.language].report.checks;
  const id = moduleChecksId(props.module.module);
  return (
    <section className="module-checks" id={id} aria-labelledby={`${id}-title`}>
      <h3 className="section-heading" id={`${id}-title`}>
        {fillCopy(t.heading, { module: props.module.module })}
      </h3>
      <ModuleChecksBody
        module={props.module}
        observations={props.observations}
        language={props.language}
      />
    </section>
  );
}

function ModuleChecksBody(props: {
  module: ScanModule;
  observations: readonly GeoObservation[];
  language: Language;
}) {
  const { metadata } = props.module;
  switch (props.module.module) {
    case GEO_MODULE:
      return (
        <GeoChecksBody
          checks={geoChecksOf(metadata)}
          observations={props.observations}
          language={props.language}
        />
      );
    case PERFORMANCE_MODULE:
      return <PerformanceChecksBody metadata={metadata} language={props.language} />;
    case UX_MODULE:
      return (
        <UxChecksBody
          checks={ruleChecksOf(metadata)}
          ux={uxChecksOf(metadata)}
          language={props.language}
        />
      );
    case ANALYTICS_MODULE:
      return <AnalyticsChecksBody module={props.module} language={props.language} />;
    default:
      return <RuleChecksList checks={ruleChecksOf(metadata)} language={props.language} />;
  }
}

function RuleChecksList(props: {
  checks: readonly RuleCheck[];
  language: Language;
  lead?: string;
}) {
  const t = copy[props.language].report.checks;
  return (
    <>
      <p className="muted">{props.lead ?? t.ruleLead}</p>
      <ul className="module-checks__list">
        {props.checks.map((check) => {
          const result = ruleCheckResult(check);
          return (
            <CheckRow
              key={check.ruleId}
              resultClass={RESULT_CLASS[result]}
              resultLabel={resultLabel(result, props.language)}
              title={checkTitle(check, props.language)}
              detail={`${check.ruleId} · ${checkDetail(check, result, props.language)}`}
            />
          );
        })}
      </ul>
    </>
  );
}

/**
 * The UX/Conversion checks, then what the page HTML showed and the AI review.
 *
 * A row written before the per-rule list existed still has its signals and its
 * AI review, so it opens to those rather than to nothing.
 */
function UxChecksBody(props: {
  checks: readonly RuleCheck[];
  ux: UxChecks | null;
  language: Language;
}) {
  const t = copy[props.language].report.checks;
  return (
    <>
      {props.checks.length === 0 ? null : (
        <RuleChecksList checks={props.checks} language={props.language} />
      )}
      {props.ux === null ? null : (
        <>
          <UxSignalsList ux={props.ux} language={props.language} />
          <div className="module-checks__group">
            <h4 className="module-checks__subheading">{t.uxAiHeading}</h4>
            <p className="muted">
              {props.ux.aiReview === null
                ? t.uxAiNotRan
                : fillCopy(t.uxAiRan, {
                    provider: props.ux.aiReview.provider,
                    model: props.ux.aiReview.modelId,
                    findings: props.ux.aiReview.findings,
                  })}
            </p>
          </div>
        </>
      )}
    </>
  );
}

/**
 * The Analytics checks, what they concluded, then the Google data they read.
 *
 * Only the checks that ran are listed; when a Google service gave no data the
 * rest did not run, and a sentence says so rather than a row per missing check.
 */
function AnalyticsChecksBody(props: { module: ScanModule; language: Language }) {
  const t = copy[props.language].report.checks;
  const checks = ruleChecksOf(props.module.metadata);
  const snapshot = googleSnapshotIn(props.module);
  const someDidNotRun =
    checks.length > 0 &&
    props.module.completedApplicableChecks !== null &&
    props.module.applicableChecks !== null &&
    props.module.completedApplicableChecks < props.module.applicableChecks;
  return (
    <>
      {checks.length === 0 ? null : (
        <RuleChecksList checks={checks} language={props.language} lead={t.analyticsLead} />
      )}
      {someDidNotRun ? <p className="muted">{t.analyticsNotRan}</p> : null}
      <AnalyticsDetails module={props.module} language={props.language} />
      {snapshot === null ? null : <GoogleDataPanel snapshot={snapshot} language={props.language} />}
    </>
  );
}

/** Signals, not verdicts: the neutral colour keeps a page without a form from reading as a failure. */
function UxSignalsList(props: { ux: UxChecks; language: Language }) {
  const t = copy[props.language].report.checks;
  const { signals } = props.ux;
  const rows = [
    { key: 'headings', title: t.uxSignalHeadings, count: signals.pagesWithHeadings },
    { key: 'actions', title: t.uxSignalActions, count: signals.pagesWithActions },
    { key: 'forms', title: t.uxSignalForms, count: signals.pagesWithForms },
    { key: 'contact', title: t.uxSignalContact, count: signals.pagesWithContactSignals },
  ];
  return (
    <div className="module-checks__group">
      <h4 className="module-checks__subheading">{t.uxSignalsHeading}</h4>
      <p className="muted">{t.uxSignalsLead}</p>
      <ul className="module-checks__list">
        {rows.map((row) => (
          <CheckRow
            key={row.key}
            resultClass="skipped"
            resultLabel={fillCopy(t.uxSignalCount, {
              count: row.count,
              checked: signals.pagesAnalyzed,
            })}
            title={row.title}
          />
        ))}
      </ul>
    </div>
  );
}

function resultLabel(result: RuleCheckResult, language: Language): string {
  const t = copy[language].report.checks;
  const labels: Readonly<Record<RuleCheckResult, string>> = {
    passed: t.resultPassed,
    issues: t.resultIssues,
    noted: t.resultNoted,
    notApplicable: t.resultNotApplicable,
  };
  return labels[result];
}

/**
 * The check's name in the reader's language.
 *
 * Only checks the report has written copy for are translated; any other falls
 * back to the registry title rather than to nothing.
 */
function checkTitle(check: RuleCheck, language: Language): string {
  const titles: Readonly<Record<string, string | undefined>> = copy[language].report.checks.titles;
  return titles[check.ruleId] ?? check.title.charAt(0).toUpperCase() + check.title.slice(1);
}

function checkDetail(check: RuleCheck, result: RuleCheckResult, language: Language): string {
  const t = copy[language].report.checks;
  const counts = { affected: check.affectedTargets, applicable: check.applicableTargets };
  const perPage = check.targetKind === 'page';
  switch (result) {
    case 'notApplicable': {
      const reasons: Readonly<Record<string, string | undefined>> = t.notApplicableReasons;
      return reasons[check.ruleId] ?? t.detailNotApplicable;
    }
    case 'passed':
      return perPage ? fillCopy(t.detailPassedPages, counts) : t.detailPassed;
    case 'issues':
      return perPage ? fillCopy(t.detailIssuesPages, counts) : t.detailIssues;
    case 'noted':
      return perPage ? fillCopy(t.detailNotedPages, counts) : t.detailNoted;
  }
}

function GeoChecksBody(props: {
  checks: GeoChecks | null;
  observations: readonly GeoObservation[];
  language: Language;
}) {
  const report = copy[props.language].report;
  const generation = props.checks?.queryGeneration ?? null;
  return (
    <>
      {props.checks === null ? null : (
        <CrawlerAccess checks={props.checks} language={props.language} />
      )}
      {props.checks?.pages ? (
        <PageReadinessList pages={props.checks.pages} language={props.language} />
      ) : null}
      <div className="module-checks__group">
        <h4 className="module-checks__subheading">{report.checks.geoQuestionsHeading}</h4>
        {generation === null ? null : (
          <p className="muted">{generationNote(generation, props.language)}</p>
        )}
        {props.observations.length === 0 ? (
          <p className="muted">{report.checks.geoQuestionsNone}</p>
        ) : (
          <>
            <p className="muted">{report.geoObservationsLead}</p>
            {geoProviderGroups(props.observations).map((group) => (
              <GeoProviderGroup
                key={group.provider ?? 'unnamed'}
                group={group}
                language={props.language}
              />
            ))}
          </>
        )}
      </div>
    </>
  );
}

/** Who the report shows first: the assistant customers ask about (D-233). */
const GEO_PROVIDER_ORDER: readonly string[] = ['openai', 'anthropic'];

interface GeoProviderGroupData {
  /** null for a report written before the provider was recorded per request. */
  readonly provider: string | null;
  readonly modelId: string | null;
  readonly observations: readonly GeoObservation[];
}

/**
 * One group per assistant that was asked, in a fixed order.
 *
 * A provider the report does not know about still gets its own group rather
 * than being folded into another one's answers: whose answer this is is the
 * whole point of asking more than one.
 */
function geoProviderGroups(
  observations: readonly GeoObservation[],
): readonly GeoProviderGroupData[] {
  return observations
    .map((observation) => observation.provider)
    .filter((provider, index, all) => all.indexOf(provider) === index)
    .sort((left, right) => geoProviderRank(left) - geoProviderRank(right))
    .map((provider) => {
      const grouped = observations.filter((observation) => observation.provider === provider);
      return {
        provider,
        modelId: grouped.find((observation) => observation.modelId !== null)?.modelId ?? null,
        observations: grouped,
      };
    });
}

/** Known providers in the order above, then unknown names, then unnamed ones. */
function geoProviderRank(provider: string | null): number {
  if (provider === null) return GEO_PROVIDER_ORDER.length + 1;
  const known = GEO_PROVIDER_ORDER.indexOf(provider);
  return known === -1 ? GEO_PROVIDER_ORDER.length : known;
}

function geoProviderLabel(provider: string | null, language: Language): string {
  const t = copy[language].report;
  if (provider === 'openai') return t.geoProviderOpenai;
  if (provider === 'anthropic') return t.geoProviderAnthropic;
  // An unknown name is shown as recorded rather than translated into a guess.
  return provider ?? t.geoProviderUnnamed;
}

/**
 * How often the brand and the domain came up, over the answers where the
 * question left room for them to. An unmeasurable signal is left out of both
 * halves of the count instead of being read as a miss.
 */
function geoMentionCounts(
  observations: readonly GeoObservation[],
  language: Language,
): readonly string[] {
  const t = copy[language].report;
  const measured = observations.flatMap((observation) =>
    observation.mentions === null ? [] : [observation.mentions],
  );
  const line = (template: string, signals: readonly MentionSignal[]): readonly string[] => {
    const total = signals.filter(
      (signal) => signal === 'mentioned' || signal === 'not-mentioned',
    ).length;
    if (total === 0) return [];
    const count = signals.filter((signal) => signal === 'mentioned').length;
    return [fillCopy(template, { count, total })];
  };
  return [
    ...line(
      t.geoGroupBrandCount,
      measured.map((mentions) => mentions.brand),
    ),
    ...line(
      t.geoGroupDomainCount,
      measured.map((mentions) => mentions.domain),
    ),
  ];
}

function GeoProviderGroup(props: { group: GeoProviderGroupData; language: Language }) {
  const { group } = props;
  const label = geoProviderLabel(group.provider, props.language);
  const counts = geoMentionCounts(group.observations, props.language);
  return (
    <div className="module-checks__group">
      <h5 className="module-checks__subheading">
        {group.modelId === null ? label : `${label} · ${group.modelId}`}
      </h5>
      {counts.length === 0 ? null : <p className="muted">{counts.join(' · ')}</p>}
      <div className="geo-observations__grid">
        {group.observations.map((observation, index) => (
          <GeoObservationCard
            key={`${observation.purpose}:${index}:${observation.question}`}
            observation={observation}
            language={props.language}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * What robots.txt lets each AI crawler read.
 *
 * A robots.txt that could not be read leaves every crawler "unknown"; six rows
 * of the same unknown would say less than the one sentence that explains it.
 */
function CrawlerAccess(props: { checks: GeoChecks; language: Language }) {
  const t = copy[props.language].report.checks;
  const labels: Readonly<Record<AiCrawlerStatus, string>> = {
    allowed: t.crawlerAllowed,
    blocked: t.crawlerBlocked,
    unknown: t.crawlerUnknown,
  };
  return (
    <div className="module-checks__group">
      <h4 className="module-checks__subheading">{t.geoCrawlersHeading}</h4>
      {props.checks.robotsReadable && props.checks.crawlers.length > 0 ? (
        <>
          <p className="muted">{t.geoCrawlersLead}</p>
          <ul className="module-checks__list">
            {props.checks.crawlers.map((crawler) => (
              <CheckRow
                key={crawler.userAgent}
                resultClass={CRAWLER_CLASS[crawler.status]}
                resultLabel={labels[crawler.status]}
                title={crawler.userAgent}
              />
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">{t.geoRobotsUnavailable}</p>
      )}
    </div>
  );
}

function PageReadinessList(props: { pages: PageReadiness; language: Language }) {
  const t = copy[props.language].report.checks;
  const { checked } = props.pages;
  const rows = [
    { key: 'content', title: t.geoPagesContent, count: props.pages.extractableContent },
    { key: 'structured', title: t.geoPagesStructured, count: props.pages.structuredData },
    { key: 'social', title: t.geoPagesSocial, count: props.pages.socialPreview },
  ];
  return (
    <div className="module-checks__group">
      <h4 className="module-checks__subheading">{t.geoPagesHeading}</h4>
      {checked === 0 ? (
        <p className="muted">{t.geoPagesNone}</p>
      ) : (
        <ul className="module-checks__list">
          {rows.map((row) => {
            const result = readinessResult(row.count, checked, props.language);
            return (
              <CheckRow
                key={row.key}
                resultClass={result.resultClass}
                resultLabel={result.label}
                title={row.title}
                detail={fillCopy(t.geoPagesCount, { count: row.count, checked })}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

function readinessResult(
  count: number,
  checked: number,
  language: Language,
): { readonly resultClass: string; readonly label: string } {
  const t = copy[language].report.checks;
  if (count === checked) return { resultClass: 'passed', label: t.resultPassed };
  if (count === 0) return { resultClass: 'missing', label: t.resultMissing };
  return { resultClass: 'partial', label: t.resultPartial };
}

/** Where the discovery questions came from, or why only the brand questions were asked. */
function generationNote(generation: QueryGeneration, language: Language): string {
  const t = copy[language].report.checks;
  if (generation.status === 'Completed') {
    return fillCopy(t.geoQuestionsGenerated, { count: generation.questions.length });
  }
  if (generation.status === 'NotApplicable') return t.geoQuestionsNoContext;
  return t.geoQuestionsGenerationFailed;
}

/**
 * Prompt-level GEO evidence, not a claim about a model's memory or training.
 *
 * The answer and citation strings are provider output. React escapes their
 * text, and only validated HTTP(S) citations become navigable links.
 */
/**
 * Whether a visibility badge reads as a measurement or as "not measured".
 *
 * Both used to be a plain yes, and both were yes on every scan: the question
 * named the brand and spelled out the domain, so the answer repeating them
 * proved nothing. A signal we could not measure now says so rather than
 * borrowing the colour of one we could.
 */
function signalClass(signal: MentionSignal): string {
  return signal === 'mentioned' || signal === 'not-mentioned'
    ? 'geo-observation__signal'
    : 'geo-observation__signal geo-observation__signal--unmeasured';
}

function brandSignalLabel(signal: MentionSignal, language: Language): string {
  const t = copy[language].report;
  switch (signal) {
    case 'mentioned':
      return t.geoBrandMentioned;
    case 'not-mentioned':
      return t.geoBrandNotMentioned;
    case 'brand-is-hostname':
      return t.geoBrandIsHostname;
    default:
      return t.geoBrandNamedInQuestion;
  }
}

function domainSignalLabel(signal: MentionSignal, language: Language): string {
  const t = copy[language].report;
  switch (signal) {
    case 'mentioned':
      return t.geoDomainMentioned;
    case 'not-mentioned':
      return t.geoDomainNotMentioned;
    default:
      return t.geoDomainNamedInQuestion;
  }
}

function GeoObservationCard(props: { observation: GeoObservation; language: Language }) {
  const t = copy[props.language].report;
  const { observation } = props;
  const citations = [
    ...new Map(
      observation.citations.flatMap((citation) => {
        const href = safeHttpUrl(citation);
        return href === null ? [] : [[href, { label: citation, href }] as const];
      }),
    ).values(),
  ];
  return (
    <article className="geo-observation">
      <div className="split geo-observation__header">
        <strong>
          {observation.purpose === 'discovery' ? t.geoDiscoveryQuestion : t.geoAwarenessQuestion}
        </strong>
        {observation.provider === null || observation.modelId === null ? null : (
          <small className="technical">
            {t.geoProvider}: {observation.provider} · {observation.modelId}
          </small>
        )}
      </div>
      <p className="geo-observation__question">{observation.question}</p>
      {observation.status === 'answered' && observation.answer !== null ? (
        <>
          <div className="geo-observation__answer">
            <strong>{t.geoAnswerLabel}</strong>
            <p>{observation.answer}</p>
          </div>
          {observation.mentions === null ? null : (
            <div className="geo-observation__mentions" aria-label={t.geoMentionSignals}>
              <span className={signalClass(observation.mentions.brand)}>
                {brandSignalLabel(observation.mentions.brand, props.language)}
              </span>
              <span className={signalClass(observation.mentions.domain)}>
                {domainSignalLabel(observation.mentions.domain, props.language)}
              </span>
            </div>
          )}
          {citations.length === 0 ? null : (
            <div className="geo-observation__citations">
              <strong>{t.geoCitations}</strong>
              <ul>
                {citations.map((citation) => (
                  <li key={citation.href}>
                    <a href={citation.href} target="_blank" rel="noreferrer">
                      {citation.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="muted geo-observation__unavailable">{t.geoUnavailable}</p>
      )}
    </article>
  );
}

function safeHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}
