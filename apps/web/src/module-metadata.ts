// Reading a section's stored metadata for the report.
//
// `metadata` is whatever JSON the audit stored for one section, and its shape
// has grown between releases: a report opened today can belong to a scan that
// ran before a field existed. Every reader here narrows from `unknown` and
// answers null or an empty list for anything it does not recognise, so an old
// or malformed row renders less rather than throwing.

type Metadata = Readonly<Record<string, unknown>> | undefined;

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** One automated check a rule-based section ran, as the audit recorded it. */
export interface RuleCheck {
  readonly ruleId: string;
  readonly title: string;
  readonly targetKind: string;
  readonly informational: boolean;
  readonly applicableTargets: number;
  readonly affectedTargets: number;
}

/**
 * How one row of a section's check list reads.
 *
 * `notChecked` and `notApplicable` are deliberately separate: a check that was
 * one of the section's targets and produced no answer lowered that section's
 * coverage, and calling it "not applicable" would tell the owner the opposite
 * of what the score already did.
 */
export type RuleCheckResult = 'passed' | 'issues' | 'noted' | 'notChecked' | 'notApplicable';

/**
 * What a rule check can be. A rule always ran on the pages it applied to, so
 * `notChecked` belongs to the configured API endpoints alone — there, and only
 * there, is a target the section counted but never got an answer from.
 */
export type RuleCheckOutcome = Exclude<RuleCheckResult, 'notChecked'>;

/** The per-rule list a rule-based section recorded; empty for scans run before it existed. */
export function ruleChecksOf(metadata: Metadata): readonly RuleCheck[] {
  const entries = metadata?.ruleChecks;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry: unknown): RuleCheck[] => {
    const record = asRecord(entry);
    const applicableTargets = numberValue(record?.applicableTargets);
    const affectedTargets = numberValue(record?.affectedTargets);
    if (
      record === null ||
      typeof record.ruleId !== 'string' ||
      typeof record.title !== 'string' ||
      applicableTargets === null ||
      affectedTargets === null
    ) {
      return [];
    }
    return [
      {
        ruleId: record.ruleId,
        title: record.title,
        targetKind: typeof record.targetKind === 'string' ? record.targetKind : 'site',
        informational: record.scoring === 'informational',
        applicableTargets,
        affectedTargets,
      },
    ];
  });
}

/**
 * What one check's counts mean for the reader.
 *
 * A check with nothing to look at is not a pass: calling it one would claim a
 * form-label check "passed" on a site with no forms. An informational rule never
 * penalises the score, so what it found is a note rather than an issue.
 */
export function ruleCheckResult(check: RuleCheck): RuleCheckOutcome {
  if (check.applicableTargets === 0) return 'notApplicable';
  if (check.affectedTargets === 0) return 'passed';
  return check.informational ? 'noted' : 'issues';
}

/** How many of the analysed pages showed each static UX signal. */
export interface UxSignals {
  readonly pagesAnalyzed: number;
  readonly pagesWithHeadings: number;
  readonly pagesWithActions: number;
  readonly pagesWithForms: number;
  readonly pagesWithContactSignals: number;
}

export interface UxAiReview {
  readonly provider: string;
  readonly modelId: string;
  readonly findings: number;
}

export interface UxChecks {
  readonly signals: UxSignals;
  /** Null when the AI review got no answer in this scan. */
  readonly aiReview: UxAiReview | null;
}

/**
 * What UX/Conversion recorded besides its per-rule list.
 *
 * Every UX row that analysed a page carries its signals, including rows written
 * before the per-rule list existed. A row with none analysed nothing, and has
 * nothing to open.
 */
