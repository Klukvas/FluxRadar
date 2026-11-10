import { describe, expect, it } from 'vitest';

import { quoteOccursIn } from './quote-match.js';

// Ukrainian answers and evidence (W1): the apostrophe ʼ and the guillemets «»
// may be re-typed by the judge, but the words of a quote must still be there.

const ANSWER_UK =
  'Smile Clinic — стоматологічна клініка в Києві. Компанія повʼязана з мережею «Усмішка» ' +
  'і працює для всієї сімʼї.';

describe('quoteOccursIn for Ukrainian text', () => {
  it('finds a verbatim quote that carries ʼ', () => {
    expect(quoteOccursIn(ANSWER_UK, 'Компанія повʼязана з мережею')).toBe(true);
  });

  it.each([
    ["the ASCII apostrophe '", "Компанія пов'язана з мережею"],
    ['the right single quote ’', 'Компанія пов’язана з мережею'],
    ['the modifier prime ʹ', 'Компанія повʹязана з мережею'],
    ['the backtick `', 'Компанія пов`язана з мережею'],
    ['the acute accent ´', 'Компанія пов´язана з мережею'],
  ])('accepts ʼ re-typed as %s', (_label, quote) => {
    expect(quoteOccursIn(ANSWER_UK, quote)).toBe(true);
  });

  it('accepts an answer typed with an ASCII apostrophe quoted back with ʼ', () => {
    expect(quoteOccursIn("для всієї сім'ї", 'для всієї сімʼї')).toBe(true);
    expect(quoteOccursIn('для всієї сім’ї', "для всієї сім'ї")).toBe(true);
  });

  it('folds guillemets to straight and curly double quotes', () => {
    expect(quoteOccursIn(ANSWER_UK, 'з мережею "Усмішка"')).toBe(true);
    expect(quoteOccursIn(ANSWER_UK, 'з мережею “Усмішка”')).toBe(true);
    expect(quoteOccursIn('мережа "Усмішка"', 'мережа «Усмішка»')).toBe(true);
  });

  it('matches Cyrillic case-insensitively, as it does Latin', () => {
    expect(quoteOccursIn(ANSWER_UK, 'КОМПАНІЯ повʼязана')).toBe(true);
  });

  it('still rejects a quote whose words are not in the answer', () => {
    expect(quoteOccursIn(ANSWER_UK, "Компанія пов'язана з банком")).toBe(false);
    expect(quoteOccursIn(ANSWER_UK, 'клініка у Львові')).toBe(false);
    // A translated quote is not verbatim.
    expect(quoteOccursIn(ANSWER_UK, 'a dental clinic in Kyiv')).toBe(false);
  });

  it('does not let an apostrophe stand in for a letter', () => {
    expect(quoteOccursIn(ANSWER_UK, "пов'язана з мер'жею")).toBe(false);
  });
});

// Evidence is text pulled out of a page's DOM, where blocks run together, and
// answers arrive as markdown. A judge quoting either the way a person reads it
// lost the whole verdict — 6 of 12 answers in one live gov.uk report.
describe('quoteOccursIn across layout', () => {
  const EXCERPT =
    'Cookies on GOV.UK We use some essential cookies to make this website work.We’d like to set ' +
    'additional cookies · Popular on GOV.UK · Benefits · Births, deaths, marriages and care';
  const MARKDOWN_ANSWER =
    'The only official channel is **GOV.UK** (www.gov.uk) — all digital services are accessed there.';

  it('matches a sentence quoted with the space the excerpt lost', () => {
    expect(
      quoteOccursIn(EXCERPT, 'make this website work. We’d like to set additional cookies'),
    ).toBe(true);
  });

  it('matches across the separators a DOM excerpt joins blocks with', () => {
    expect(quoteOccursIn(EXCERPT, 'Popular on GOV.UK Benefits Births, deaths')).toBe(true);
  });

  it('matches an answer quoted without its markdown emphasis', () => {
    expect(quoteOccursIn(MARKDOWN_ANSWER, 'The only official channel is GOV.UK (www.gov.uk)')).toBe(
      true,
    );
  });

  it('matches an elided quote whose parts appear in order, and not out of order', () => {
    expect(quoteOccursIn(MARKDOWN_ANSWER, 'The only official channel … all digital services')).toBe(
      true,
    );
    expect(
      quoteOccursIn(MARKDOWN_ANSWER, 'all digital services ... The only official channel'),
    ).toBe(false);
  });

  it('still rejects words that are not in the text', () => {
    expect(quoteOccursIn(EXCERPT, 'make this website work. We sell cookies')).toBe(false);
    expect(quoteOccursIn(MARKDOWN_ANSWER, 'The only official channel is gov.com')).toBe(false);
    expect(quoteOccursIn(MARKDOWN_ANSWER, ' … ')).toBe(false);
  });
});

// The looser matching above must not let a judge build a quote the text does
// not say: by joining words, by stitching fragments, or by reaching across
// the page.
describe('quoteOccursIn guards', () => {
  it('does not match inside or across words', () => {
    expect(quoteOccursIn('A family therapist in Leeds.', 'the rapist')).toBe(false);
    expect(quoteOccursIn('We do no tax returns.', 'we do not')).toBe(false);
    expect(quoteOccursIn('Our therapist is in Leeds.', 'therapist is in Leeds')).toBe(true);
  });

  it('refuses an elided quote made of short fragments', () => {
    expect(quoteOccursIn('We sell data. Do not ask.', 'we ... not ... sell ... data')).toBe(false);
    expect(quoteOccursIn('We sell data. Do not ask.', 'We sell … ask')).toBe(false);
  });

  it('refuses more than three elided parts', () => {
    const text =
      'alpha phrase one here, beta phrase two here, gamma phrase three here, delta phrase four here';
    expect(quoteOccursIn(text, 'alpha phrase one … beta phrase two … gamma phrase three')).toBe(
      true,
    );
    expect(
      quoteOccursIn(
        text,
        'alpha phrase one … beta phrase two … gamma phrase three … delta phrase four',
      ),
    ).toBe(false);
  });

  it('refuses parts that are far apart', () => {
    const text = `We never share your data. ${'Filler sentence about opening hours. '.repeat(10)}with partners for marketing.`;
    expect(quoteOccursIn(text, 'We never share your data … with partners for marketing')).toBe(
      false,
    );
  });

  it('refuses elision where the caller asks for one contiguous phrase', () => {
    const answer =
      'The only official channel is GOV.UK, and all digital services are accessed there.';
    expect(quoteOccursIn(answer, 'The only official channel … all digital services')).toBe(true);
    expect(
      quoteOccursIn(answer, 'The only official channel … all digital services', {
        allowElision: false,
      }),
    ).toBe(false);
  });

  it('refuses a quote made only of separators and emphasis', () => {
    expect(quoteOccursIn('Free | Paid', ' * | · ')).toBe(false);
  });
});
