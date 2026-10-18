// What a finding recorded about the owner's own page, in one plain line.
//
// A problem row said "Page name for search results is missing, too short or too
// long — on 1 page", and the page and the actual name sat behind a button. The
// rules record both (the message code says which state, its values say what
// was there), so the row can say "Name now: “Home”, 4 characters; aim for
// 10–70" instead. Each line is keyed by the rule's message code and reads only
// the values that code is filled with; a line whose values are missing is not
// shown at all (`finding-evidence.ts` falls back to the recorded sentence).
//
// Page text reaches these lines already cleaned and shortened, and React
// renders them as text.

import { takesUkSingular, ukCountForm, ukPagesOf, type Language } from './i18n';

/** The recorded values of one finding, read by name. A missing value throws `MissingEvidenceValue`. */
export interface EvidenceValues {
  /** Page text (a title, a header value), cleaned and shortened for a row. */
  readonly text: (name: string) => string;
  readonly count: (name: string) => number;
  /** A count that may be absent, such as the recommended range's ends. */
  readonly optionalCount: (name: string) => number | null;
}

export type EvidenceLine = (values: EvidenceValues) => string;

export interface EvidenceCopy {
  readonly lines: Readonly<Record<string, EvidenceLine>>;
  /** The findings a row had no room to name: "and 5 more". */
  readonly more: (count: number) => string;
  /** The accessible name of the list of named findings. */
  readonly listLabel: string;
}

const enChars = (count: number): string => `${count} ${count === 1 ? 'character' : 'characters'}`;
const ukChars = (count: number): string =>
  `${count} ${ukCountForm(count, 'символ', 'символи', 'символів')}`;

// The helpers take the recorded numbers, not the values reader: each line names
// at its call site every value it reads, which is what the API's parity test
// (evidence-lines-parity.test.ts) checks against the message catalogue.

function enAim(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `aim for ${min}–${max}`;
  if (min !== null) return `aim for at least ${min}`;
  return max === null ? '' : `aim for at most ${max}`;
}

function ukAim(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `а треба від ${min} до ${max}`;
  if (min !== null) return `а треба щонайменше ${min}`;
  return max === null ? '' : `а треба не більше ${max}`;
}

/** "4 characters; aim for 10–70", or without the aim when no range was recorded. */
function enLength(length: number, min: number | null, max: number | null): string {
  const aim = enAim(min, max);
  return aim === '' ? enChars(length) : `${enChars(length)}; ${aim}`;
}

function ukLength(length: number, min: number | null, max: number | null): string {
  const aim = ukAim(min, max);
  return aim === '' ? ukChars(length) : `${ukChars(length)}, ${aim}`;
}

const enLinkingPages = (count: number): string =>
  `${count} other ${count === 1 ? 'page links' : 'pages link'} to it`;
/** «з 1 сторінки», «з 3 сторінок», «з 21 сторінки». */
const ukLinkingPages = (count: number): string =>
  `на неї є посилання з ${count} ${ukPagesOf(count)} сайту`;

/** «за 2 адресами», «за 21 адресою». */
const ukAtAddresses = (count: number): string =>
  `${count} ${takesUkSingular(count) ? 'адресою' : 'адресами'}`;

/** «ще на 1 сторінці», «ще на 3 сторінках». */
const ukOnPages = (count: number): string =>
  `${count} ${ukCountForm(count, 'сторінці', 'сторінках', 'сторінках')}`;