export function uxChecksOf(metadata: Metadata): UxChecks | null {
  const signals = asRecord(metadata?.staticSignals);
  const pagesAnalyzed = numberValue(signals?.pagesAnalyzed);
  const pagesWithHeadings = numberValue(signals?.pagesWithHeadings);
  const pagesWithActions = numberValue(signals?.pagesWithActions);
  const pagesWithForms = numberValue(signals?.pagesWithForms);
  const pagesWithContactSignals = numberValue(signals?.pagesWithContactSignals);
  if (
    pagesAnalyzed === null ||
    pagesWithHeadings === null ||
    pagesWithActions === null ||
    pagesWithForms === null ||
    pagesWithContactSignals === null
  ) {
    return null;
  }
  return {
    signals: {
      pagesAnalyzed,
      pagesWithHeadings,
      pagesWithActions,
      pagesWithForms,
      pagesWithContactSignals,
    },
    aiReview: uxAiReviewOf(metadata?.ai),
  };
}

/** The provider and model are written only when the review was answered. */
function uxAiReviewOf(value: unknown): UxAiReview | null {
  const record = asRecord(value);
  const findings = numberValue(record?.findings);
  if (
    typeof record?.provider !== 'string' ||
    typeof record.modelId !== 'string' ||
    findings === null
  ) {
    return null;
  }
  return { provider: record.provider, modelId: record.modelId, findings };
}

export type AiCrawlerStatus = 'allowed' | 'blocked' | 'unknown';

export interface AiCrawlerAccess {
  readonly userAgent: string;
  readonly status: AiCrawlerStatus;
}

export interface PageReadiness {
  readonly checked: number;
  readonly extractableContent: number;
  readonly structuredData: number;
  readonly socialPreview: number;
}

export interface QueryGeneration {
  readonly status: string;
  readonly questions: readonly string[];
}

/** Everything the AI SEO / GEO section recorded about what it checked. */
export interface GeoChecks {
  readonly robotsReadable: boolean;
  readonly crawlers: readonly AiCrawlerAccess[];
  readonly pages: PageReadiness | null;
  readonly queryGeneration: QueryGeneration | null;
}

export function geoChecksOf(metadata: Metadata): GeoChecks | null {
  const robots = asRecord(metadata?.robots);
  const pages = pageReadinessOf(metadata?.pages);
  const queryGeneration = queryGenerationOf(
    asRecord(metadata?.providerVisibility)?.queryGeneration,
  );
  if (robots === null && pages === null && queryGeneration === null) return null;
  const agents = robots?.agents;
  return {
    robotsReadable: robots?.status === 'available',
    crawlers: Array.isArray(agents) ? agents.flatMap(crawlerAccessOf) : [],
    pages,
    queryGeneration,
  };
}

function crawlerAccessOf(entry: unknown): AiCrawlerAccess[] {
  const record = asRecord(entry);
  const status = record?.status;
  if (
    typeof record?.userAgent !== 'string' ||
    (status !== 'allowed' && status !== 'blocked' && status !== 'unknown')
  ) {
    return [];
  }
  return [{ userAgent: record.userAgent, status }];
}

function pageReadinessOf(value: unknown): PageReadiness | null {
  const record = asRecord(value);
  const checked = numberValue(record?.checked);
  const extractableContent = numberValue(record?.extractableContent);
  const structuredData = numberValue(record?.structuredData);
  const socialPreview = numberValue(record?.socialPreview);
  if (
    checked === null ||
    extractableContent === null ||
    structuredData === null ||
    socialPreview === null
  ) {
    return null;
  }
  return { checked, extractableContent, structuredData, socialPreview };
}

function queryGenerationOf(value: unknown): QueryGeneration | null {
  const record = asRecord(value);
  if (typeof record?.status !== 'string') return null;
  const questions = record.generatedQuestions;
  return {
    status: record.status,
    questions: Array.isArray(questions)
      ? questions.filter((question): question is string => typeof question === 'string')
      : [],
  };
}

