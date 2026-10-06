// The made-up report behind /example-report.
//
// A visitor who has not paid cannot see a report, and the home page's three-line
// sample was not enough to picture one: "the hero promises every signal and the
// instrument panel shows dashes" was the actual complaint. So this is a whole
// report, built out of the same data shapes the API sends — `Dashboard`,
// `Issue`, `IssueSummary` — and drawn by the same components, so it cannot
// quietly drift away from what a real report looks like.
//
// Rules about it, all of them load-bearing:
//
//  · The site is `bloom-nails.example`. `.example` is reserved (RFC 2606) and
//    the home page already uses it, so nothing here can point at a real
//    business, and no address on it can ever resolve.
//  · Every rule id is a rule the product really has, and every one of them has
//    a plain-language explanation (`finding-explainers.ts`). The example may be
//    invented; what the product reports about it may not be.
//  · No price, no payment state and no email address outside the `.example`
//    domain. A sample report that said "you paid" or promised a refund would be
//    making a claim about a purchase nobody made.

import type { Dashboard, Issue, IssueRuleGroup, IssueSummary, Scan } from './api';
import { SIDE_SCORE_MODULES } from './plan-modules';

/**
 * The coverage §15 calls a normal reading, and the one it calls provisional.
 *
 * Mirrors `WEIGHTED_COVERAGE_NORMAL_MIN` / `_PROVISIONAL_MIN` in
 * `packages/scoring/src/overall-score.ts`, which `apps/web` does not import for
 * the same reason `plan-modules.ts` mirrors the tariff table. The page's own
 * test reads the scoring source and fails if either number moves.
 */
const WEIGHTED_COVERAGE_NORMAL_MIN = 0.8;
const WEIGHTED_COVERAGE_PROVISIONAL_MIN = 0.5;

/** The made-up site. `.example` is reserved and can never resolve (RFC 2606). */
export const EXAMPLE_DOMAIN = 'bloom-nails.example';

/** Not an id any scan has: nothing can be looked up from this page. */
const EXAMPLE_SCAN_ID = 'example-report';

const EXAMPLE_DAY = '2026-10-02T09:14:00.000Z';

/**
 * How much of the site the crawl read: all of it.
 *
 * It used to read twelve of fourteen addresses and attribute the two it missed
 * to the owner's own page limit, which is what the API would do — and that put
 * "Your scan settings limit this check to 12 pages… Raise the page limit before
 * the next check" on a page read by somebody who has no scan settings and no
 * account. Three different percentages then faced the same reader: 97% of the
 * checks were done, 86% of the addresses were read, 83% of one section's
 * checks. The example is not the place to teach a limit nobody set, so the
 * crawl reads every address it found and the page is left with two figures and
 * one sentence saying how they differ.
 *
 * `maxPages` stays well above the addresses found, so the API would attribute
 * nothing to a limit: `limitedBy` is null and the panel prints the sentence it
 * prints for a complete crawl. `example-report.test.tsx` pins both, and keeps
 * the plan-limit rule conditional so the attribution stays checked if the
 * fixture ever becomes a limited one again.
 */
const CRAWL = {
  reach: 'reachable',
  startStatus: 200,
  accessControlSignals: [],
  pagesRead: 12,
  pagesFetched: 12,
  urlsDiscovered: 12,
  urlsOverLimit: 0,
  urlsBlockedByRobots: 0,
  limitedBy: null,
  maxPages: 50,
} as const satisfies NonNullable<Scan['crawlSummary']>;

/**
 * One problem of the example, before it is turned into findings.
 *
 * `ruleId` is checked against the real registry by the page's own test, and
 * `pages` is one address per finding, on the made-up site, so the counts the
 * report prints are counted rather than asserted: a rule that reports per link
 * and a rule that reports per page then say different things about the same
 * list, exactly as they would on a real report.
 */
