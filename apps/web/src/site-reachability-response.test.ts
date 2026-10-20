import { describe, expect, it } from 'vitest';
import { readSiteReachability } from './site-reachability-response';
describe('optional search-engine evidence validation', () => {
  const base = { state: 'blocked-by-robots', canPurchase: false };
  it('accepts legacy answers and concrete name lists', () => {
    expect(readSiteReachability(base)).toEqual(base);
    expect(
      readSiteReachability({
        ...base,
        searchEnginesBlocked: true,
        blockedSearchEngines: ['Google', 'Bing'],
      }),
    ).not.toBeNull();
  });
  it.each([
    { searchEnginesBlocked: 'true' },
    { blockedSearchEngines: 'Google' },
    { blockedSearchEngines: ['Googlebot'] },
    { blockedSearchEngines: [1] },
  ])('rejects malformed evidence %s', (extra) =>
    expect(readSiteReachability({ ...base, ...extra })).toBeNull(),
  );
  it('rejects unrelated broad stub responses', () =>
    expect(
      readSiteReachability({ id: 'scan', status: 'Completed', searchEnginesBlocked: true }),
    ).toBeNull());
});
