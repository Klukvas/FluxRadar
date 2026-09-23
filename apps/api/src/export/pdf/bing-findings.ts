// The Bing findings, as the downloadable report says them.
//
// `integrations/bing/checks.ts` builds these sentences in English when the scan
// runs and stores them with the module row. The document is written in the
// reader's language, months later, so the stored sentence cannot be the one on
// the page — that is the same failure `copy.ts` exists to prevent for the rest
// of the document, and the browser report fixes with `bing-findings-copy.ts`.
//
// The finding's CODE and its EVIDENCE are the stable parts; the sentence is
// rebuilt from them. The stored English is still used, as the fallback for a
// code this build has no copy for and for one whose evidence is not what its
// sentence needs: a finding the reader cannot read is worse than an English one.
//
// The numbers are written plainly, without digit grouping, because every other
// figure in this document is (see `bingTotals` and the query table in render.ts).

import type { FindingLanguage } from '@fluxradar/rules';

/** The codes `bingFindings` produces. Anything else falls back to its own text. */
type BingFindingCode =
  | 'BING-TRAFFIC-DROP'
  | 'BING-NO-CLICKS'
  | 'BING-LOW-CTR'
  | 'BING-PARTIAL-PERIOD'
  | 'BING-QUERY-CONCENTRATION'
  | 'BING-READ-UNAVAILABLE';

type Evidence = Readonly<Record<string, number | string | null>>;

/** One finding as it was stored. Every field is checked before it is read. */
export interface StoredBingFinding {
  readonly code: string;
  readonly severity: 'info' | 'attention';
  readonly summary: string;
  readonly recommendation: string;
  readonly evidence: Evidence;
}

interface FindingCopy {
  /** Null when the evidence does not carry what this sentence states. */
  readonly summary: (evidence: Evidence) => string | null;
  readonly recommendation: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function evidenceOf(value: unknown): Evidence {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      typeof entry === 'number' || typeof entry === 'string' || entry === null
        ? [[key, entry] as const]
        : [],
    ),
  );
}

/**
 * The findings stored beside the Bing snapshot, or none. Checked rather than
 * asserted: a report written before the section existed, or by a later release,
 * must render without them instead of throwing halfway through the document.
 */
export function storedBingFindings(value: unknown): readonly StoredBingFinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): readonly StoredBingFinding[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const code = text(record.code);
    if (code === '') return [];
    return [
      {
        code,
        severity: record.severity === 'attention' ? 'attention' : 'info',
        summary: text(record.summary),
        recommendation: text(record.recommendation),
        evidence: evidenceOf(record.evidence),
      },
    ];
  });
}