interface ExampleProblem {
  readonly ruleId: string;
  readonly module: string;
  readonly severity: 'Critical' | 'High' | 'Medium' | 'Low';
  readonly pages: readonly string[];
  /**
   * What the check counted *inside* those pages, where that is not the number
   * of findings: the pictures with no text description are twelve across three
   * pages, and the rule reports one finding per page. Only the image rule has
   * one, and the home page's preview and the card's own sentence both read the
   * number from here rather than stating it twice.
   */
  readonly itemsFound?: number;
}

/**
 * Six problems a nail salon's site really could have, each one a rule the
 * product runs: the booking link that leads nowhere, the AI review's note about
 * what stops a visitor getting in touch, the pages with no summary for search
 * results, the heading order, the pictures with no text description, and the
 * hard-to-read text.
 *
 * Six of its problems, not all of them, and the copy says so. SEO-ONPAGE-005
 * below has a twin: §14 has `packages/rules` report A11Y-002 over the same
 * evidence — the same `IMG_ALT_EVIDENCE_CATEGORY` group, two findings, two
 * tariff weights — so a real Complete report of this site would carry A11Y-002
 * on the same three pages. Writing a second rule's worth of plain-language copy
 * to make the list exhaustive buys nothing a truthful sentence does not, so the
 * list stays a selection and `findingsLead` introduces it as one.
 *
 * Three of them are the three the home page previews, and their counts are the
 * counts it prints: four pages with no description, three broken links, twelve
 * pictures with no text description. The home block reads them from here
 * (`EXAMPLE_HOME_PREVIEW`) instead of restating them, because it stated them
 * differently — "4 pages" there against seven here, and an image problem the
 * full example did not have at all.
 *
 * Ordered as the API orders a summary — most urgent first — so "Fix these
 * first" reads off it unchanged.
 */
const PROBLEMS: readonly ExampleProblem[] = [
  {
    ruleId: 'SEO-TECH-006',
    module: 'SEO',
    severity: 'High',
    pages: ['/book', '/prices', '/gift-cards'],
  },
  {
    ruleId: 'UX-CONV-AI-003',
    module: 'UX/Conversion',
    severity: 'High',
    pages: ['/contact', '/'],
  },
  {
    ruleId: 'SEO-ONPAGE-002',
    module: 'SEO',
    severity: 'Medium',
    pages: ['/prices', '/gallery', '/about', '/team'],
  },
  {
    ruleId: 'SEO-ONPAGE-003',
    module: 'SEO',
    severity: 'Medium',
    pages: ['/about', '/prices', '/team', '/gallery', '/nail-care-tips'],
  },
  // Its Accessibility twin, A11Y-002, is deliberately absent: see the note
  // above. `example-report.test.tsx` fails if the copy stops calling the list a
  // selection while a shared-evidence rule is left out of it.
  {
    ruleId: 'SEO-ONPAGE-005',
    module: 'SEO',
    severity: 'Low',
    pages: ['/gallery', '/team', '/nail-care-tips'],
    itemsFound: 12,
  },
  {
    ruleId: 'CONTENT-005',
    module: 'Content Quality',
    severity: 'Low',
    pages: ['/nail-care-tips', '/about'],
  },
];

/** Every rule the example reports on, for the test that checks they are real. */
export const EXAMPLE_RULE_IDS: readonly string[] = PROBLEMS.map((problem) => problem.ruleId);

/**
 * The findings as the Issue Center receives them: one per affected address.
 *
 * `recommendation` and `evidenceExcerpt` are left empty on purpose: the page
 * shows the plain-language explanation the product writes for these rules, and
 * inventing a developer-facing recommendation would be putting words in the
 * scanner's mouth.
 */
