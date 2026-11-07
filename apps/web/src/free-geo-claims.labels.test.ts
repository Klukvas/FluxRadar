import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PROFILE_LABELS_UK, evidenceLabel } from './free-geo-claims';

// The API names profile evidence in English (packages/ai/src/geo-evidence.ts
// PROFILE_FIELDS) and the Free report translates those names for a Ukrainian
// reader. The web app cannot import packages/ai, so this reads its source: a
// label added or renamed there without a Ukrainian name here fails the build
// instead of reaching a Ukrainian report in English.

// Resolved from the vitest root (apps/web), as in free-score-copy.test.ts.
const GEO_EVIDENCE = resolve(process.cwd(), '../../packages/ai/src/geo-evidence.ts');
const SOURCE = readFileSync(GEO_EVIDENCE, 'utf8');

/** A quoted string literal in either quote style; group 1 or 2 is its text. */
const STRING = String.raw`(?:'([^']*)'|"([^"]*)")`;
const ROW = new RegExp(String.raw`\[\s*${STRING}\s*,\s*${STRING}\s*,?\s*\]`, 'g');

/**
 * The labels of every `[field, label]` row of PROFILE_FIELDS in `source`.
 *
 * Any key — letters, digits, underscores — and either quote style is read, and
 * a row this cannot read throws instead of being skipped: a skipped row is a
 * label that would reach a Ukrainian report in English while the guard passed.
 */
function profileFieldLabels(source: string): readonly string[] {
  const block = /const PROFILE_FIELDS[^=]*=\s*\[([\s\S]*?)\n\](?:\s+as\s+const)?;/.exec(
    source,
  )?.[1];
  if (block === undefined) throw new Error('PROFILE_FIELDS not found in geo-evidence.ts');
  const rows = [...block.matchAll(ROW)];
  const opened = (block.match(/\[/g) ?? []).length;
  if (rows.length !== opened) {
    throw new Error(`read ${rows.length} of ${opened} PROFILE_FIELDS rows; update the parser`);
  }
  return rows.map((match) => match[3] ?? match[4] ?? '');
}

/** Whether every label in `source` has a Ukrainian name, and no name is left over. */
function guardHolds(source: string): boolean {
  try {
    const labels = [...profileFieldLabels(source)].sort();
    return JSON.stringify(Object.keys(PROFILE_LABELS_UK).sort()) === JSON.stringify(labels);
  } catch {
    return false;
  }
}

/** The real source with the line naming `label` rewritten. */
function withRow(label: string, replacement: string): string {
  const line = SOURCE.split('\n').find((text) => text.includes(`'${label}'`));
  if (line === undefined) throw new Error(`no row for ${label}`);
  return SOURCE.replace(line, replacement);
}

describe('Ukrainian names for profile evidence labels', () => {
  it('reads the labels the API emits', () => {
    expect(profileFieldLabels(SOURCE)).toContain('Brand name');
    expect(profileFieldLabels(SOURCE).length).toBeGreaterThanOrEqual(8);
  });

  it('has a Ukrainian name for every label, and none for a label that no longer exists', () => {
    expect(Object.keys(PROFILE_LABELS_UK).sort()).toEqual([...profileFieldLabels(SOURCE)].sort());
    for (const label of profileFieldLabels(SOURCE)) {
      expect(evidenceLabel('profile', label, 'uk')).not.toBe(label);
    }
  });
});

// The guard itself, against edits to an in-memory copy of geo-evidence.ts.
describe('the label guard catches', () => {
  const brandRow = "  ['brand', 'Brand name'],";

  it('holds on the real source', () => {
    expect(guardHolds(SOURCE)).toBe(true);
  });

  it.each([
    ['a key with a digit', `${brandRow}\n  ['region2', 'Secondary region'],`],
    ['a key with an underscore', `${brandRow}\n  ['opening_hours', 'Opening hours'],`],
    ['a renamed label', "  ['brand', 'Brand'],"],
    ['a double-quoted label with an apostrophe', `${brandRow}\n  ['owner', "Owner's name"],`],
    ['a removed label', ''],
    ['a row it cannot read', `${brandRow}\n  [FIELD, LABEL],`],
  ])('%s', (_case, replacement) => {
    expect(guardHolds(withRow('Brand name', replacement))).toBe(false);
  });

  it.each([
    ['a row split over lines', "  [\n    'brand',\n    'Brand name',\n  ],"],
    ['a trailing comma inside a row', "  ['brand', 'Brand name',],"],
    ['the brand row in double quotes', '  ["brand", "Brand name"],'],
  ])('and still holds after %s', (_case, replacement) => {
    expect(guardHolds(withRow('Brand name', replacement))).toBe(true);
  });

  it('and still holds when the list is declared `as const`', () => {
    const asConst = SOURCE.replace(
      /(const PROFILE_FIELDS[^=]*=\s*\[[\s\S]*?\n\]);/,
      '$1 as const;',
    );
    expect(asConst).not.toBe(SOURCE);
    expect(guardHolds(asConst)).toBe(true);
  });
});
