// Contract tests against Microsoft's own documented payloads.
//
// The response bodies below are copied from the JSON samples on the Bing
// Webmaster API reference pages, field for field, including the `__type`
// discriminator and the `/Date(…)/` serialisation. They are here so a change to
// our parsing that silently stops reading Bing's actual shape fails, rather than
// producing an empty section that looks like "this site has no Bing data".
//
//   GetUserSites            learn.microsoft.com/en-us/dotnet/api/
//                           microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getusersites
//   GetQueryStats           …iwebmasterapi.getquerystats
//   GetRankAndTrafficStats  …iwebmasterapi.getrankandtrafficstats
//   error envelope          learn.microsoft.com/en-us/bingwebmaster/getting-started
//   bearer auth             learn.microsoft.com/en-us/bingwebmaster/oauth2 (step 6)

import { describe, expect, it, vi } from 'vitest';

import { BING_METHODS, fetchBingQueryStats, fetchBingTrafficStats, listBingSites } from './api.ts';
import { BingApiError } from './errors.ts';
import { BING_API_BASE_URL } from './http.ts';

/** Verbatim from the GetUserSites reference page. */
const USER_SITES_SAMPLE = {
  d: [
    {
      __type: 'Site:#Microsoft.Bing.Webmaster.Api',
      AuthenticationCode: '258CAD36B9EEE22F1CFDEB4C239D26BB',
      DnsVerificationCode: '258cad36b9eee22f1cfdeb4c239d26bb.example.com',
      IsVerified: false,
      Url: 'http://example.com',
    },
  ],
};

/** Verbatim from the GetQueryStats reference page. */
const QUERY_STATS_SAMPLE = {
  d: [
    {
      __type: 'QueryStats:#Microsoft.Bing.Webmaster.Api',
      AvgClickPosition: 18,
      AvgImpressionPosition: 17,
      Clicks: 15,
      Date: '/Date(1316156400000-0700)/',
      Impressions: 100,
      Query: 'query',
    },
  ],
};

/** Verbatim from the GetRankAndTrafficStats reference page. */
const TRAFFIC_STATS_SAMPLE = {
  d: [
    {
      __type: 'RankAndTrafficStats:#Microsoft.Bing.Webmaster.Api',
      Clicks: 15,
      Date: '/Date(1316156400000-0700)/',
      Impressions: 100,
    },
  ],
};

/** Verbatim from the "JSON error response sample" in Getting Started. */
const INVALID_KEY_FAULT = { ErrorCode: 3, Message: 'InvalidApiKey' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function fetcherFor(body: unknown, status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body, status));
}