export const EXAMPLE_ISSUES: readonly Issue[] = PROBLEMS.flatMap((problem, group) =>
  problem.pages.map((page, index) => ({
    id: `example-finding-${group + 1}-${index + 1}`,
    scanId: EXAMPLE_SCAN_ID,
    ruleId: problem.ruleId,
    module: problem.module,
    fingerprint: `example-${group + 1}-${index + 1}`,
    severity: problem.severity,
    category: 'example',
    status: 'New',
    targetUrl: `https://${EXAMPLE_DOMAIN}${page}`,
    evidenceType: 'example',
    evidenceRef: '',
    evidenceExcerpt: null,
    localized: null,
    recommendation: '',
    confidence: 1,
    affectedTargets: problem.pages.length,
    // Every address the crawl read, which is what the rule was applicable to;
    // it was the literal 12 beside a `pagesRead` of 12, two names for one fact.
    applicableTargets: CRAWL.pagesRead,
    rulePenalty: 1,
    scoreDelta: 0,
    observedAt: EXAMPLE_DAY,
  })),
);

const GROUPS: readonly IssueRuleGroup[] = PROBLEMS.map((problem) => ({
  ruleId: problem.ruleId,
  module: problem.module,
  severity: problem.severity,
  issues: problem.pages.length,
  openIssues: problem.pages.length,
}));

const TOTAL_FINDINGS = EXAMPLE_ISSUES.length;

export const EXAMPLE_SUMMARY: IssueSummary = {
  total: TOTAL_FINDINGS,
  open: TOTAL_FINDINGS,
  bySeverity: PROBLEMS.reduce<Record<string, number>>(
    (counts, problem) => ({
      ...counts,
      [problem.severity]: (counts[problem.severity] ?? 0) + problem.pages.length,
    }),
    {},
  ),
  groups: GROUPS,
};

/** One section of the example, with the kind of result the cards draw. */
interface ExampleModule {
  readonly module: string;
  readonly score: number | null;
  readonly checks: number;
  readonly done: number;
  /**
   * The `status_reason` the producing side would have written, for a section
   * that did not close every check it had. §15/§16 forbid a `Completed` row
   * from carrying one, so a row with a reason is a `Partial` row — which is
   * what `rowFor` in `apps/api/src/orchestrator/performance-module.ts` writes,
   * and what `resolveScanOutcome` then makes of the scan.
   */
  readonly statusReason?: string;
}

/** A section that closed every check is Completed; one that did not is Partial. */
function moduleStatus(module: ExampleModule): string {
  return module.done === module.checks ? 'Completed' : 'Partial';
}

/**
 * The section's own coverage: the share of its checks that finished.
 *
 * It used to be typed in beside the two counts — `coverage: 0.83` over five of
 * six checks, which is 0.8333 — so the bar and the numbers it was drawn from
 * disagreed in the third decimal place and nothing could notice.
 */
function moduleCoverage(module: ExampleModule): number {
  return module.checks === 0 ? 0 : module.done / module.checks;
}

/**
 * Six sections, scored as a small site plausibly scores: good where nothing was
 * wrong, middling where the findings above are, and never a flat 100.
 *
 * Six and not ten: the page is for understanding a report, and a list of ten
 * sections with four of them saying "nothing to measure here" is a longer page
 * that teaches less. The sections left out are named on the coverage page,
 * which this page links to.
 */
const MODULES: readonly ExampleModule[] = [
  { module: 'SEO', score: 61.5, checks: 24, done: 24 },
  { module: 'Content Quality', score: 74, checks: 9, done: 9 },
  { module: 'UX/Conversion', score: 58, checks: 11, done: 11 },
  // The one section that did not finish, and the honest reason for it: page
  // speed is measured by an outside service, and a measurement run that does
  // not come back is a lost sample rather than a page nobody looked at. It is
  // the live example the coverage sentence needs — "addresses read" is the
  // whole site, "checks done" is not, and only a report that shows both can be
  // used to explain the difference.
  {
    module: 'Performance',
    score: 72.5,
    checks: 6,
    done: 5,
    statusReason: 'PerformanceSamplesIncomplete',
  },
  { module: 'Accessibility', score: 88, checks: 18, done: 18 },
  { module: 'Reliability', score: 96, checks: 7, done: 7 },
];