const EN_LINES: Readonly<Record<string, EvidenceLine>> = {
  'seo-onpage-001.evidence.missing': () => 'No page name for search results',
  'seo-onpage-001.evidence.too-short': (v) =>
    `Name now: “${v.text('title')}”, ${enLength(v.count('length'), v.optionalCount('min'), v.optionalCount('max'))}`,
  'seo-onpage-001.evidence.too-long': (v) =>
    `Name now: “${v.text('title')}”, ${enLength(v.count('length'), v.optionalCount('min'), v.optionalCount('max'))}`,
  'seo-onpage-002.evidence.missing': () => 'No summary for search results',
  'seo-onpage-002.evidence.too-short': (v) =>
    `Summary now: “${v.text('description')}”, ${enLength(v.count('length'), v.optionalCount('min'), v.optionalCount('max'))}`,
  'seo-onpage-002.evidence.too-long': (v) =>
    `The summary is ${enLength(v.count('length'), v.optionalCount('min'), v.optionalCount('max'))}`,
  'seo-onpage-003.evidence.no-headings': () => 'The page has no headings at all',
  'seo-onpage-003.evidence.no-h1': () => 'No main heading (H1)',
  'seo-onpage-003.evidence.multiple-h1': (v) =>
    `${v.count('count')} main headings (H1); there should be one`,
  // The rule reports a skip only when the next level is more than one deeper,
  // so H{from + 1} is always one of the levels that is missing.
  'seo-onpage-003.evidence.level-skip': (v) =>
    `H${v.count('from')} is followed straight by H${v.count('to')}, without H${v.count('from') + 1}`,
  'seo-onpage-003.evidence.no-h1.level-skip': (v) =>
    `No main heading (H1), and H${v.count('from')} is followed straight by H${v.count('to')}, without H${v.count('from') + 1}`,
  'seo-onpage-003.evidence.multiple-h1.level-skip': (v) =>
    `${v.count('count')} main headings (H1), and H${v.count('from')} is followed straight by H${v.count('to')}, without H${v.count('from') + 1}`,
  'seo-tech-008.evidence.meta.sitemap': (v) =>
    `Hidden from search by the meta robots tag “${v.text('content')}”, yet listed in the sitemap`,
  'seo-tech-008.evidence.meta.internal-links': (v) =>
    `Hidden from search by the meta robots tag “${v.text('content')}”, yet ${enLinkingPages(v.count('sources'))}`,
  'seo-tech-008.evidence.header.sitemap': (v) =>
    `Hidden from search by the server setting X-Robots-Tag “${v.text('value')}”, yet listed in the sitemap`,
  'seo-tech-008.evidence.header.internal-links': (v) =>
    `Hidden from search by the server setting X-Robots-Tag “${v.text('value')}”, yet ${enLinkingPages(v.count('sources'))}`,
  'seo-tech-003.evidence': (v) => `The page does not open: error ${v.count('status')}`,
  'seo-tech-004.evidence.missing': () => 'No main address (canonical) is named',
  'seo-tech-004.evidence.invalid': (v) =>
    `The main address (canonical) is not a valid address: “${v.text('href')}”`,
  // Hosts, not domains: the rule counts www and the bare domain as different.
  'seo-tech-004.evidence.foreign-host': (v) =>
    `The main address (canonical) points to ${v.text('canonicalHost')}, while this page is on ${v.text('pageHost')}`,
  // The link as written on the page, not the address it ended at after
  // redirects: the owner searches the page for what they wrote.
  'seo-tech-006.evidence': (v) =>
    `The link “${v.text('href')}” leads to error ${v.count('status')}`,
  'seo-tech-007.evidence': (v) => `The same page opens at ${v.count('count')} addresses`,
  'seo-onpage-004.evidence.no-canonical': (v) =>
    `Same name on ${v.count('count')} other ${v.count('count') === 1 ? 'page' : 'pages'}: “${v.text('title')}”`,
  'seo-onpage-004.evidence.unresolved-chain': (v) =>
    `Same name on ${v.count('count')} other ${v.count('count') === 1 ? 'page' : 'pages'}: “${v.text('title')}”`,
  'seo-onpage-005.evidence': (v) =>
    `${v.count('count')} ${v.count('count') === 1 ? 'image' : 'images'} without alt text`,
};

