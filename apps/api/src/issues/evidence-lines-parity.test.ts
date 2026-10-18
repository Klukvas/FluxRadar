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

/** Each line's code and the value names it reads (`v.text('title')`, `v.count('length')`). */
function linesOf(name: string): ReadonlyMap<string, readonly string[]> {
  const body = block(name);
  const entries = [...body.matchAll(/^ {2}'([a-z0-9.-]+)': /gm)];
  return new Map(
    entries.map((entry, index) => {
      const next = entries[index + 1]?.index ?? body.length;
      const source = body.slice(entry.index ?? 0, next);
      const values = [...source.matchAll(/v\.(?:text|count|address)\('(\w+)'\)/g)].map(
        (match) => match[1] ?? '',
      );
      return [entry[1] ?? '', [...new Set(values)]];
    }),
  );
}

const EN = linesOf('EN_LINES');
const UK = linesOf('UK_LINES');

describe('the plain evidence lines follow the message catalogue', () => {
  it('has a line in both languages for the same codes', () => {
    expect(EN.size).toBeGreaterThan(0);
    expect([...UK.keys()].sort()).toEqual([...EN.keys()].sort());
  });

  it('names only codes the catalogue has', () => {
    const unknown = [...EN.keys()].filter((code) => !(code in FINDING_MESSAGES));
    expect(unknown).toEqual([]);
  });

  it('reads only values the code is filled with', () => {
    const misread = [...EN, ...UK].flatMap(([code, values]) => {
      const template = FINDING_MESSAGES[code as keyof typeof FINDING_MESSAGES];
      if (template === undefined) return [];
      const recorded = placeholdersOf(template.en);
      return values.filter((value) => !recorded.includes(value)).map((value) => `${code}:${value}`);
    });
    expect(misread).toEqual([]);
  });
});