export const EXAMPLE_SCAN: Scan = {
  id: EXAMPLE_SCAN_ID,
  profileId: 'example-profile',
  plan: 'Complete',
  domain: `https://${EXAMPLE_DOMAIN}`,
  // What `resolveScanOutcome` would have written: every section returned
  // something usable, and one of them did not close every applicable check, so
  // the scan settled Partial with that reason rather than Completed. It is a
  // finished report either way — the page draws the sections, not this row —
  // and a fixture that said Completed over a section at five checks of six was
  // describing a scan the product cannot produce.
  status: 'Partial',
  reportReady: true,
  statusReason: 'IncompleteChecks',
  scope: {
    includeSubdomains: false,
    maxPages: CRAWL.maxPages,
    renderJs: true,
    respectRobots: true,
  },
  crawlSummary: CRAWL,
  rulesetVersion: 'example',
  progress: {
    completedModules: MODULES.length,
    totalModules: MODULES.length,
    scannedUrls: CRAWL.pagesRead,
  },
  startedAt: EXAMPLE_DAY,
  completedAt: '2026-10-02T09:21:00.000Z',
  createdAt: EXAMPLE_DAY,
  modules: [],
};

/**
 * The weights the overall score is made of, as the product makes them.
 *
 * `packages/scoring/src/overall-score.ts` (§15) gives every section of the
 * tariff a weight, multiplies it by that section's own coverage to get the
 * weight the section actually earned, and then divides: the coverage figure is
 * the share of weight that survived, and the score is the section scores
 * averaged by that same earned weight. The headline numbers used to be typed in
 * by hand — 68.4 against six sections whose lowest mean is 75, and 0.94 against
 * module coverages averaging 0.97 — so the dial disagreed with the cards right
 * under it. They are computed here instead, from the sections above, and
 * nothing can be edited into disagreement.
 *
 * Every *scored* section carries the same weight, which the example chooses on
 * purpose: it shows six of Complete's ten sections, and mirroring the tariff's
 * real weight table over a third of it missing would make the sample report
 * "Insufficient data" and teach nothing.
 *
 * "Scored" leaves out the side scores. UX/Conversion and Analytics are scored
 * 0–100 and shown separately, and §15 keeps them out of the overall number —
 * `overall-score.ts` skips every module in `SIDE_SCORE_MODULES` outright. The
 * example gave UX/Conversion a full weight and averaged its 58 into the
 * headline, so the one number on the page was a number the product does not
 * produce, under a card that says in so many words "Separate score, not part of
 * the overall score".
 */
const MODULE_WEIGHT = 1;

/** Whether §15 keeps this section out of the overall score (`SIDE_SCORE_MODULES`). */
function isSideScore(module: string): boolean {
  return SIDE_SCORE_MODULES.includes(module);
}

interface WeightedModule {
  readonly module: string;
  readonly score: number | null;
  readonly tariffWeight: number;
  /** The weight the section earned: its tariff weight times its own coverage. */
  readonly effectiveWeight: number;
}

const WEIGHTED: readonly WeightedModule[] = MODULES.map((module) => {
  const tariffWeight = isSideScore(module.module) ? 0 : MODULE_WEIGHT;
  return {
    module: module.module,
    score: module.score,
    tariffWeight,
    effectiveWeight: tariffWeight * moduleCoverage(module),
  };
});

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Only a section with earned weight and a number scores (§15). */
const SCORED: readonly WeightedModule[] = WEIGHTED.filter(
  (module) => module.effectiveWeight > 0 && module.score !== null,
);

/** The share of the tariff's weight the run actually earned. Exact, as the API stores it. */
const WEIGHTED_COVERAGE =
  sum(WEIGHTED.map((module) => module.effectiveWeight)) /
  sum(WEIGHTED.map((module) => module.tariffWeight));

