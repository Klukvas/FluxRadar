import { describe, expect, it } from 'vitest';

import type { ScanModule } from './api';
import { aiAnswerLanguage } from './free-geo-claims';

// The GEO row's `metadata.language` is API data read through an untyped record:
// only the two exact codes the API writes are trusted, anything else is "not
// recorded", and the report then adds no clause and no `lang` (D-237).

const GEO: ScanModule = {
  module: 'AI SEO / GEO',
  status: 'Completed',
  statusReason: null,
  coverage: 1,
  score: null,
  applicableChecks: 1,
  completedApplicableChecks: 1,
  usableOutput: true,
  metadata: { scoring: 'InformationalOnly', freePreview: true },
};

const withLanguage = (language: unknown): ScanModule => ({
  ...GEO,
  metadata: { ...GEO.metadata, language },
});

describe('aiAnswerLanguage', () => {
  it.each([
    ['uk', 'uk'],
    ['en', 'en'],
  ] as const)('reads %s', (stored, expected) => {
    expect(aiAnswerLanguage(withLanguage(stored))).toBe(expected);
  });

  it.each([['ru'], ['UK'], ['uk-UA'], [''], [1], [true], [{}], [[]], [null], [undefined]])(
    'treats %o as not recorded',
    (stored) => {
      expect(aiAnswerLanguage(withLanguage(stored))).toBeNull();
    },
  );

  it('treats a row without the key, without metadata, or with non-object metadata as not recorded', () => {
    expect(aiAnswerLanguage(GEO)).toBeNull();
    const withoutMetadata: ScanModule = { ...GEO, metadata: undefined };
    expect(aiAnswerLanguage(withoutMetadata)).toBeNull();
    for (const metadata of ['uk', 42, null, ['uk']]) {
      expect(aiAnswerLanguage({ ...GEO, metadata } as unknown as ScanModule)).toBeNull();
    }
    expect(aiAnswerLanguage(undefined)).toBeNull();
  });
});
