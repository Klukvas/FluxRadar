// The browser's plain evidence lines, against the rules' message catalogue.
//
// `apps/web/src/finding-evidence-copy.ts` turns a finding's message code and
// values into "Name now: “Home”, 4 characters". It is keyed by the catalogue's
// codes and reads the catalogue's value names, but the browser cannot import
// `@fluxradar/rules`, so a renamed code or value would silently drop the line
// back to the generic row. This pins both sides together.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { FINDING_MESSAGES, placeholdersOf } from '@fluxradar/rules';
import { describe, expect, it } from 'vitest';

const BROWSER_LINES = readFileSync(
  resolve(process.cwd(), '..', 'web', 'src', 'finding-evidence-copy.ts'),
  'utf8',
);

/** The body of `const <name>: … = { … };` in the browser file. */
function block(name: string): string {
  const start = BROWSER_LINES.indexOf(`const ${name}:`);
  if (start === -1) throw new Error(`${name} not found in finding-evidence-copy.ts`);
  const end = BROWSER_LINES.indexOf('\n};', start);
  return BROWSER_LINES.slice(start, end);
}

interface LineReads {
  /** Values the line cannot do without: `v.text('title')`, `v.count('length')`. */
  readonly required: readonly string[];
  /** Values it uses when present: `v.optionalCount('min')`. */
  readonly optional: readonly string[];
}

function namesRead(source: string, pattern: RegExp): readonly string[] {
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1] ?? ''))];
}

/** Each line's code and the value names it reads at its call site. */
function linesOf(name: string): ReadonlyMap<string, LineReads> {
  const body = block(name);
  const entries = [...body.matchAll(/^ {2}'([a-z0-9.-]+)': /gm)];
  return new Map(
    entries.map((entry, index) => {
      const next = entries[index + 1]?.index ?? body.length;
      const source = body.slice(entry.index ?? 0, next);
      return [
        entry[1] ?? '',
        {
          required: namesRead(source, /v\.(?:text|count)\('(\w+)'\)/g),
          optional: namesRead(source, /v\.optionalCount\('(\w+)'\)/g),
        },
      ];
    }),
  );
}

type CatalogueCode = keyof typeof FINDING_MESSAGES;

function placeholdersOfCode(code: string): readonly string[] {
  const template = FINDING_MESSAGES[code as CatalogueCode];
  return template === undefined ? [] : placeholdersOf(template.en);
}

/** The values of every recommendation of the same rule: where the recommended range lives. */
function recommendationPlaceholders(evidenceCode: string): readonly string[] {
  const rule = evidenceCode.split('.')[0] ?? '';
  return Object.keys(FINDING_MESSAGES)
    .filter((code) => code.startsWith(`${rule}.recommendation`))
    .flatMap(placeholdersOfCode);
}

const EN = linesOf('EN_LINES');
const UK = linesOf('UK_LINES');

describe('the plain evidence lines follow the message catalogue', () => {
  it('has a line in both languages for the same codes', () => {
    expect(EN.size).toBeGreaterThan(0);
    expect([...UK.keys()].sort()).toEqual([...EN.keys()].sort());
  });

  it('names only evidence codes the catalogue has', () => {
    const unknown = [...EN.keys()].filter(
      (code) => !(code in FINDING_MESSAGES) || !code.split('.').includes('evidence'),
    );
    expect(unknown).toEqual([]);
  });

  it('requires only values the evidence code is filled with', () => {
    const misread = [...EN, ...UK].flatMap(([code, reads]) => {
      const recorded = placeholdersOfCode(code);
      return reads.required
        .filter((value) => !recorded.includes(value))
        .map((value) => `${code}:${value}`);
    });
    expect(misread).toEqual([]);
  });

  it("reads optional values only from the evidence or the rule's recommendation", () => {
    const misread = [...EN, ...UK].flatMap(([code, reads]) => {
      const recorded = [...placeholdersOfCode(code), ...recommendationPlaceholders(code)];
      return reads.optional
        .filter((value) => !recorded.includes(value))
        .map((value) => `${code}:${value}`);
    });
    expect(misread).toEqual([]);
  });
});