/** The earned-weight average of the section scores, to two places as the API rounds it. */
const OVERALL_SCORE =
  Math.round(
    (sum(SCORED.map((module) => (module.score ?? 0) * module.effectiveWeight)) /
      sum(SCORED.map((module) => module.effectiveWeight))) *
      100,
  ) / 100;

/**
 * The reading the product would call this coverage, by §15's own thresholds.
 *
 * `'normal'` was asserted beside a comment stating the threshold rather than
 * applying it, so a fixture edit that dropped the coverage under 0.80 would
 * have left the dial claiming a normal reading over a provisional one.
 */
const VERDICT: Dashboard['overall']['verdict'] =
  WEIGHTED_COVERAGE >= WEIGHTED_COVERAGE_NORMAL_MIN
    ? 'normal'
    : WEIGHTED_COVERAGE >= WEIGHTED_COVERAGE_PROVISIONAL_MIN
      ? 'provisional'
      : 'insufficient_data';

export const EXAMPLE_DASHBOARD: Dashboard = {
  scan: EXAMPLE_SCAN,
  overall: {
    verdict: VERDICT,
    score: OVERALL_SCORE,
    weightedCoverage: WEIGHTED_COVERAGE,
    // Only the sections the overall score is made of, as the API's own
    // `buildModuleWeights` does: it emits a row per section of the tariff's
    // score weights, and a side score has none.
    moduleWeights: WEIGHTED.filter((module) => module.tariffWeight > 0).map((module) => ({
      module: module.module,
      tariffWeight: module.tariffWeight,
      effectiveWeight: module.effectiveWeight,
    })),
  },
  modules: MODULES.map((module) => ({
    module: module.module,
    status: moduleStatus(module),
    statusReason: module.statusReason ?? null,
    coverage: moduleCoverage(module),
    score: module.score,
    applicableChecks: module.checks,
    completedApplicableChecks: module.done,
    usableOutput: true,
    metadata: {},
  })),
  geoObservations: [],
};

/** The sections whose score §15 shows on its own, among the ones this page draws. */
export const EXAMPLE_SIDE_SCORE_MODULES: readonly string[] = MODULES.map(
  (module) => module.module,
).filter(isSideScore);

/**
 * One line of the home page's preview, read off a problem of this example.
 *
 * The preview showed three findings on the same made-up salon with numbers of
 * its own: "4 pages have no description" over a fixture that said seven, "12
 * pictures have no text description" over a fixture with no image problem at all.
 * Two invented reports about one invented site is one too many, so the preview
 * names the rule and takes the number from here.
 */
export interface ExamplePreviewLine {
  readonly ruleId: string;
  /**
   * The number the preview prints. The count of findings for a rule that
   * reports one per page or per link; for the image rule it is what the check
   * counted inside those pages, because "12 pictures" is what the line says.
   */
  readonly count: number;
  /** Whose urgency word the line carries, from the problem's own severity. */
  readonly severity: 'Critical' | 'High' | 'Medium' | 'Low';
}

function previewLine(ruleId: string): ExamplePreviewLine {
  const problem = PROBLEMS.find((candidate) => candidate.ruleId === ruleId);
  if (problem === undefined) {
    throw new Error(`the example has no ${ruleId} to preview`);
  }
  return {
    ruleId,
    count: problem.itemsFound ?? problem.pages.length,
    severity: problem.severity,
  };
}

/**
 * What the home page previews: three of the example's six problems, in the
 * order the full example lists them, with the site's size beside them.
 */
export const EXAMPLE_HOME_PREVIEW = {
  lines: ['SEO-TECH-006', 'SEO-ONPAGE-002', 'SEO-ONPAGE-005'].map(previewLine),
  /** Six — what the lead has to say the three are an extract of. */
  problems: PROBLEMS.length,
  pagesRead: CRAWL.pagesRead,
} as const;