const UK_LINES: Readonly<Record<string, EvidenceLine>> = {
  'seo-onpage-001.evidence.missing': () => 'Назви сторінки для пошуку немає',
  'seo-onpage-001.evidence.too-short': (v) =>
    `Назва зараз: «${v.text('title')}», ${ukLength(v.count('length'), v.optionalCount('min'), v.optionalCount('max'))}`,
  'seo-onpage-001.evidence.too-long': (v) =>
    `Назва зараз: «${v.text('title')}», ${ukLength(v.count('length'), v.optionalCount('min'), v.optionalCount('max'))}`,
  'seo-onpage-002.evidence.missing': () => 'Опису сторінки для пошуку немає',
  'seo-onpage-002.evidence.too-short': (v) =>
    `Опис зараз: «${v.text('description')}», ${ukLength(v.count('length'), v.optionalCount('min'), v.optionalCount('max'))}`,
  'seo-onpage-002.evidence.too-long': (v) =>
    `Опис зараз має ${ukLength(v.count('length'), v.optionalCount('min'), v.optionalCount('max'))}`,
  'seo-onpage-003.evidence.no-headings': () => 'На сторінці немає жодного заголовка',
  'seo-onpage-003.evidence.no-h1': () => 'Головного заголовка H1 немає',
  'seo-onpage-003.evidence.multiple-h1': (v) =>
    `Головних заголовків H1: ${v.count('count')}, а має бути один`,
  'seo-onpage-003.evidence.level-skip': (v) =>
    `Після H${v.count('from')} одразу йде H${v.count('to')}, без H${v.count('from') + 1}`,
  'seo-onpage-003.evidence.no-h1.level-skip': (v) =>
    `Головного заголовка H1 немає, а після H${v.count('from')} одразу йде H${v.count('to')}, без H${v.count('from') + 1}`,
  'seo-onpage-003.evidence.multiple-h1.level-skip': (v) =>
    `Головних заголовків H1: ${v.count('count')}, а після H${v.count('from')} одразу йде H${v.count('to')}, без H${v.count('from') + 1}`,
  'seo-tech-008.evidence.meta.sitemap': (v) =>
    `Сторінку приховано від пошуку тегом meta robots «${v.text('content')}», хоча вона є в карті сайту`,
  'seo-tech-008.evidence.meta.internal-links': (v) =>
    `Сторінку приховано від пошуку тегом meta robots «${v.text('content')}», хоча ${ukLinkingPages(v.count('sources'))}`,
  'seo-tech-008.evidence.header.sitemap': (v) =>
    `Сторінку приховано від пошуку налаштуванням сервера X-Robots-Tag «${v.text('value')}», хоча вона є в карті сайту`,
  'seo-tech-008.evidence.header.internal-links': (v) =>
    `Сторінку приховано від пошуку налаштуванням сервера X-Robots-Tag «${v.text('value')}», хоча ${ukLinkingPages(v.count('sources'))}`,
  'seo-tech-003.evidence': (v) => `Сторінка не відкривається: помилка ${v.count('status')}`,
  'seo-tech-004.evidence.missing': () => 'Основну адресу сторінки (canonical) не вказано',
  'seo-tech-004.evidence.invalid': (v) =>
    `Основна адреса (canonical) вказана з помилкою: «${v.text('href')}»`,
  'seo-tech-004.evidence.foreign-host': (v) =>
    `Основна адреса (canonical) вказує на ${v.text('canonicalHost')}, а сторінка відкривається на ${v.text('pageHost')}`,
  'seo-tech-006.evidence': (v) =>
    `Посилання «${v.text('href')}» не працює: помилка ${v.count('status')}`,
  'seo-tech-007.evidence': (v) => `Та сама сторінка доступна за ${ukAtAddresses(v.count('count'))}`,
  'seo-onpage-004.evidence.no-canonical': (v) =>
    `Така сама назва ще на ${ukOnPages(v.count('count'))}: «${v.text('title')}»`,
  'seo-onpage-004.evidence.unresolved-chain': (v) =>
    `Така сама назва ще на ${ukOnPages(v.count('count'))}: «${v.text('title')}»`,
  'seo-onpage-005.evidence': (v) => `Зображень без підпису (alt-тексту): ${v.count('count')}`,
};

export const evidenceCopy: Record<Language, EvidenceCopy> = {
  en: {
    lines: EN_LINES,
    more: (count) => `and ${count} more`,
    listLabel: 'Where it was found',
  },
  uk: {
    lines: UK_LINES,
    more: (count) => `і ще ${count}`,
    listLabel: 'Де знайдено',
  },
};
