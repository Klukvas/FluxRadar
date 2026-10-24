// Number agreement in the GEO summary's position line: one answer "mentions",
// several "mention"; Ukrainian follows the count's own form, 21 like 1.

import { describe, expect, it } from 'vitest';

import { geoDigestCopy } from './geo-digest-copy';

describe('the "named first" line', () => {
  it('agrees with one answer and with several in English', () => {
    expect(geoDigestCopy.en.positionFirst(1, 1)).toBe(
      'Named first in 1 of 1 answer that mentions you',
    );
    expect(geoDigestCopy.en.positionFirst(1, 3)).toBe(
      'Named first in 1 of 3 answers that mention you',
    );
  });

  it('agrees with the count in Ukrainian, 1, 2–4, 5+ and 21', () => {
    expect(geoDigestCopy.uk.positionFirst(1, 1)).toBe(
      'Названо першим у 1 з 1 відповіді, що вас згадує',
    );
    expect(geoDigestCopy.uk.positionFirst(1, 3)).toBe(
      'Названо першим у 1 з 3 відповідей, що вас згадують',
    );
    expect(geoDigestCopy.uk.positionFirst(2, 5)).toBe(
      'Названо першим у 2 з 5 відповідей, що вас згадують',
    );
    expect(geoDigestCopy.uk.positionFirst(3, 21)).toBe(
      'Названо першим у 3 з 21 відповіді, що вас згадує',
    );
  });
});
