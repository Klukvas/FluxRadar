// The walk every Russian copy test reads its strings off.
//
// Three things can go wrong in a locale this large and only the first is a
// type error: a key can be missing, a value can be left in another language,
// and a sentence can break one of the owner's copy rules. So this walks the
// real objects — the shared `copy` and every catalogue beside it — and hands
// each leaf back beside the English one it answers to.
//
// The rules, from the owner:
//   * no accent on what the Free check costs: the words «бесплатно»,
//     «бесплатная» and «без карты» are out, and the tier is named «Free»;
//   * no dash construction carrying a sentence («X — Y»): a verb, a colon or
//     two sentences instead;
//   * one word for the technology, «ИИ», never the Latin «AI-» compound;
//   * the report document is Ukrainian, and the copy never says otherwise.
//
// `russian-copy-parity.test.ts` checks those rules over the whole walk,
// `russian-copy-parity.example.test.ts` the public example's own words, and
// `russian-copy-parity.legal.test.ts` the three legal documents, whose prose
// lives in components the walk cannot reach.
//
// The report screen and the Issue Center are walked like every other screen:
// their chrome is Russian, `findings-copy.ts` and `geo-digest-copy.ts`
// included. What is not walked is the other half of those two screens — the
// printable document, the message the copy button writes, the sentences that
// state what a finding recorded — which is the report's own words and stays
// Ukrainian (`report-language.ts`).
//
// With one exception, and it is walked: the public example report
// (`example-report-content.ts`). Its six invented problems are translated,
// because the page exists for somebody who has not bought anything and cannot
// be asked to judge the product through a language they chose not to read. The
// page says so above the report, and the rules apply to those words like any
// others.

import { accountCopy } from './account-copy';
import { actionPlanCopy } from './action-plan-copy';
import { auditMethodologyCopy } from './audit-methodology-copy';
import { authCopy } from './auth-copy';
import { cookieCopy } from './cookie-copy';
import { createdByFluxLab } from './brand';
import { desktopCopy } from './desktop-copy';
import { domainOwnershipCopy } from './domain-ownership-copy';
import { evidenceChromeCopy } from './finding-evidence-copy';
import { findingsCopy } from './findings-copy';
import { exampleReportCopy } from './example-report-copy';
import { exampleReportContent } from './example-report-content';
import { geoDigestCopy } from './geo-digest-copy';
import { copy } from './i18n';
import { newScanCopy } from './new-scan-copy';
import { offlineBannerCopy } from './OfflineBanner';
import { LEGACY_PLAN_NAME } from './plan-modules';
import { reportBrandingCopy } from './report-branding-copy';
import { reportFailureCopy } from './report-failure-copy';
import { scanCancelCopy } from './scan-cancel-copy';
import { siteChromeCopy } from './site-chrome-copy';
import { supportCopy } from './support-copy';

/** Ukrainian letters that Russian does not have, for the tests that look for one. */
export const UKRAINIAN_ONLY = /[іїєґ]/i;

/** The catalogues whose Russian half is written in Russian. */
const CATALOGUES = {
  copy,
  accountCopy,
  actionPlanCopy,
  auditMethodologyCopy,
  authCopy,
  cookieCopy,
  createdByFluxLab,
  desktopCopy,
  domainOwnershipCopy,
  evidenceChromeCopy,
  exampleReportCopy,
  exampleReportContent,
  findingsCopy,
  geoDigestCopy,
  newScanCopy,
  offlineBannerCopy,
  LEGACY_PLAN_NAME,
  reportBrandingCopy,
  reportFailureCopy,
  scanCancelCopy,
  siteChromeCopy,
  supportCopy,
} as const;

/** Paths the walk does not read, each with the reason it is not Russian. */
const NOT_TRANSLATED: readonly RegExp[] = [
  // Content, not chrome: one names every rule, the other says why a named rule
  // had nothing to look at, and both stand beside finding sentences the API
  // writes in Ukrainian. `russian-locale.test.ts` pins that these two are the
  // Ukrainian objects themselves.
  /^copy\.report\.checks\.titles\b/,
  /^copy\.report\.checks\.notApplicableReasons\b/,
];

