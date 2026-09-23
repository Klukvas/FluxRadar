// The Performance findings, as the downloadable report says them.
//
// `integrations/performance/findings.ts` builds these sentences in English while
// the scan runs and stores them with the module row. The document is written in
// the reader's language, so the stored sentence cannot be the one on the page —
// the same failure `copy.ts` exists to prevent for the rest of the document and
// `bing-findings.ts` prevents for the Bing notes.
//
// This one mattered more than most: the browser report does not render
// `audit.findings` at all, so the downloaded file is the only place a customer
// ever meets them. A Ukrainian report was printing five English paragraphs under
// Ukrainian headings, with an English `INFO` badge above them.
//
// THE RULE ID AND THE EVIDENCE ARE THE STABLE PARTS; the sentence is rebuilt from
// them, and the evidence is read once and phrased twice so the two languages
// cannot disagree about a number. The stored English is kept as the fallback for
// a rule this build has no copy for and for one whose evidence is not what its
// sentence needs: a finding the reader cannot read is worse than an English one.
//
// Units are written in the reader's language here ("1.9 с", "мс"), unlike the
// metric acronyms in the tables — a sentence is prose, and a column heading is
// the token the provider's own console shows.

import type { FindingLanguage } from '@fluxradar/rules';

import type { DeviceStrategy } from '../../integrations/performance/index.ts';
import { REPORT_COPY } from './copy.ts';

type Evidence = Readonly<Record<string, number | string | boolean | null>>;

/** One finding as the audit stored it. Every field is checked before it is read. */
export interface StoredPerformanceFinding {
  readonly ruleId: string;
  readonly severity: string;
  readonly url: string;
  readonly strategy: DeviceStrategy | null;
  readonly summary: string;
  readonly recommendation: string;
  readonly evidence: Evidence;
}

/** The same sentence in both report languages. */
type Sentences = Readonly<Record<FindingLanguage, string>>;

interface FindingContext {
  readonly evidence: Evidence;
  readonly strategy: DeviceStrategy | null;
}

interface RuleCopy {
  /** Null when the evidence does not carry what the sentence states. */
  readonly summary: (context: FindingContext, language: FindingLanguage) => string | null;
  readonly advice: (context: FindingContext, language: FindingLanguage) => string | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function evidenceOf(value: unknown): Evidence {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      typeof entry === 'number' ||
      typeof entry === 'string' ||
      typeof entry === 'boolean' ||
      entry === null
        ? [[key, entry] as const]
        : [],
    ),
  );
}

/**
 * The findings stored inside the audit, or none. Checked rather than asserted: a
 * row written before the audit existed, or by a later release, must render
 * without them instead of throwing halfway through the document.
 */
