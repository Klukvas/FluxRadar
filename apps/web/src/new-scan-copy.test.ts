// The Ukrainian new-scan screen calls a scan «перевірка» and the bot «краулер»,
// as the rest of the Ukrainian interface does. «скан» and «сканер» crept into
// this file once; an owner reading both words on one screen cannot tell they
// mean the same thing.

import { describe, expect, it } from 'vitest';

import { newScanCopy } from './new-scan-copy';

function stringsOf(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') return [];
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsOf);
  return [];
}

describe('Ukrainian new-scan wording', () => {
  it('says «перевірка» and «краулер», never «скан» or «сканер»', () => {
    const offending = stringsOf(newScanCopy.uk).filter((text) => /скан/i.test(text));
    expect(offending).toEqual([]);
  });
});