/**
 * Paths whose Russian and English halves are allowed to read the same.
 *
 * Only for a value that is not prose: a product or company name, a wire value
 * the API matches on, a brand, or an address.
 */
const SAME_AS_ENGLISH: readonly RegExp[] = [
  // Plan names are the product's own: Basic is Basic on a Russian invoice, and
  // the free tier is named after the plan rather than after what it costs.
  /^newScanCopy\.planCards\.(?:Free|Basic|Complete)\.name$/,
  /^copy\.pricing\.cards\.(?:basic|complete)\.title$/,
  /^copy\.pricing\.explainer\.(?:basicColumn|completeColumn)$/,
  /^copy\.pricing\.explainer\.rows\.price\.(?:basic|complete)$/,
  /^copy\.pricing\.cards\.(?:basic|complete)\.price$/,
  // Brand, product and standard names, and the addresses they live at.
  /^copy\.nav\.faq$/,
  /^copy\.seo\.[a-zA-Z]+\.title$/,
  /^copy\.newScan\.(?:freeScopeRobots|launchSummaryRobots)$/,
  /^copy\.newScan\.launchSummaryPerformanceValue$/,
  /^copy\.integrations\.(?:bing|google)\.(?:serviceSearchConsole|serviceAnalytics)$/,
  /^copy\.home\.hero\.example\.site$/,
  /^copy\.home\.example\.site$/,
  /^copy\.(?:legal|home)\.footer?Brand$/,
  /^copy\.home\.footer\.brand$/,
  /^copy\.siteStatus\.google(?:SearchConsole|Analytics)$/,
  /^copy\.checkout\.panelTitle$/,
  /^(?:accountCopy|supportCopy)\.email(?:\.heading)?$/,
  /^accountCopy\.email\.address$/,
  /^supportCopy\.emailPlaceholder$/,
  /^copy\.workspace\.(?:siteAddressPlaceholder|displayNamePlaceholder)$/,
  /^copy\.(?:checks|bot|faq)\.(?:contactEmail|title)$/,
  /^copy\.(?:checks|bot)\.(?:kicker|noticeTag)$/,
  /^copy\.bot\.(?:title|footerBrand)$/,
  /^copy\.bot\.sections\[\d+\]\.(?:label|title)$/,
  /^copy\.bot\.sections\[\d+\]\.(?:bullets\[\d+\]\.body|snippet\.body)$/,
  /^copy\.checks\.sections\[\d+\]\.label$/,
  /^copy\.checks\.sections\[\d+\]\.title$/,
  /^copy\.faq\.sections\[\d+\]\.(?:label|nav)$/,
  /^copy\.(?:legal|bot|checks|faq)\.meta\[\d+\]$/,
  /^copy\.legal\.(?:kicker|footerBrand)$/,
  /^copy\.legal\.[a-z]+\.sections\[\d+\]\.id$/,
  // Report screen: product names, a metric abbreviation every language
  // prints the same, and four rows that are a format string with no words in
  // them. Translating any of these would only change the spelling of a name.
  /^copy\.report\.geoProvider(?:Openai|Anthropic|Google|Perplexity)$/,
  /^copy\.report\.google\.(?:searchConsoleHeading|analyticsHeading|ctr)$/,
  /^copy\.report\.bing\.ctr$/,
  /^copy\.report\.geoShareOfVoiceNoneShort$/,
  /^copy\.report\.geoShareOfVoiceCompetitorRow$/,
  /^copy\.report\.checks\.uxSignalCount$/,
  /^copy\.report\.comparison\.(?:scopeChangedRow|scoreMove)$/,
  // Module ids the API keys its rows by, not words about them.
  /^copy\.scanProgress\.moduleAreas\.[A-Za-z /]+$/,
  /^exampleReportCopy\.sectionNames\.[A-Za-z /]+$/,
  /^exampleReportCopy\.(?:site|footerBrand|dateLabel)$/,
  /^exampleReportCopy\.glossary\[\d+\]\.term$/,
  /^reportBrandingCopy\.errors\.[A-Z_]+$/,
  /^LEGACY_PLAN_NAME\.WebsiteAudit$/,
  // The owner's own trading name, spelled the same everywhere.
  /^createdByFluxLab$/,
  // Anchors, section ids and step ids: addresses and wire values, not words.
  // Translating one would move an anchor in one language only.
  /\.id$/,
  /\.anchor$/,
  /\.steps\[\d+\]$/,
  /\.priority$/,
  // Standard, header and file names, which are spelled the same in every
  // language because that is what the reader has to look for.
  /^copy\.(?:checks|bot)\.sections\[\d+\]\.bullets\[\d+\]\.term$/,
  /^copy\.checks\.sections\[\d+\]\.nav$/,
  /^copy\.newScan\.aiConsent(?:OptIn)?Eyebrow$/,
  /^copy\.legal\.cookies\.sections\[\d+\]\.label$/,
  // Example names a reader types over, and a "{name} · {domain}" format.
  /^copy\.workspace\.competitorsPlaceholder$/,
  /^desktopCopy\.siteHeading$/,
  /^authCopy\.email(?:Placeholder)?$/,
  // "HTTP 404" is the answer the site gave, not a sentence about it.
  /^reportFailureCopy\.httpStatus$/,
  // A format, "{tone}: {count}": the tone word it is given comes translated
  // from `toneLabels`, which is walked above like any other prose.
  /^geoDigestCopy\.toneCount$/,
  // The wire values the chip colours and the API's filters are keyed by: the
  // paths are English because the keys are, and the words in them are walked.
  /^findingsCopy\.(?:severity|severityMeaning|status)\.[A-Za-z ]+$/,
];