export function storedPerformanceFindings(value: unknown): readonly StoredPerformanceFinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): readonly StoredPerformanceFinding[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const ruleId = text(record.ruleId);
    if (ruleId === '') return [];
    const strategy = record.strategy;
    return [
      {
        ruleId,
        severity: text(record.severity),
        url: text(record.url),
        strategy: strategy === 'mobile' || strategy === 'desktop' ? strategy : null,
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

// ── Figures, in the reader's own units ──────────────────────────────────────
//
// The same formatters the metric tables use, so one figure is not written two
// ways in one document.

function ms(value: number, language: FindingLanguage): string {
  return REPORT_COPY[language].duration(value);
}

function bytes(value: number, language: FindingLanguage): string {
  return REPORT_COPY[language].size(value);
}

function score(value: number): string {
  return value.toFixed(3);
}

/** Where the measurement was taken, as a clause, or nothing when it has no device. */
const DEVICE_CLAUSE: Readonly<Record<FindingLanguage, Readonly<Record<DeviceStrategy, string>>>> = {
  en: { mobile: ' on mobile', desktop: ' on desktop' },
  uk: { mobile: ' на мобільному', desktop: ' на компʼютері' },
};

function deviceClause(strategy: DeviceStrategy | null, language: FindingLanguage): string {
  return strategy === null ? '' : DEVICE_CLAUSE[language][strategy];
}

// ── Metric names, as the sentences call them ────────────────────────────────

const TTFB_LABEL: Sentences = { en: 'Time to First Byte', uk: 'Час до першого байта (TTFB)' };
const LCP_LABEL: Sentences = {
  en: 'Largest Contentful Paint',
  uk: 'Відмальовування найбільшого елемента (LCP)',
};
const CLS_LABEL: Sentences = { en: 'Cumulative Layout Shift', uk: 'Зсув макета (CLS)' };
const TBT_LABEL: Sentences = { en: 'Total Blocking Time', uk: 'Загальний час блокування (TBT)' };
const INP_LABEL: Sentences = {
  en: 'Interaction to Next Paint',
  uk: 'Затримка реакції на дію (INP)',
};

interface MetricParams {
  readonly label: string;
  readonly value: string;
  readonly bound: string;
  readonly where: string;
}

const METRIC_SENTENCE: Readonly<Record<FindingLanguage, (params: MetricParams) => string>> = {
  en: (params) =>
    `${params.label} is ${params.value}${params.where} (good is under ${params.bound}).`,
  uk: (params) => `${params.label} — ${params.value}${params.where} (добре — до ${params.bound}).`,
};

type Unit = 'ms' | 'score';

function formatted(value: number, unit: Unit, language: FindingLanguage): string {
  return unit === 'ms' ? ms(value, language) : score(value);
}

/** One lab metric that crossed a threshold: the median, the device and the bound. */
function metricSummary(label: Sentences, unit: Unit): RuleCopy['summary'] {
  return (context, language) => {
    const median = number(context.evidence, 'median');
    const good = number(context.evidence, 'good');
    if (median === null || good === null) return null;
    return METRIC_SENTENCE[language]({
      label: label[language],
      value: formatted(median, unit, language),
      bound: formatted(good, unit, language),
      where: deviceClause(context.strategy, language),
    });
  };
}

/** A sentence that needs one figure out of the evidence, formatted as bytes. */
function savingsSummary(sentence: Readonly<Record<FindingLanguage, (amount: string) => string>>) {
  return (context: FindingContext, language: FindingLanguage): string | null => {
    const saving = number(context.evidence, 'savingsBytes');
    return saving === null ? null : sentence[language](bytes(saving, language));
  };
}

function always(sentences: Sentences): RuleCopy['advice'] {
  return (_context, language) => sentences[language];
}

// ── The advice, one paragraph per rule ──────────────────────────────────────
//
// The English is the same text `findings.ts` produced, so an English document
// reads exactly as it did before this catalogue existed.

const TTFB_ADVICE: Sentences = {
  en:
    'The server spends this long before it sends the first byte. Cache the HTML response, move ' +
    'work out of the request path, or put a CDN in front of the origin — nothing on the page ' +
    'can start before this finishes.',
  uk:
    'Стільки часу сервер витрачає, перш ніж надіслати перший байт. Кешуйте HTML-відповідь, ' +
    'приберіть роботу з шляху запиту або поставте CDN перед сервером — ніщо на сторінці не ' +
    'починається, поки це не завершиться.',
};

const LCP_ADVICE: Sentences = {
  en:
    'Find the element Lighthouse names as the largest paint and make it arrive sooner: preload ' +
    'its image or font, serve it at the size it is displayed, and remove anything that blocks ' +
    'rendering before it.',
  uk:
    'Знайдіть елемент, який Lighthouse називає найбільшим, і зробіть так, щоб він приходив ' +
    'раніше: попередньо завантажуйте його зображення або шрифт, віддавайте його в тому розмірі, ' +
    'у якому він показується, і приберіть усе, що блокує відмальовування до нього.',
};

const CLS_ADVICE: Sentences = {
  en:
    'Content moves while the page loads. Give images and embeds explicit width and height, ' +
    'reserve space for anything injected after load, and avoid inserting banners above content ' +
    'that is already visible.',
  uk:
    'Вміст рухається, поки сторінка завантажується. Задайте зображенням і вставкам явні ширину ' +
    'та висоту, зарезервуйте місце для всього, що додається після завантаження, і не вставляйте ' +
    'банери над вмістом, який уже видно.',
};

const TBT_ADVICE: Sentences = {
  en:
    'The main thread is busy this long during load, so taps and clicks in that window feel ' +
    'stuck. Split or defer the largest scripts and move work off the main thread. This is a lab ' +
    'measurement, not Interaction to Next Paint — it predicts responsiveness rather than ' +
    'measuring it.',
  uk:
    'Стільки часу головний потік зайнятий під час завантаження, тому дотики й клацання в цьому ' +
    'вікні відчуваються застряглими. Розділіть або відкладіть найбільші скрипти й винесіть ' +
    'роботу з головного потоку. Це лабораторний показник, а не INP: він прогнозує реакцію, а не ' +
    'вимірює її.',
};

const UNUSED_JS_ADVICE: Sentences = {
  en:
    'Split the bundle so each page ships only the code it runs, and load the rest on demand. ' +
    'Unused JavaScript costs download time and parse time on every visit.',
  uk:
    'Розділіть бандл так, щоб кожна сторінка віддавала лише той код, який виконує, а решту ' +
    'завантажуйте за потреби. Невикористаний JavaScript коштує часу на завантаження й розбір ' +
    'під час кожного відвідування.',
};

const COMPRESSION_ADVICE: Sentences = {
  en:
    'Enable gzip or Brotli for HTML, CSS, JavaScript and SVG at the server or CDN. It is a ' +
    'configuration change with no effect on the content itself.',
  uk:
    'Увімкніть gzip або Brotli для HTML, CSS, JavaScript і SVG на сервері чи CDN. Це зміна ' +
    'налаштувань, яка не впливає на сам вміст.',
};

const IMAGES_ADVICE: Sentences = {
  en: 'Serve WebP or AVIF with a fallback, and size each image for the box it is displayed in.',
  uk:
    'Віддавайте WebP або AVIF із резервним форматом і готуйте кожне зображення під той розмір, ' +
    'у якому воно показується.',
};

const CACHE_ADVICE: Sentences = {
  en:
    'Give fingerprinted static assets a long max-age with immutable, so a returning visitor ' +
    'downloads them once instead of on every visit.',
  uk:
    'Задайте статичним файлам з відпечатком у назві довгий max-age з immutable, щоб відвідувач, ' +
    'який повернувся, завантажував їх один раз, а не щоразу.',
};

const WEIGHT_ADVICE: Sentences = {
  en:
    'Find the largest few responses and deal with those first — usually one hero image, one ' +
    'font family or one third-party script accounts for most of the excess.',
  uk:
    'Знайдіть кілька найбільших відповідей і почніть з них — зазвичай більшу частину перевищення ' +
    'дає одне велике зображення, одна гарнітура шрифту або один сторонній скрипт.',
};

const REQUESTS_ADVICE: Sentences = {
  en:
    'Bundle what is yours and audit what is not: third-party tags are the usual reason a ' +
    'request count climbs without the page gaining anything.',
  uk:
    'Обʼєднайте те, що ваше, і перевірте те, що ні: сторонні теги — звична причина, чому ' +
    'кількість запитів зростає, а сторінка від цього нічого не отримує.',
};

const BLOCKING_ADVICE: Sentences = {
  en:
    'Inline the styles the first screen needs and load the rest asynchronously; mark scripts ' +
    'that are not needed for first paint as defer.',
  uk:
    'Вбудуйте стилі, потрібні для першого екрана, а решту завантажуйте асинхронно; скрипти, не ' +
    'потрібні для першого відмальовування, позначте як defer.',
};

const UNSTABLE_ADVICE: Sentences = {
  en:
    'Measure again when the site is not under load before acting on these numbers. Spread ' +
    'this wide usually means a shared host, a cold cache, or a third party that is sometimes ' +
    'slow.',
  uk:
    'Перед тим як діяти за цими числами, виміряйте ще раз, коли сайт не під навантаженням. ' +
    'Такий розкид зазвичай означає спільний хостинг, холодний кеш або сторонній сервіс, який ' +
    'іноді відповідає повільно.',
};

const INP_MEASURED_ADVICE: Sentences = {
  en:
    'Something on the page takes too long to respond to a tap or a click. Break up long tasks, ' +
    'defer work triggered by input, and check third-party scripts that run on interaction.',
  uk:
    'Щось на сторінці занадто довго реагує на дотик або клацання. Розбийте довгі задачі, ' +
    'відкладіть роботу, яку запускає введення, і перевірте сторонні скрипти, що виконуються під ' +
    'час взаємодії.',
};

const FIELD_LCP_ADVICE: Sentences = {
  en:
    'This is what visitors actually experienced, across their own devices and connections. ' +
    'It outranks the lab number above when the two disagree.',
  uk:
    'Це те, що справді бачили відвідувачі — на власних пристроях і зʼєднаннях. Якщо ці дані ' +
    'розходяться з лабораторними вище, вагоміші саме вони.',
};

/** Why the field read has no INP, keyed by the state `crux.ts` recorded. */
const FIELD_STATE_ADVICE: Readonly<Record<string, Sentences>> = {
  not_configured: {
    en:
      'Real-visitor data was not requested for this scan: no Chrome UX Report API key is ' +
      'configured for this deployment.',
    uk:
      'Дані реальних відвідувачів для цього сканування не запитували: у цьому розгортанні не ' +
      'налаштовано ключ Chrome UX Report.',
  },
  no_data: {
    en:
      'The Chrome UX Report has no record for this origin, which means too few Chrome visitors ' +
      'to report on. A lab run never produces this metric.',
    uk:
      'Chrome UX Report не має запису для цього сайту — відвідувачів Chrome для звіту надто ' +
      'мало. Лабораторний запуск цього показника не дає.',
  },
  request_failed: {
    en: 'The Chrome UX Report did not answer. The lab measurements are unaffected.',
    uk: 'Chrome UX Report не відповів. Лабораторні вимірювання це не змінює.',
  },
};

// ── The rules ───────────────────────────────────────────────────────────────

const WEIGHT_SENTENCE: Readonly<
  Record<FindingLanguage, (amount: string, budget: string) => string>
> = {
  en: (amount, budget) => `The page transfers ${amount}, over the ${budget} budget.`,
  uk: (amount, budget) => `Сторінка передає ${amount}, що перевищує бюджет ${budget}.`,
};

const REQUESTS_SENTENCE: Readonly<
  Record<FindingLanguage, (count: number, budget: number) => string>
> = {
  en: (count, budget) => `The page makes ${count} requests, over the ${budget} budget.`,
  uk: (count, budget) => `Сторінка робить ${count} запитів, що перевищує бюджет ${budget}.`,
};

const BLOCKING_SENTENCE: Readonly<Record<FindingLanguage, (amount: string) => string>> = {
  en: (amount) => `Render-blocking resources delay first paint by about ${amount}.`,
  uk: (amount) => `Ресурси, що блокують відмальовування, затримують перший кадр на ~${amount}.`,
};

const UNSTABLE_SENTENCE: Readonly<Record<FindingLanguage, (metrics: string) => string>> = {
  en: (metrics) =>
    `Repeated runs of this page disagreed on ${metrics}; the medians here are provisional.`,
  uk: (metrics) =>
    `Повторні запуски цієї сторінки розійшлися за ${metrics}; наведені медіани попередні.`,
};

const INP_UNAVAILABLE_SENTENCE: Sentences = {
  en: 'Interaction to Next Paint could not be measured for this site.',
  uk: 'Затримку реакції на дію (INP) для цього сайту виміряти не вдалося.',
};

const FIELD_SENTENCE: Readonly<
  Record<FindingLanguage, (label: string, value: string, bound: string | null) => string>
> = {
  en: (label, value, bound) =>
    bound === null
      ? `Real visitors' ${label} is ${value} at the 75th percentile.`
      : `Real visitors' ${label} is ${value} at the 75th percentile (good is under ${bound}).`,
  uk: (label, value, bound) =>
    bound === null
      ? `${label} у реальних відвідувачів — ${value} на 75-му перцентилі.`
      : `${label} у реальних відвідувачів — ${value} на 75-му перцентилі (добре — до ${bound}).`,
};

/** The metrics an unstable-measurement finding names, as the evidence lists them. */
const UNSTABLE_METRIC_LABELS: Readonly<Record<string, string>> = {
  lcpMs: 'LCP',
  ttfbMs: 'TTFB',
  tbtMs: 'TBT',
};

function unstableMetrics(evidence: Evidence): readonly string[] {
  return Object.keys(UNSTABLE_METRIC_LABELS).flatMap((key) =>
    number(evidence, key) === null ? [] : [UNSTABLE_METRIC_LABELS[key] ?? key],
  );
}

const RULES: Readonly<Record<string, RuleCopy>> = {
  'PERF-LAB-TTFB': { summary: metricSummary(TTFB_LABEL, 'ms'), advice: always(TTFB_ADVICE) },
  'PERF-LAB-LCP': { summary: metricSummary(LCP_LABEL, 'ms'), advice: always(LCP_ADVICE) },
  'PERF-LAB-CLS': { summary: metricSummary(CLS_LABEL, 'score'), advice: always(CLS_ADVICE) },
  'PERF-LAB-TBT': { summary: metricSummary(TBT_LABEL, 'ms'), advice: always(TBT_ADVICE) },
  'PERF-RES-UNUSED-JS': {
    summary: savingsSummary({
      en: (amount) => `${amount} of JavaScript is downloaded and never used on this page.`,
      uk: (amount) => `${amount} JavaScript завантажується і не використовується на цій сторінці.`,
    }),
    advice: always(UNUSED_JS_ADVICE),
  },
  'PERF-RES-COMPRESSION': {
    summary: savingsSummary({
      en: (amount) => `${amount} of text is served without compression.`,
      uk: (amount) => `${amount} тексту віддається без стиснення.`,
    }),
    advice: always(COMPRESSION_ADVICE),
  },
  'PERF-RES-IMAGES': {
    summary: savingsSummary({
      en: (amount) => `${amount} could be saved by serving images in a modern format.`,
      uk: (amount) => `${amount} можна зекономити, віддаючи зображення в сучасному форматі.`,
    }),
    advice: always(IMAGES_ADVICE),
  },
  'PERF-CACHE-TTL': {
    summary: savingsSummary({
      en: (amount) => `${amount} of static assets are served with a short or missing cache life.`,
      uk: (amount) => `${amount} статичних файлів віддається з коротким або відсутнім кешуванням.`,
    }),
    advice: always(CACHE_ADVICE),
  },
  'PERF-RES-WEIGHT': {
    summary: (context, language) => {
      const weight = number(context.evidence, 'totalBytes');
      const budget = number(context.evidence, 'budgetBytes');
      return weight === null || budget === null
        ? null
        : WEIGHT_SENTENCE[language](bytes(weight, language), bytes(budget, language));
    },
    advice: always(WEIGHT_ADVICE),
  },
  'PERF-RES-REQUESTS': {
    summary: (context, language) => {
      const requests = number(context.evidence, 'requestCount');
      const budget = number(context.evidence, 'budget');
      return requests === null || budget === null
        ? null
        : REQUESTS_SENTENCE[language](Math.round(requests), budget);
    },
    advice: always(REQUESTS_ADVICE),
  },
  'PERF-RENDER-BLOCKING': {
    summary: (context, language) => {
      const blocking = number(context.evidence, 'blockingMs');
      return blocking === null ? null : BLOCKING_SENTENCE[language](ms(blocking, language));
    },
    advice: always(BLOCKING_ADVICE),
  },
  'PERF-MEASUREMENT-UNSTABLE': {
    summary: (context, language) => {
      const metrics = unstableMetrics(context.evidence);
      return metrics.length === 0 ? null : UNSTABLE_SENTENCE[language](metrics.join(', '));
    },
    advice: always(UNSTABLE_ADVICE),
  },
  'PERF-FIELD-INP': {
    summary: (context, language) => {
      const p75 = number(context.evidence, 'p75');
      if (p75 === null) {
        // The absence is the finding: CrUX had nothing, and the document says so
        // rather than leaving a reader to wonder where INP went.
        return typeof context.evidence.fieldState === 'string'
          ? INP_UNAVAILABLE_SENTENCE[language]
          : null;
      }
      const good = number(context.evidence, 'good');
      return FIELD_SENTENCE[language](
        INP_LABEL[language],
        ms(p75, language),
        good === null ? null : ms(good, language),
      );
    },
    advice: (context, language) => {
      if (number(context.evidence, 'p75') !== null) return INP_MEASURED_ADVICE[language];
      const state = context.evidence.fieldState;
      const stated = typeof state === 'string' ? FIELD_STATE_ADVICE[state] : undefined;
      return stated?.[language] ?? null;
    },
  },
  'PERF-FIELD-LCP': {
    summary: (context, language) => {
      const p75 = number(context.evidence, 'p75');
      return p75 === null
        ? null
        : FIELD_SENTENCE[language](LCP_LABEL[language], ms(p75, language), null);
    },
    advice: always(FIELD_LCP_ADVICE),
  },
};

/** The finding as one sentence plus one instruction, in the document's language. */
export function performanceFindingText(
  finding: StoredPerformanceFinding,
  language: FindingLanguage,
): { readonly summary: string; readonly recommendation: string } {
  const rule = RULES[finding.ruleId];
  if (rule === undefined) {
    return { summary: finding.summary, recommendation: finding.recommendation };
  }
  const context: FindingContext = { evidence: finding.evidence, strategy: finding.strategy };
  return {
    summary: rule.summary(context, language) ?? finding.summary,
    recommendation: rule.advice(context, language) ?? finding.recommendation,
  };
}
