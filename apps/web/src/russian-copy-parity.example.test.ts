// The public example report's own Russian words.
//
// Everywhere else a Russian reader gets a Russian interface around a Ukrainian
// report. This page is the exception, and the only place on the site where
// report text is translated: it exists for somebody who has not bought
// anything, and asking them to judge the product through six Ukrainian problems
// is asking them to read the language they chose not to. The page says so above
// the report, and the owner's copy rules apply to those words like any others.
//
// The walk and the rules it enforces live in
// `russian-copy-parity-test-support.ts`; what is here is the part of it that is
// only about the example.

import { describe, expect, it } from 'vitest';

import { exampleReportContent } from './example-report-content';
import { problemTitle } from './finding-explainers';
import { allLeaves } from './russian-copy-parity-test-support';

/** The leaves of the two catalogues the example page prints from. */
function exampleLeaves(): readonly { readonly path: string; readonly ru: string }[] {
  return allLeaves().filter((leaf) => /^exampleReport(?:Copy|Content)\./.test(leaf.path));
}

/**
 * A sentence joined by a bare «это»: «0 это худшее», «Находка это одно место».
 *
 * Russian states a nominal predicate without a copula, so the owner's rule is
 * to write the joint out — a verb, a colon or two sentences — rather than to
 * lean on «это». The shape is a word, «это» and another word, which is also how
 * an ordinary pronoun reads; the allow-list below carries the pronoun uses the
 * page actually has, and anything new has to be looked at rather than assumed.
 */
const BARE_COPULA = /[0-9а-яё»)] это [а-яё«„]/;

/** The example's legitimate «это», each with the job it does in the sentence. */
const PRONOUN_USES: readonly RegExp[] = [
  // The question every «что это значит» aside answers: «это» is the subject of
  // the verb «значит».
  /Что это значит/g,
  // The report block's own name, quoted: object of the imperative «Исправьте».
  /Исправьте это первым/g,
  // Objects of a verb: nowhere to do *it*, the page where *it* was found.
  /негде это сделать/g,
  /где это найдено/g,
  // Subject standing for what the sentence just said, with a real predicate
  // after it. Russian has no copula to put here.
  /а это трудно читать/g,
  /а это деньги уже сегодня/g,
  // Demonstrative with the noun it points at: *that* description, *that* field.
  /показывают это описание/g,
  /знает это поле/g,
];

/** The leaf with every legitimate «это» taken out, so only a bare one is left. */
function withoutPronouns(text: string): string {
  return PRONOUN_USES.reduce((rest, allowed) => rest.replace(allowed, ''), text);
}

describe('the translated public example', () => {
  // The exception the header names. The example's findings are the one place
  // on the site where a Russian reader is shown translated report text, so the
  // keys are here to be walked — and the page's own note, which says the words
  // are a translation, is walked with them. English and Ukrainian owe no such
  // note and carry none.
  it('walks the translated public example, note and all', () => {
    const paths = new Set(allLeaves().map((leaf) => leaf.path));
    expect(paths.has('exampleReportContent.findings.SEO-TECH-006.title')).toBe(true);
    expect(paths.has('exampleReportContent.findings.SEO-TECH-006.what')).toBe(true);
    expect(paths.has('exampleReportContent.developerTask')).toBe(true);
    expect(paths.has('exampleReportContent.translationNote')).toBe(true);

    expect(exampleReportContent.ru.translationNote).toContain('на украинском');
    expect(exampleReportContent.en.translationNote).toBeNull();
    expect(exampleReportContent.uk.translationNote).toBeNull();
    // And the catalogue the real report reads has not moved with it: a finding
    // on the report screen is still named in the report's language.
    expect(problemTitle('SEO-TECH-006', 'ru')).toBe(problemTitle('SEO-TECH-006', 'uk'));
  });

  // The owner's rule: «это» is not a verb. The page is where it kept happening,
  // because explaining a score and a finding invites a definition.
  it('joins no two halves of a sentence with a bare «это»', () => {
    const offending = exampleLeaves().filter((leaf) => BARE_COPULA.test(withoutPronouns(leaf.ru)));
    expect(offending.map((leaf) => `${leaf.path}: ${leaf.ru}`)).toEqual([]);

    // The walker has to be able to see one, or the check above is vacuous, and
    // it has to leave the rewritten sentences and the pronouns alone.
    expect(BARE_COPULA.test('Что это значит: 0 это худшее, 100 это лучшее')).toBe(true);
    expect(BARE_COPULA.test('Находка это одно место, где эту проблему нашли')).toBe(true);
    expect(BARE_COPULA.test(withoutPronouns('Что это значит: 0 это худшее, 100 это лучшее'))).toBe(
      true,
    );
    expect(
      BARE_COPULA.test(
        withoutPronouns('балл идёт от 0 (худшее) до 100 (лучшее) и считается одним числом'),
      ),
    ).toBe(false);
    expect(BARE_COPULA.test(withoutPronouns('Что это значит: четыре страницы'))).toBe(false);
    // A sentence that opens on «Это» is a pronoun with a predicate after it,
    // which is the one position the rule does not touch.
    expect(BARE_COPULA.test('Это полный отчёт для выдуманного нейл-салона')).toBe(false);
    expect(BARE_COPULA.test('ПРИМЕР: это не настоящий сайт, числа выдуманы')).toBe(false);
  });

  // The example catalogues have to be in the walk for the test above to read
  // anything at all.
  it('reads both catalogues the page prints from', () => {
    const paths = exampleLeaves().map((leaf) => leaf.path);
    expect(paths.filter((path) => path.startsWith('exampleReportCopy.')).length).toBeGreaterThan(
      50,
    );
    expect(paths.filter((path) => path.startsWith('exampleReportContent.')).length).toBeGreaterThan(
      20,
    );
  });
});
