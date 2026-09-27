// The number of SEO checks the public pages promise, against the registry.
//
// Three places tell a visitor how many deterministic SEO checks a paid scan
// runs: the coverage page (`checks-copy.en.ts` / `checks-copy.uk.ts`), the FAQ
// (`faq-copy.ts`) and the home page and pricing copy (`i18n.ts`), each in
// English and Ukrainian. The figure is prose, not a computed value — `apps/web`
// has no workspace dependency on `packages/contracts` on purpose — so adding a
// rule to the registry leaves those sentences quietly claiming the old number.
//
// That is the defect this pins: the promise is read as a commitment by anyone
// comparing packages, and a report that runs twenty-one checks beside a page
// promising nineteen looks like the page was written about a different product.
//
// The test lives here rather than in `apps/web` because it needs the registry,
// and only a package that depends on `packages/contracts` can read it. The web
// files are read as text — `apps/web` stays free of that dependency — which is
// why this sits in a package that has it, not in the one it describes.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { rulesForModule } from '@fluxradar/contracts';
import { describe, expect, it } from 'vitest';

function webSource(file: string): string {
  return readFileSync(resolve(process.cwd(), '..', 'web', 'src', file), 'utf8');
}

/** Every number claimed as a count of SEO checks, with the phrase it sits in. */
function claimedCounts(file: string, patterns: readonly RegExp[]): readonly number[] {
  const source = webSource(file);
  return patterns.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => Number(match[1])),
  );
}

/** Written-out numerals, because the FAQ spells the figure rather than digits. */
const WRITTEN_NUMBERS: Readonly<Record<string, number>> = {
  Nineteen: 19,
  Twenty: 20,
  'Twenty-one': 21,
  'Twenty-two': 22,
  'Twenty-three': 23,
};

const UK_WRITTEN_NUMBERS: Readonly<Record<string, number>> = {
  'Дев’ятнадцять': 19,
  Двадцять: 20,
  'Двадцять одне': 21,
  'Двадцять два': 22,
  'Двадцять три': 23,
};

describe('the SEO check count the public pages promise', () => {
  const expected = rulesForModule('SEO').length;

  it('reads a registry with a non-trivial SEO module', () => {
    expect(expected).toBeGreaterThan(15);
  });

  it('matches on the coverage page in both languages', () => {
    // One file per language since the coverage page outgrew a single one; the
    // count has to be claimed in both, so each pattern is asserted separately.
    const english = claimedCounts('checks-copy.en.ts', [/\*\*(\d+) deterministic checks\*\*/g]);
    const ukrainian = claimedCounts('checks-copy.uk.ts', [
      /\*\*(\d+) детермінован[а-яіїєґ']+ перевірк[а-яіїєґ']+\*\*/g,
    ]);
    expect(english).toEqual([expected]);
    expect(ukrainian).toEqual([expected]);
  });

  it('matches in the home page, pricing and package copy in both languages', () => {
    const counts = claimedCounts('i18n.ts', [
      /(\d+) checks · complete/g,
      /(\d+) deterministic checks · JSON-LD/g,
      /(\d+) SEO checks, AI crawler readiness/g,
      /The full SEO analysis — (\d+) checks/g,
      /(\d+) перевірк[а-яіїєґ']* · завершено/g,
      /(\d+) детермінован[а-яіїєґ']+ перевірк[а-яіїєґ']+ · перегляд JSON-LD/g,
      /(\d+) SEO-перевірк[а-яіїєґ']+, готовність до AI-краулерів/g,
      /Повний SEO-аналіз — (\d+) перевірк[а-яіїєґ']*/g,
    ]);
    // Pinned exactly, not as a floor: a reworded sentence stops matching its
    // pattern, and a floor would let that pass while the guard on it quietly
    // disappeared. Ten, because the package description and its short form
    // repeat the same phrase in each language. If this fails after a copy edit,
    // the phrase moved — update the pattern, do not lower the number.
    expect(counts).toHaveLength(10);
    expect([...new Set(counts)]).toEqual([expected]);
  });

  it('matches in the FAQ in both languages, where the figure is spelled out', () => {
    const source = webSource('faq-copy.ts');
    const english = /'([A-Z][a-z]+(?:-[a-z]+)?) rule-based checks/.exec(source)?.[1];
    const ukrainian = /'(Дев’ятнадцять|Двадцять(?: одне| два| три)?) правил/.exec(source)?.[1];

    expect(english === undefined ? undefined : WRITTEN_NUMBERS[english]).toBe(expected);
    expect(ukrainian === undefined ? undefined : UK_WRITTEN_NUMBERS[ukrainian]).toBe(expected);
  });
});
