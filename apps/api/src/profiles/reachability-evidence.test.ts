import { describe, expect, it } from 'vitest';
import { parseReachabilityEvidence } from './reachability-routes.ts';
describe('stored reachability evidence compatibility', () => {
  it('reads legacy signal arrays', () =>
    expect(parseReachabilityEvidence('["server: cloudflare",1]')).toEqual({
      accessControlSignals: ['server: cloudflare'],
    }));
  it('reads the new optional flag', () =>
    expect(parseReachabilityEvidence('{"signals":[],"searchEnginesBlocked":true}')).toEqual({
      accessControlSignals: [],
      searchEnginesBlocked: true,
    }));
  it.each(['null', '{}', 'invalid', '{"signals":"bad","searchEnginesBlocked":"true"}'])(
    'ignores malformed evidence %s',
    (json) => expect(parseReachabilityEvidence(json)).toEqual({ accessControlSignals: [] }),
  );
});

it('preserves valid names and drops malformed name lists', () => {
  expect(
    parseReachabilityEvidence('{"signals":[],"blockedSearchEngines":["Google","Bing"]}'),
  ).toEqual({ accessControlSignals: [], blockedSearchEngines: ['Google', 'Bing'] });
  expect(parseReachabilityEvidence('{"signals":[],"blockedSearchEngines":["Unknown"]}')).toEqual({
    accessControlSignals: [],
  });
});