describe('Bing transport', () => {
  it('calls the documented JSON endpoint with a bearer token and no api key', async () => {
    const fetcher = fetcherFor(USER_SITES_SAMPLE);
    await listBingSites('access-token-value', { fetcher });

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${BING_API_BASE_URL}/${BING_METHODS.userSites}`);
    expect(init?.method).toBe('GET');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer access-token-value' });
    // The API-key transport is a different authentication mode entirely; sending
    // both is how a request ends up authenticated as the wrong identity.
    expect(String(url)).not.toContain('apikey');
  });

  it('puts siteUrl in the query string of the stats methods', async () => {
    const fetcher = fetcherFor(QUERY_STATS_SAMPLE);
    await fetchBingQueryStats('token', 'https://example.com/', { fetcher });

    const [url] = fetcher.mock.calls[0] ?? [];
    const parsed = new URL(String(url));
    expect(parsed.pathname.endsWith(`/${BING_METHODS.queryStats}`)).toBe(true);
    expect(parsed.searchParams.get('siteUrl')).toBe('https://example.com/');
  });

  it('never sends the token in the URL', async () => {
    const fetcher = fetcherFor(TRAFFIC_STATS_SAMPLE);
    await fetchBingTrafficStats('secret-token', 'https://example.com/', { fetcher });
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain('secret-token');
  });
});

describe('GetUserSites', () => {
  it('reads Bing’s documented Site payload', async () => {
    const sites = await listBingSites('token', { fetcher: fetcherFor(USER_SITES_SAMPLE) });
    expect(sites).toEqual([{ siteUrl: 'http://example.com', isVerified: false }]);
  });

  it('keeps unverified sites so the owner can be told to verify them', async () => {
    const sites = await listBingSites('token', {
      fetcher: fetcherFor({
        d: [
          { Url: 'https://a.example', IsVerified: true },
          { Url: 'https://b.example', IsVerified: false },
        ],
      }),
    });
    expect(sites).toEqual([
      { siteUrl: 'https://a.example', isVerified: true },
      { siteUrl: 'https://b.example', isVerified: false },
    ]);
  });

  it('fails the call for an entry with no URL instead of listing one site fewer', async () => {
    const error = await listBingSites('token', {
      fetcher: fetcherFor({
        d: [{ Url: 'https://a.example', IsVerified: true }, { IsVerified: true }],
      }),
      maxAttempts: 1,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BingApiError);
    expect((error as BingApiError).state).toBe('request_failed');
  });

  it('fails the call for an entry that states no verification status', async () => {
    const error = await listBingSites('token', {
      fetcher: fetcherFor({ d: [{ Url: 'https://a.example' }] }),
      maxAttempts: 1,
    }).catch((caught: unknown) => caught);
    expect((error as BingApiError).state).toBe('request_failed');
  });
});

describe('GetQueryStats', () => {
  it('reads Bing’s documented QueryStats payload and derives the rate', async () => {
    const rows = await fetchBingQueryStats('token', 'https://example.com/', {
      fetcher: fetcherFor(QUERY_STATS_SAMPLE),
    });
    expect(rows).toEqual([
      {
        query: 'query',
        clicks: 15,
        impressions: 100,
        ctr: 0.15,
        avgImpressionPosition: 17,
        avgClickPosition: 18,
        date: '2011-09-16',
      },
    ]);
  });

  it('reports a zero rate rather than a division by zero', async () => {
    const rows = await fetchBingQueryStats('token', 'https://example.com/', {
      fetcher: fetcherFor({
        d: [{ Query: 'q', Clicks: 0, Impressions: 0, Date: '/Date(1316156400000-0700)/' }],
      }),
    });
    expect(rows[0]?.ctr).toBe(0);
  });

  it('records an absent average position as absent, which the report type allows', async () => {
    const rows = await fetchBingQueryStats('token', 'https://example.com/', {
      fetcher: fetcherFor({
        d: [{ Query: 'q', Clicks: 3, Impressions: 40, Date: '/Date(1316156400000-0700)/' }],
      }),
    });
    expect(rows[0]).toMatchObject({ avgClickPosition: null, avgImpressionPosition: null });
  });

  it.each([
    ['a missing click count', { Query: 'q', Impressions: 40, Date: '/Date(1316156400000-0700)/' }],
    [
      'a null click count',
      { Query: 'q', Clicks: null, Impressions: 40, Date: '/Date(1316156400000-0700)/' },
    ],
    [
      'a click count that is not a number',
      { Query: 'q', Clicks: '3', Impressions: 40, Date: '/Date(1316156400000-0700)/' },
    ],
    [
      'a negative impression count',
      { Query: 'q', Clicks: 0, Impressions: -1, Date: '/Date(1316156400000-0700)/' },
    ],
    ['a date Bing did not serialise', { Query: 'q', Clicks: 1, Impressions: 2, Date: 'yesterday' }],
  ])('fails the call rather than reporting zero for %s', async (_case, row) => {
    const error = await fetchBingQueryStats('token', 'https://example.com/', {
      fetcher: fetcherFor({ d: [row] }),
      maxAttempts: 1,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BingApiError);
    expect((error as BingApiError).state).toBe('request_failed');
  });
});

describe('GetRankAndTrafficStats', () => {
  it('reads Bing’s documented RankAndTrafficStats payload', async () => {
    const days = await fetchBingTrafficStats('token', 'https://example.com/', {
      fetcher: fetcherFor(TRAFFIC_STATS_SAMPLE),
    });
    expect(days).toEqual([{ date: '2011-09-16', clicks: 15, impressions: 100 }]);
  });

  it('fails the call for a row with no usable date, which would understate the period', async () => {
    const error = await fetchBingTrafficStats('token', 'https://example.com/', {
      fetcher: fetcherFor({ d: [{ Clicks: 5, Impressions: 10 }] }),
      maxAttempts: 1,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BingApiError);
    expect((error as BingApiError).state).toBe('request_failed');
  });

  it('accepts a whole documented day with no traffic at all', async () => {
    const days = await fetchBingTrafficStats('token', 'https://example.com/', {
      fetcher: fetcherFor({
        d: [{ Clicks: 0, Impressions: 0, Date: '/Date(1316156400000-0700)/' }],
      }),
    });
    expect(days).toEqual([{ date: '2011-09-16', clicks: 0, impressions: 0 }]);
  });
});

describe('malformed payloads', () => {
  it.each([
    ['an object where an array is documented', { d: { Url: 'https://a.example' } }],
    ['a string', { d: 'nope' }],
    ['null', { d: null }],
  ])('fails the call for %s instead of returning an empty list', async (_case, body) => {
    const error = await listBingSites('token', {
      fetcher: fetcherFor(body),
      maxAttempts: 1,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BingApiError);
    expect((error as BingApiError).state).toBe('request_failed');
  });

  it('says the data could not be read, and never quotes the payload back', async () => {
    const error = await fetchBingQueryStats('token', 'https://example.com/', {
      fetcher: fetcherFor({ d: [{ Query: 'secret-query', Clicks: 'many' }] }),
      maxAttempts: 1,
    }).catch((caught: unknown) => caught);
    const detail = (error as BingApiError).detail;
    expect(detail).toContain('could not read');
    expect(detail).not.toContain('secret-query');
  });

  it('does not retry a payload that will not parse on a second attempt either', async () => {
    const fetcher = fetcherFor({ d: [{ Url: 'https://a.example' }] });
    await listBingSites('token', { fetcher, sleep: async () => {} }).catch(() => null);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('Bing faults', () => {
  it('maps the documented 400 InvalidApiKey fault to needs_reconnect', async () => {
    const error = await listBingSites('token', {
      fetcher: fetcherFor(INVALID_KEY_FAULT, 400),
      maxAttempts: 1,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BingApiError);
    expect((error as BingApiError).state).toBe('needs_reconnect');
  });

  it('maps an unrecognised 400 to a provider failure, not to "reconnect"', async () => {
    const error = await listBingSites('token', {
      fetcher: fetcherFor({ ErrorCode: 9, Message: 'SomethingElse' }, 400),
      maxAttempts: 1,
    }).catch((caught: unknown) => caught);
    expect((error as BingApiError).state).toBe('request_failed');
  });

  it('maps 401 from the OAuth layer to needs_reconnect', async () => {
    const error = await listBingSites('token', {
      fetcher: fetcherFor({}, 401),
      maxAttempts: 1,
    }).catch((caught: unknown) => caught);
    expect((error as BingApiError).state).toBe('needs_reconnect');
  });

  it('refuses a 200 that is not the documented envelope', async () => {
    const error = await listBingSites('token', {
      fetcher: fetcherFor([{ Url: 'https://example.com' }]),
      maxAttempts: 1,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BingApiError);
    expect((error as BingApiError).state).toBe('request_failed');
  });

  it('retries a 503 and stops once Bing answers', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse(USER_SITES_SAMPLE));
    const sites = await listBingSites('token', { fetcher, sleep: async () => {} });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sites).toHaveLength(1);
  });

  it('does not retry a fault Bing decided on the merits', async () => {
    const fetcher = fetcherFor(INVALID_KEY_FAULT, 400);
    await listBingSites('token', { fetcher, sleep: async () => {} }).catch(() => null);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('logs the fault code, and neither the access token nor Bing’s own sentence', async () => {
    const warn = vi.fn();
    await listBingSites('secret-token', {
      // Bing's `Message` is free text and can quote what was asked for — here a
      // customer's own property. The code is the closed set an operator acts on;
      // the sentence is what must not reach a log line.
      // An unrecognised fault, whose free-text message quotes the property that
      // was asked about. `state` is `request_failed` for exactly that reason —
      // an unrecognised 400 is our request, not the owner's grant.
      fetcher: fetcherFor(
        { ErrorCode: 9, Message: 'No data for https://private.example.com/' },
        400,
      ),
      maxAttempts: 1,
      logger: { warn },
    }).catch(() => null);
    expect(warn).toHaveBeenCalledWith(
      'bing request rejected',
      expect.objectContaining({ bingErrorCode: 9, status: 400, state: 'request_failed' }),
    );
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('secret-token');
    expect(logged).not.toContain('private.example.com');
    expect(logged).not.toContain('No data for');
  });
});
