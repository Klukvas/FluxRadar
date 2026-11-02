// The owner's copy rules in the three legal documents.
//
// Their prose is written as JSX in components rather than as values in a
// catalogue, so the runtime walk in `russian-copy-parity-test-support.ts`
// cannot reach them — and that is exactly where the «ИИ» rule was missed. Read
// as source: what is being checked is a spelling, and rendering three long
// documents to find it would prove nothing more.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LATIN_COMPOUND, LATIN_COMPOUND_ALL } from './russian-copy-parity-test-support';

describe('the Russian legal documents', () => {
  // The legal documents are prose in a component rather than values in a
  // catalogue, so the walk above cannot reach them — and that is exactly where
  // the rule was missed. Read as source: what is being checked is a spelling,
  // and rendering three long documents to find it would prove nothing more.
  it('names the technology «ИИ» in the legal documents too', () => {
    for (const file of ['legal/PrivacyPolicy.ru.tsx', 'legal/CookiePolicy.ru.tsx']) {
      const source = readFileSync(resolve(process.cwd(), 'src', file), 'utf8');
      expect(source.match(LATIN_COMPOUND_ALL) ?? [], file).toEqual([]);
      // Not an empty or renamed file, which would pass the line above.
      expect(source, file).toContain('ИИ');
    }

    // The Terms hold all three languages in one file, so only the Russian
    // block is read: «AI‑видимість» is the Ukrainian document's own wording.
    const terms = readFileSync(resolve(process.cwd(), 'src/legal/TermsOfService.tsx'), 'utf8');
    const russian = terms.slice(
      terms.indexOf('function RussianTerms('),
      terms.indexOf('function UkrainianTerms('),
    );
    expect(russian).toContain('ИИ‑видимость');
    expect(russian.match(LATIN_COMPOUND_ALL) ?? []).toEqual([]);
    // And the control: the same grep over the rest of the file does see one,
    // so a slice that silently missed the Russian block would be caught.
    expect(terms.slice(terms.indexOf('function UkrainianTerms('))).toMatch(LATIN_COMPOUND);
  });
});
