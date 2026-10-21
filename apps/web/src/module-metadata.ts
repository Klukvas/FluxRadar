// Reading a section's stored metadata for the report.
//
// `metadata` is whatever JSON the audit stored for one section, and its shape
// has grown between releases: a report opened today can belong to a scan that
// ran before a field existed. Every reader here narrows from `unknown` and
// answers null or an empty list for anything it does not recognise, so an old
// or malformed row renders less rather than throwing.

import {
  GEO_PROSE_POSITIONS,
  GEO_TONE_LABELS,
  type GeoAnswerPosition,
  type GeoAnswerTone,
  type GeoEvaluation,
  type GeoObservation,
} from './api';

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
  /**
   * Why the check had nothing to look at, as the rule itself named it.
   *
   * Null for every scan recorded before rules said so, and for every check that
   * did have targets. A check that ran on a truncated crawl and one that ran on
   * a one-page site both end with no targets, and only the rule can tell the
   * reader which of the two happened.
   */
  readonly notApplicableReason: string | null;
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
        notApplicableReason:
          typeof record.notApplicableReason === 'string' ? record.notApplicableReason : null,
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
  /**
   * How many of its points were discarded as unsupported by the collected
   * evidence — a claim about visual appearance, or visitor confusion inferred
   * from how many elements a page has.
   *
   * Zero on a review with nothing dropped, and on every row written before the
   * orchestrator recorded the count. Only the count is stored — the discarded
   * sentence is never shown, so there is nothing here to render from it.
   */
  readonly droppedFindings: number;
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
  const dropped = numberValue(asRecord(record.unsupportedClaims)?.findings);
  return {
    provider: record.provider,
    modelId: record.modelId,
    findings,
    droppedFindings: dropped ?? 0,
  };
}

export type AiCrawlerPurpose = 'search' | 'user-fetch' | 'training';

export type AiCrawlerStatus = 'allowed' | 'blocked' | 'unknown';

