// Every Russian string the owner reads, walked at runtime.
//
// The walk itself, the catalogues it covers and the rules it enforces are
// described in `russian-copy-parity-test-support.ts`, which this file, the
// public example's own file and the legal documents' file all read from.
//
// What is checked here is the whole walk: that it reaches the screens it is
// supposed to, that nothing is missing or left in English, and that each of the
// owner's four copy rules holds over every leaf of it. One test pins the other
// half of the report screen and the Issue Center — the printable document, the
// message the copy button writes, the sentences that state what a finding
// recorded — as having no Russian branch to walk at all.

import { describe, expect, it } from 'vitest';

import { egressLocationLabel } from './egress-location';
import { evidenceCopy } from './finding-evidence-copy';
import { findingsDocumentCopy, findingsDocumentCopyFor } from './findings-document-copy';
import { exampleReportCopy } from './example-report-copy';
import { copy } from './i18n';
import { moduleLabel } from './rule-titles';
import {
  LATIN_COMPOUND,
  UKRAINIAN_ONLY,
  allLeaves,
  allowedToMatch,
} from './russian-copy-parity-test-support';
import { siteChromeCopy } from './site-chrome-copy';

describe('the Russian half of every catalogue', () => {
  it('reaches a useful number of strings', () => {
    // A guard on the walker: a change that made `leavesOf` return nothing
    // would otherwise turn every test below green.
    expect(allLeaves().length).toBeGreaterThan(2300);
  });

  // The report screen and the Issue Center were exempt from the whole walk
  // while their copy was the Ukrainian object. They are chrome now, so the
  // exemption is down to the two catalogues that name the rules.
  it('walks the report screen and the Issue Center, minus the rule catalogues', () => {
    const paths = new Set(allLeaves().map((leaf) => leaf.path));
    expect(paths.has('copy.report.windowTitle')).toBe(true);
    expect(paths.has('copy.report.comparison.heading')).toBe(true);
    expect(paths.has('copy.report.checks.resultPassed')).toBe(true);
    expect(paths.has('copy.issues.windowTitle')).toBe(true);
    expect(paths.has('copy.report.checks.titles.A11Y-001')).toBe(false);
    expect(paths.has('copy.report.checks.notApplicableReasons.CONTENT-001')).toBe(false);
    // And the catalogues that sit beside `copy` on those two screens.
    expect(paths.has('findingsCopy.issues.lead')).toBe(true);
    expect(paths.has('findingsCopy.fixFirst.heading')).toBe(true);
    expect(paths.has('findingsCopy.download.pdf')).toBe(true);
    expect(paths.has('findingsCopy.print.open')).toBe(true);
    expect(paths.has('geoDigestCopy.heading')).toBe(true);
    expect(paths.has('evidenceChromeCopy.listLabel')).toBe(true);
  });

  // The other half of those catalogues: the printable document, the message
  // the copy button writes, and the sentences that state what one finding
  // recorded. They are keyed by `ReportLanguage`, so there is no Russian
  // branch to walk — a reader of Russian is handed the Ukrainian one.
  it('leaves the report’s own words out of the walk, in Ukrainian', () => {
    const paths = new Set(allLeaves().map((leaf) => leaf.path));
    for (const path of [
      'findingsCopy.print.documentTitle',
      'findingsCopy.print.evidence',
      'findingsCopy.task.heading',
      'findingsCopy.task.recommendation',
    ]) {
      expect(paths.has(path)).toBe(false);
    }

    // Two languages, and the Russian reader is sent to the Ukrainian one.
    expect(Object.keys(findingsDocumentCopy)).toEqual(['en', 'uk']);
    expect(Object.keys(evidenceCopy)).toEqual(['en', 'uk']);
    expect(findingsDocumentCopyFor('ru')).toBe(findingsDocumentCopy.uk);
    expect(findingsDocumentCopyFor('uk')).toBe(findingsDocumentCopy.uk);
    expect(findingsDocumentCopyFor('en')).toBe(findingsDocumentCopy.en);

    // And what it says is Ukrainian, letters and all.
    const document = findingsDocumentCopyFor('ru');
    expect(document.print.noFindings).toMatch(UKRAINIAN_ONLY);
    expect(document.print.problemsLead).toMatch(UKRAINIAN_ONLY);
    expect(document.task.examples).toMatch(UKRAINIAN_ONLY);
    expect(document.task.whereOpen(2)).toMatch(UKRAINIAN_ONLY);
    expect(document.task.recommendation).toMatch(UKRAINIAN_ONLY);
    expect(evidenceCopy.uk.lines['seo-tech-003.evidence']).toBeTypeOf('function');
  });

  it('has a non-empty Russian value for every English key', () => {
    const missing = allLeaves().filter(
      (leaf) => leaf.ru.trim() === '' || leaf.ru === 'undefined' || leaf.ru === 'null',
    );
    expect(missing.map((leaf) => leaf.path)).toEqual([]);
  });

  it('says something different in Russian for everything that is prose', () => {
    const untranslated = allLeaves().filter(
      (leaf) => leaf.en === leaf.ru && !allowedToMatch(leaf.path),
    );
    expect(untranslated.map((leaf) => leaf.path)).toEqual([]);
  });

  // The owner's rule: the free homepage check is the entry point, never the
  // hook. The facts the Ukrainian copy states may stay; the words that turn
  // them into a selling point may not.
  it('never accents what the Free check costs', () => {
    const banned = /бесплатн|без карт|без оплаты картой/i;
    const offending = allLeaves().filter((leaf) => banned.test(leaf.ru));
    expect(offending.map((leaf) => `${leaf.path}: ${leaf.ru}`)).toEqual([]);
  });

  // The owner's rule: a dash is not a sentence structure. A range («0–100»,
  // «30–40 %») is fine, which is why only a dash between words is refused.
  it('builds no sentence on a dash', () => {
    const spacedDash = /\s[—–]\s/;
    const wordDash = /\p{L}\s*[—–]\s*\p{L}/u;
    const offending = allLeaves().filter(
      (leaf) => spacedDash.test(leaf.ru) || wordDash.test(leaf.ru),
    );
    expect(offending.map((leaf) => `${leaf.path}: ${leaf.ru}`)).toEqual([]);
  });

  // The owner's term for the technology is «ИИ», which the home page, the
  // pricing table and the FAQ already used while the report screen said
  // «AI-система». A compound such as «AI-план» is the English word with a
  // Russian ending glued to it; a product name that happens to contain the
  // letters («AI SEO / GEO», «AI/GEO», OpenAI) is a name and stays, which is
  // why only the hyphenated compound is refused.
  it('names the technology «ИИ», never an «AI-» compound', () => {
    const offending = allLeaves().filter((leaf) => LATIN_COMPOUND.test(leaf.ru));
    expect(offending.map((leaf) => `${leaf.path}: ${leaf.ru}`)).toEqual([]);
    // The walker has to be able to see one, or the check above is vacuous. Both
    // hyphens: the legal documents are typeset with the non-breaking one, and a
    // pattern that only knew the ASCII hyphen read thirteen «AI‑провайдеру» as
    // clean prose.
    expect(LATIN_COMPOUND.test('AI-план действий')).toBe(true);
    expect(LATIN_COMPOUND.test('AI‑провайдеру')).toBe(true);
    expect(LATIN_COMPOUND.test('OAI-SearchBot')).toBe(false);
    expect(LATIN_COMPOUND.test('AI SEO / GEO')).toBe(false);
  });

  // Where the Ukrainian copy says the report is Ukrainian, the Russian copy
  // says the same thing rather than implying a Russian one.
  it('tells a Russian reader the report is Ukrainian', () => {
    expect(copy.ru.home.hero.trust).toContain('Отчёт на украинском');
    expect(copy.ru.seo.exampleReport.description).toContain('Отчёт на украинском');
    expect(exampleReportCopy.ru.exampleBody).toContain('на украинском');
  });

  // The same disclosure on the links that leave for Ukrainian-only reading.
  // The knowledge base already carried it; the blog link did not, and the
  // blog has no Russian articles either.
  it('marks the links that lead to Ukrainian-only reading', () => {
    expect(copy.ru.home.footer.fieldNotes).toContain('(на украинском)');
    expect(siteChromeCopy.ru.knowledgeBase).toContain('(на украинском)');
  });

  // One name per legal document. The Terms had three Russian names across the
  // footer, the FAQ and the bot page, and a footer link whose words differ
  // from the page it opens reads as a second, unseen document.
  it('calls the Terms document by one name', () => {
    const otherNames = /Условия (?:обслуживания|использования)/;
    const offending = allLeaves().filter((leaf) => otherNames.test(leaf.ru));
    expect(offending.map((leaf) => `${leaf.path}: ${leaf.ru}`)).toEqual([]);
    expect(copy.ru.home.footer.termsLink).toBe('Условия пользования');
    expect(copy.ru.legal.terms.title).toBe('Условия пользования');
    expect(copy.ru.faq.footerTerms).toBe('Условия пользования');
    expect(copy.ru.bot.footerTerms).toBe('Условия пользования');
  });

  // The CTA the owner chose, in the two places a visitor meets it.
  it('calls the visitor to action in the owner’s words', () => {
    expect(copy.ru.home.hero.submit).toBe('Проверьте свой сайт');
    expect(copy.ru.home.lastCall.cta).toBe('Проверьте свой сайт');
    expect(exampleReportCopy.ru.ctaHeading).toBe('Проверьте свой сайт');
  });

  // Two labels the app writes from data rather than from a catalogue, so the
  // walk above cannot see them: a report section's name, and the place a check
  // left from. The place is a proper noun the API spells in two languages
  // only, and the label around it («Страна проверки») is chrome.
  it('names the sections and the country of a check in Russian', () => {
    for (const module of ['Security', 'Accessibility', 'Content Quality', 'Reliability']) {
      expect(moduleLabel(module, 'ru')).not.toMatch(UKRAINIAN_ONLY);
      expect(moduleLabel(module, 'ru')).not.toBe(moduleLabel(module, 'uk'));
    }
    expect(moduleLabel('Security', 'ru')).toBe('Безопасность');
    // The printed document is handed the report's language, and reads as it did.
    expect(moduleLabel('Security', 'uk')).toBe('Безпека');

    const kyiv = {
      id: 'ua',
      countryCode: 'UA',
      city: 'Kyiv',
      label: { en: 'Ukraine, Kyiv', uk: 'Україна, Київ' },
    };
    expect(egressLocationLabel(kyiv, 'ru')).toBe('Украина, Киев');
    expect(egressLocationLabel(kyiv, 'uk')).toBe('Україна, Київ');
    expect(egressLocationLabel(kyiv, 'en')).toBe('Ukraine, Kyiv');
    // A place the API has and this build has not: the Ukrainian name, which is
    // a name a reader can still act on, rather than a bare code.
    const frankfurt = {
      id: 'de-fra',
      countryCode: 'DE',
      city: 'Frankfurt',
      label: { en: 'Germany, Frankfurt', uk: 'Німеччина, Франкфурт' },
    };
    expect(egressLocationLabel(frankfurt, 'ru')).toBe('Німеччина, Франкфурт');
    expect(egressLocationLabel({ ...frankfurt, label: null }, 'ru')).toBe('DE-FRA');
  });

  // Ukrainian letters that Russian does not have. A paragraph pasted from the
  // Ukrainian branch and half-edited shows up here and nowhere else.
  it('holds no Ukrainian letters in Russian prose', () => {
    const offending = allLeaves().filter(
      (leaf) => UKRAINIAN_ONLY.test(leaf.ru) && !allowedToMatch(leaf.path),
    );
    expect(offending.map((leaf) => `${leaf.path}: ${leaf.ru}`)).toEqual([]);
  });
});