/**
 * The Latin compound the owner's term replaces: «AI-план», «AI‑провайдеру».
 * Both hyphens, because the legal documents use the non-breaking one. A name
 * that happens to contain the letters («AI SEO / GEO», OpenAI) is a name and
 * stays, which is why only a hyphen directly after them is refused.
 */
export const LATIN_COMPOUND = /\bAI[-\u2011]/;
export const LATIN_COMPOUND_ALL = new RegExp(LATIN_COMPOUND.source + '\\p{L}*', 'gu');

/** Arguments to call a copy function with: one of each shape it may want. */
const CALL_ARGUMENTS: readonly unknown[] = ['example.com', 2, 'example.com', 2, 2, 2];

export type Leaf = { readonly path: string; readonly en: string; readonly ru: string };

export function leavesOf(name: string, en: unknown, ru: unknown, path = name): readonly Leaf[] {
  if (NOT_TRANSLATED.some((pattern) => pattern.test(path))) return [];
  if (typeof en === 'string' && typeof ru === 'string') return [{ path, en, ru }];
  if (typeof en === 'function' && typeof ru === 'function') {
    const call = (fn: unknown): string => {
      try {
        const result = (fn as (...args: readonly unknown[]) => unknown)(...CALL_ARGUMENTS, {
          name: 'Bloom Nails',
          domain: 'https://bloom-nails.example',
        });
        return typeof result === 'string' ? result : '';
      } catch {
        return '';
      }
    };
    return [{ path, en: call(en), ru: call(ru) }];
  }
  if (Array.isArray(en) && Array.isArray(ru)) {
    return en.flatMap((entry, index) => leavesOf(name, entry, ru[index], `${path}[${index}]`));
  }
  if (typeof en === 'object' && en !== null && typeof ru === 'object' && ru !== null) {
    const record = ru as Record<string, unknown>;
    return Object.entries(en as Record<string, unknown>).flatMap(([key, value]) =>
      leavesOf(name, value, record[key], `${path}.${key}`),
    );
  }
  return typeof en === 'string' || typeof ru === 'string'
    ? [{ path, en: `${en}`, ru: `${ru}` }]
    : [];
}

export function allLeaves(): readonly Leaf[] {
  return Object.entries(CATALOGUES).flatMap(([name, catalogue]) =>
    leavesOf(
      name,
      (catalogue as Record<string, unknown>).en,
      (catalogue as Record<string, unknown>).ru,
    ),
  );
}

export function allowedToMatch(path: string): boolean {
  return SAME_AS_ENGLISH.some((pattern) => pattern.test(path));
}
