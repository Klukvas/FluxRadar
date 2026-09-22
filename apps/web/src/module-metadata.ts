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

/** A whole number of things: a non-negative integer. */
export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
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

export type RuleCheckResult = 'passed' | 'issues' | 'noted' | 'notApplicable';

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
export function ruleCheckResult(check: RuleCheck): RuleCheckResult {
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
