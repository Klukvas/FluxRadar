// What each Bing finding says, in the reader's language.
//
// The API builds these sentences in English at scan time and stores them with
// the report (`apps/api/src/integrations/bing/checks.ts`). A report is read in
// either language long afterwards, so the stored sentence cannot be the one on
// screen: a Ukrainian reader was getting "Bing clicks fell 45.0% against the
// previous period." under a Ukrainian heading. The finding's CODE and its
// EVIDENCE are the stable parts, and this file turns them back into a sentence.
//
// Kept beside `i18n.ts` rather than inside it, as `findings-copy.ts` is: the
// shared file is already past the size anyone can review.
//
// The English sentence the API sent is still used — as the fallback for a code
// this build has no copy for, and for one whose evidence is not what its
// sentence needs. A finding a reader cannot read is worse than an English one.

import type { BingFinding } from './api';
import { formatCount } from './GoogleDataPanel';
import type { Language } from './i18n';

/** The codes `bingFindings` produces. Anything else falls back to the API's text. */
type BingFindingCode =
  | 'BING-TRAFFIC-DROP'
  | 'BING-NO-CLICKS'
  | 'BING-LOW-CTR'
  | 'BING-PARTIAL-PERIOD'
  | 'BING-QUERY-CONCENTRATION'
  | 'BING-READ-UNAVAILABLE';

type Evidence = Readonly<Record<string, number | string | null>>;

interface FindingCopy {
  /** Null when the evidence does not carry what this sentence states. */
  readonly summary: (evidence: Evidence) => string | null;
  readonly recommendation: string;
}

function number(evidence: Evidence, key: string): number | null {
  const value = evidence[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** The two Bing reads, named the way a reader would recognise them. */
type ReadName = 'traffic' | 'queries';

function readsIn(evidence: Evidence): readonly ReadName[] {
  const value = evidence.unavailableReads;
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((read) => read.trim())
    .filter((read): read is ReadName => read === 'traffic' || read === 'queries');
}

function missingReads(
  evidence: Evidence,
  labels: Readonly<Record<ReadName, string>>,
  conjunction: string,
): string | null {
  const reads = readsIn(evidence);
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
        : `Bing showed this site ${formatCount(impressions)} times in the period and sent no clicks.`;
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
        : `Bing click-through is ${percent(ctr)} over ${formatCount(impressions)} impressions.`;
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
      // The same distinction the API makes: a share of the site's whole period,
      // or a share of the queries Bing actually listed. Claiming the first when
      // only the second is known is the number an owner would act on wrongly.
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
        : `Bing показав цей сайт ${formatCount(impressions)} разів за період і не дав жодного кліку.`;
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
        : `Клікабельність у Bing — ${percent(ctr)} на ${formatCount(impressions)} показів.`;
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
  Record<Language, Readonly<Record<BingFindingCode, FindingCopy>>>
> = { en: EN, uk: UK };

/** The finding as one sentence plus one instruction, in the reader's language. */
export function bingFindingText(
  finding: BingFinding,
  language: Language,
): { readonly summary: string; readonly recommendation: string } {
  const copy = BING_FINDING_COPY[language][finding.code as BingFindingCode];
  if (copy === undefined) {
    return { summary: finding.summary, recommendation: finding.recommendation };
  }
  const summary = copy.summary(finding.evidence ?? {});
  return {
    summary: summary ?? finding.summary,
    recommendation: copy.recommendation,
  };
}