export interface AiCrawlerAccess {
  readonly purpose: AiCrawlerPurpose;
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
  const legacyPurpose: Readonly<Record<string, AiCrawlerPurpose>> = {
    GPTBot: 'training',
    'OAI-SearchBot': 'search',
    ClaudeBot: 'training',
    PerplexityBot: 'search',
    'Google-Extended': 'training',
    Bytespider: 'training',
  };
  const purpose =
    record.purpose === 'search' || record.purpose === 'user-fetch' || record.purpose === 'training'
      ? record.purpose
      : record.purpose === undefined
        ? legacyPurpose[record.userAgent]
        : undefined;
  return purpose === undefined ? [] : [{ userAgent: record.userAgent, status, purpose }];
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

// --- What AI says about the business: the stored answer digest ---------------
//
// Written once by the scan beside the answers (`providerVisibility.answerDigest`)
// and read here with the same fail-soft rule as everything above: a part that
// does not have its shape is null, and the report says "not evaluated in this
// scan" for it rather than drawing an empty result as a clean one.

export type GeoToneName = (typeof GEO_TONE_LABELS)[number];

export interface GeoFactDifference {
  readonly claim: string;
  readonly providers: readonly string[];
  readonly answerQuote: string;
  readonly sourceQuote: string;
}

export interface GeoFactGroup {
  readonly source: {
    readonly key: string;
    readonly kind: 'page' | 'profile';
    readonly label: string;
    readonly url: string | null;
  };
  readonly differences: readonly GeoFactDifference[];
}

export interface GeoFactDigest {
  readonly answersChecked: number;
  readonly differenceCount: number;
  readonly groups: readonly GeoFactGroup[];
}

export interface GeoProviderTone {
  readonly provider: string;
  readonly answers: number;
  readonly counts: Readonly<Record<GeoToneName, number>>;
  readonly noDescription: number;
  /** Judged, but the offered tone was refused. Absent on digests written before it existed: 0. */
  readonly unconfirmed: number;
  readonly notEvaluated: number;
}

export interface GeoNegativeTone {
  readonly provider: string;
  readonly question: string;
  readonly quote: string;
}

export interface GeoToneDigest {
  readonly judged: boolean;
  readonly providers: readonly GeoProviderTone[];
  readonly negativeQuotes: readonly GeoNegativeTone[];
}

export interface GeoProviderPosition {
  readonly provider: string;
  readonly discoveryAnswers: number;
  readonly placedAnswers: number;
  readonly firstPlace: number;
  readonly inList: number;
  readonly medianListRank: number | null;
  readonly afterCompetitors: number;
}

export interface GeoPositionDigest {
  readonly competitorsConfigured: boolean;
  readonly providers: readonly GeoProviderPosition[];
}

export interface GeoAnswerDigest {
  readonly facts: GeoFactDigest | null;
  readonly tone: GeoToneDigest | null;
  readonly position: GeoPositionDigest | null;
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function factDifferenceOf(value: unknown): GeoFactDifference[] {
  const record = asRecord(value);
  const claim = textOf(record?.claim);
  const answerQuote = textOf(record?.answerQuote);
  const sourceQuote = textOf(record?.sourceQuote);
  const providers = record?.providers;
  if (claim === null || answerQuote === null || sourceQuote === null || !Array.isArray(providers)) {
    return [];
  }
  return [{ claim, answerQuote, sourceQuote, providers: stringList(providers) }];
}

function factGroupOf(value: unknown): GeoFactGroup[] {
  const record = asRecord(value);
  const source = asRecord(record?.source);
  const key = textOf(source?.key);
  const label = textOf(source?.label);
  const kind = source?.kind;
  const differences = Array.isArray(record?.differences)
    ? record.differences.flatMap(factDifferenceOf)
    : [];
  if (key === null || label === null || (kind !== 'page' && kind !== 'profile')) return [];
  if (differences.length === 0) return [];
  const url = typeof source?.url === 'string' ? source.url : null;
  return [{ source: { key, kind, label, url }, differences }];
}

function factDigestOf(value: unknown): GeoFactDigest | null {
  const record = asRecord(value);
  if (record === null || !isCount(record.answersChecked) || !Array.isArray(record.groups)) {
    return null;
  }
  const groups = record.groups.flatMap(factGroupOf);
  return {
    answersChecked: record.answersChecked,
    differenceCount: groups.reduce((sum, group) => sum + group.differences.length, 0),
    groups,
  };
}

function toneCountsOf(value: unknown): Readonly<Record<GeoToneName, number>> | null {
  const record = asRecord(value);
  if (record === null || !GEO_TONE_LABELS.every((label) => isCount(record[label]))) return null;
  return Object.fromEntries(GEO_TONE_LABELS.map((label) => [label, record[label]])) as Record<
    GeoToneName,
    number
  >;
}

function providerToneOf(value: unknown): GeoProviderTone[] {
  const record = asRecord(value);
  const provider = textOf(record?.provider);
  const counts = toneCountsOf(record?.counts);
  if (
    provider === null ||
    counts === null ||
    !isCount(record?.answers) ||
    !isCount(record?.noDescription) ||
    !isCount(record?.notEvaluated)
  ) {
    return [];
  }
  return [
    {
      provider,
      counts,
      answers: record.answers,
      noDescription: record.noDescription,
      unconfirmed: isCount(record.unconfirmed) ? record.unconfirmed : 0,
      notEvaluated: record.notEvaluated,
    },
  ];
}

function negativeToneOf(value: unknown): GeoNegativeTone[] {
  const record = asRecord(value);
  const provider = textOf(record?.provider);
  const question = textOf(record?.question);
  const quote = textOf(record?.quote);
  return provider === null || question === null || quote === null
    ? []
    : [{ provider, question, quote }];
}

function toneDigestOf(value: unknown): GeoToneDigest | null {
  const record = asRecord(value);
  if (
    record === null ||
    typeof record.judged !== 'boolean' ||
    !Array.isArray(record.providers) ||
    !Array.isArray(record.negativeQuotes)
  ) {
    return null;
  }
  return {
    judged: record.judged,
    providers: record.providers.flatMap(providerToneOf),
    negativeQuotes: record.negativeQuotes.flatMap(negativeToneOf),
  };
}

function providerPositionOf(value: unknown): GeoProviderPosition[] {
  const record = asRecord(value);
  const provider = textOf(record?.provider);
  if (record === null || provider === null) return [];
  const { discoveryAnswers, placedAnswers, firstPlace, inList, afterCompetitors } = record;
  const median = record.medianListRank === null ? null : numberValue(record.medianListRank);
  if (
    !isCount(discoveryAnswers) ||
    !isCount(placedAnswers) ||
    !isCount(firstPlace) ||
    !isCount(inList) ||
    !isCount(afterCompetitors) ||
    (record.medianListRank !== null && median === null)
  ) {
    return [];
  }
  return [
    {
      provider,
      discoveryAnswers,
      placedAnswers,
      firstPlace,
      inList,
      afterCompetitors,
      medianListRank: median,
    },
  ];
}

function positionDigestOf(value: unknown): GeoPositionDigest | null {
  const record = asRecord(value);
  if (
    record === null ||
    typeof record.competitorsConfigured !== 'boolean' ||
    !Array.isArray(record.providers)
  ) {
    return null;
  }
  return {
    competitorsConfigured: record.competitorsConfigured,
    providers: record.providers.flatMap(providerPositionOf),
  };
}

/**
 * The stored summary of what AI answers say about the business, or null for a
 * scan recorded before it existed. A part that does not parse is null on its
 * own; the other two are still shown.
 */
export function geoAnswerDigestOf(metadata: Metadata): GeoAnswerDigest | null {
  const digest = asRecord(asRecord(metadata?.providerVisibility)?.answerDigest);
  if (digest === null) return null;
  return {
    facts: factDigestOf(digest.facts),
    tone: toneDigestOf(digest.tone),
    position: positionDigestOf(digest.position),
  };
}

/** One answer's tone as the API returned it, re-checked; null when there is none to show. */
export function answerToneOf(evaluation: GeoEvaluation | null | undefined): GeoAnswerTone | null {
  const tone = asRecord(evaluation?.tone);
  const label = tone?.label;
  const quote = textOf(tone?.quote);
  const known = GEO_TONE_LABELS.find((name) => name === label);
  return known === undefined || quote === null ? null : { label: known, quote };
}

/** One answer's place as the API returned it, re-checked; null when it has none. */
export function answerPositionOf(observation: GeoObservation): GeoAnswerPosition | null {
  const record = asRecord(observation.position);
  if (record === null || !isCount(record.competitorsBefore)) return null;
  const competitorsBefore = record.competitorsBefore;
  if (record.kind === 'list' && isCount(record.rank) && isCount(record.listSize)) {
    return record.rank >= 1 && record.rank <= record.listSize
      ? { kind: 'list', rank: record.rank, listSize: record.listSize, competitorsBefore }
      : null;
  }
  const bucket = GEO_PROSE_POSITIONS.find((name) => name === record.bucket);
  return record.kind === 'prose' && bucket !== undefined
    ? { kind: 'prose', bucket, competitorsBefore }
    : null;
}