function number(evidence: Evidence, key: string): number | null {
  const value = evidence[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

type ReadName = 'traffic' | 'queries';

function missingReads(
  evidence: Evidence,
  labels: Readonly<Record<ReadName, string>>,
  conjunction: string,
): string | null {
  const value = evidence.unavailableReads;
  if (typeof value !== 'string') return null;
  const reads = value
    .split(',')
    .map((read) => read.trim())
    .filter((read): read is ReadName => read === 'traffic' || read === 'queries');
  return reads.length === 0 ? null : reads.map((read) => labels[read]).join(conjunction);
}

const EN: Readonly<Record<BingFindingCode, FindingCopy>> = {
  'BING-TRAFFIC-DROP': {
    summary: (evidence) => {
      const change = number(evidence, 'changeRatio');
      return change === null
        ? null
        : `Bing clicks fell ${percent(Math.abs(change))} against the previous period.`;
    },
    recommendation:
      'Check Bing Webmaster Tools for crawl or indexing changes on the pages that used to ' +
      'receive these clicks, and confirm they are still reachable and indexable.',
  },
  'BING-NO-CLICKS': {
    summary: (evidence) => {
      const impressions = number(evidence, 'impressions');
      return impressions === null
        ? null
        : `Bing showed this site ${impressions} times in the period and sent no clicks.`;
    },
    recommendation:
      'Review the titles and descriptions Bing displays for the pages that are being shown: ' +
      'impressions without clicks usually means the snippet does not answer the query.',
  },
  'BING-LOW-CTR': {
    summary: (evidence) => {
      const ctr = number(evidence, 'ctr');
      const impressions = number(evidence, 'impressions');
      return ctr === null || impressions === null
        ? null
        : `Bing click-through is ${percent(ctr)} over ${impressions} impressions.`;
    },
    recommendation:
      'Compare the titles and meta descriptions of the top Bing queries with what a searcher ' +
      'asked for; a click-through this low is usually a snippet problem, not a ranking one.',
  },
  'BING-PARTIAL-PERIOD': {
    summary: (evidence) => {
      const reported = number(evidence, 'reportedDays');
      const window = number(evidence, 'windowDays');
      return reported === null || window === null
        ? null
        : `Bing reported ${reported} of the ${window} days in this period.`;
    },
    recommendation:
      'Treat these totals as covering the days listed rather than the whole period. A site ' +
      'recently added to Bing Webmaster Tools reports fewer days until its history builds up.',
  },
  'BING-QUERY-CONCENTRATION': {
    summary: (evidence) => {
      const share = number(evidence, 'share');
      const counted = number(evidence, 'queriesCounted');
      if (share === null) return null;
      if (evidence.queriesComplete === 'yes') {
        return `One query brings ${percent(share)} of this site's Bing clicks in this period.`;
      }
      return counted === null
        ? null
        : `One query brings ${percent(share)} of the clicks across the ${counted} queries Bing ` +
            'listed for this period.';
    },
    recommendation:
      'Traffic resting on a single query is fragile. Look for the next queries the site already ' +
      'gets impressions for and give each one a page that answers it directly.',
  },
  'BING-READ-UNAVAILABLE': {
    summary: (evidence) => {
      const missing = missingReads(
        evidence,
        { traffic: 'daily clicks and impressions', queries: 'the top search queries' },
        ' and ',
      );
      return missing === null ? null : `Bing did not return ${missing} for this period.`;
    },
    recommendation:
      'Nothing on the site caused this. The figures that are missing are left blank rather than ' +
      'shown as zero; the next scan asks Bing again.',
  },
};

const UK: Readonly<Record<BingFindingCode, FindingCopy>> = {
  'BING-TRAFFIC-DROP': {
    summary: (evidence) => {
      const change = number(evidence, 'changeRatio');
      return change === null
        ? null
        : `Кліки з Bing впали на ${percent(Math.abs(change))} порівняно з попереднім періодом.`;
    },
    recommendation:
      'Перевірте у Bing Webmaster Tools, чи не змінилося сканування або індексування сторінок, ' +
      'які раніше отримували ці кліки, і чи лишаються вони доступними та придатними до індексації.',
  },
  'BING-NO-CLICKS': {
    summary: (evidence) => {
      const impressions = number(evidence, 'impressions');
      return impressions === null
        ? null
        : `Bing показав цей сайт ${impressions} разів за період і не дав жодного кліку.`;
    },
    recommendation:
      'Перегляньте заголовки та описи, які Bing показує для цих сторінок: покази без кліків ' +
      'зазвичай означають, що сніпет не відповідає на запит.',
  },
  'BING-LOW-CTR': {
    summary: (evidence) => {
      const ctr = number(evidence, 'ctr');
      const impressions = number(evidence, 'impressions');
      return ctr === null || impressions === null
        ? null
        : `Клікабельність у Bing — ${percent(ctr)} на ${impressions} показів.`;
    },
    recommendation:
      'Порівняйте заголовки та meta description найчастіших запитів Bing із тим, що шукала ' +
      'людина: така низька клікабельність — це зазвичай проблема сніпета, а не позиції.',
  },
  'BING-PARTIAL-PERIOD': {
    summary: (evidence) => {
      const reported = number(evidence, 'reportedDays');
      const window = number(evidence, 'windowDays');
      return reported === null || window === null
        ? null
        : `Bing надав дані за ${reported} із ${window} днів цього періоду.`;
    },
    recommendation:
      'Читайте ці підсумки як такі, що охоплюють лише названі дні, а не весь період. Сайт, ' +
      'нещодавно доданий до Bing Webmaster Tools, показує менше днів, поки накопичується історія.',
  },
  'BING-QUERY-CONCENTRATION': {
    summary: (evidence) => {
      const share = number(evidence, 'share');
      const counted = number(evidence, 'queriesCounted');
      if (share === null) return null;
      if (evidence.queriesComplete === 'yes') {
        return `Один запит дає ${percent(share)} усіх кліків цього сайту з Bing за цей період.`;
      }
      return counted === null
        ? null
        : `Один запит дає ${percent(share)} кліків серед ${counted} запитів, які Bing показав ` +
            'за цей період.';
    },
    recommendation:
      'Трафік, що тримається на одному запиті, — крихкий. Знайдіть наступні запити, за якими ' +
      'сайт уже отримує покази, і дайте кожному сторінку, яка прямо на нього відповідає.',
  },
  'BING-READ-UNAVAILABLE': {
    summary: (evidence) => {
      const missing = missingReads(
        evidence,
        { traffic: 'щоденних кліків і показів', queries: 'списку найчастіших запитів' },
        ' і ',
      );
      return missing === null ? null : `Bing не надав ${missing} за цей період.`;
    },
    recommendation:
      'Причина не в сайті. Відсутні числа лишено порожніми, а не показано як нулі; наступне ' +
      'сканування запитає Bing знову.',
  },
};

const BING_FINDING_COPY: Readonly<
  Record<FindingLanguage, Readonly<Record<BingFindingCode, FindingCopy>>>
> = { en: EN, uk: UK };

/** The finding as one sentence plus one instruction, in the document's language. */
export function bingFindingText(
  finding: StoredBingFinding,
  language: FindingLanguage,
): { readonly summary: string; readonly recommendation: string } {
  const copy = BING_FINDING_COPY[language][finding.code as BingFindingCode];
  if (copy === undefined) {
    return { summary: finding.summary, recommendation: finding.recommendation };
  }
  const summary = copy.summary(finding.evidence);
  return { summary: summary ?? finding.summary, recommendation: copy.recommendation };
}