/** One configured API endpoint, as the Reliability section recorded it. */
export interface ApiCheckOutcome {
  readonly method: string;
  readonly url: string;
  readonly expectedStatus: readonly number[];
  readonly status: number | null;
  readonly timingMs: number | null;
  /**
   * Whether the module counted this endpoint among its targets. False only for
   * an address that is not on the scanned site; an endpoint that timed out was
   * a target and stays one, which is why it lowers the section's coverage.
   */
  readonly applicable: boolean;
  readonly skippedReason: string | null;
}

/**
 * The reason an endpoint was never part of the audit, as scans recorded it
 * before `applicable` was stored beside it.
 *
 * Deliberately a literal of its own rather than an import from the runner: it
 * describes rows that already exist and can never change, so renaming the
 * reason the runner writes must not silently re-read those rows as something
 * else. New rows answer the question directly and never reach this.
 */
const NOT_PART_OF_THIS_AUDIT = 'OutsideScannedSite';

/**
 * The endpoints the Reliability section was pointed at.
 *
 * Empty for a scan that configured none, and for one that ran before the
 * setting existed — the two are the same thing to a reader: no endpoints were
 * checked, so the section says nothing about any.
 */
export function apiCheckOutcomesOf(metadata: Metadata): readonly ApiCheckOutcome[] {
  const entries = metadata?.apiChecks;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry: unknown): ApiCheckOutcome[] => {
    const record = asRecord(entry);
    if (record === null || typeof record.url !== 'string' || typeof record.method !== 'string') {
      return [];
    }
    const expected = record.expectedStatus;
    const skippedReason = typeof record.skippedReason === 'string' ? record.skippedReason : null;
    return [
      {
        method: record.method,
        url: record.url,
        expectedStatus: Array.isArray(expected)
          ? expected.filter((status): status is number => typeof status === 'number')
          : [],
        status: numberValue(record.status),
        timingMs: numberValue(record.timingMs),
        // A scan run before the flag was recorded still answers the question,
        // from the one reason that means "never a target of this audit".
        applicable:
          typeof record.applicable === 'boolean'
            ? record.applicable
            : skippedReason !== NOT_PART_OF_THIS_AUDIT,
        skippedReason,
      },
    ];
  });
}

/** Which DOM a section read: the server's HTML, or the page after its scripts ran. */
export interface RenderingState {
  readonly status: 'Rendered' | 'Unavailable';
  readonly reason: string | null;
  readonly engine: string | null;
  readonly renderedPages: number | null;
  readonly unrenderedPages: number | null;
  /**
   * Pages that rendered without a resource they asked for — a script the byte
   * budget could not pay for, a bundle robots.txt closed, a host the SSRF guard
   * refused. They are NOT `unrenderedPages`: those produced no DOM at all,
   * while these produced one that is missing what those resources would have
   * added, and a reader told only "rendered: 12" would take it for the page.
   */
  readonly incompletePages: number | null;
  /** Why, as the crawler's own reason codes; empty when none were incomplete. */
  readonly incompleteReasons: readonly string[];
}

/**
 * Null when rendering was never asked for, which is the ordinary case and needs
 * no sentence in the report. A requested render that could not happen is NOT
 * null: that one has to be said, or the static HTML would be read as the
 * rendered page it is not.
 */
export function renderingStateOf(metadata: Metadata): RenderingState | null {
  const status = metadata?.javascriptRendering;
  if (status !== 'Rendered' && status !== 'Unavailable') return null;
  return {
    status,
    reason:
      typeof metadata?.javascriptRenderingReason === 'string'
        ? metadata.javascriptRenderingReason
        : null,
    engine: typeof metadata?.renderEngine === 'string' ? metadata.renderEngine : null,
    renderedPages: numberValue(metadata?.renderedPages),
    unrenderedPages: numberValue(metadata?.unrenderedPages),
    incompletePages: numberValue(metadata?.incompletelyRenderedPages),
    incompleteReasons: stringList(metadata?.incompleteRenderReasons),
  };
}

/** The strings of an unknown value that should be a list of them. */
function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
