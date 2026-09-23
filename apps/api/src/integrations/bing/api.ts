// The three read-only Bing Webmaster methods this product uses, and nothing
// else. Each one is a documented method of `IWebmasterApi`, called over the JSON
// protocol exactly as Microsoft's reference states it:
//
//   GetUserSites            — no parameters; returns Site[]
//                             learn.microsoft.com/en-us/dotnet/api/
//                             microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getusersites
//   GetQueryStats           — ?siteUrl=…; returns QueryStats[]
//                             …iwebmasterapi.getquerystats
//   GetRankAndTrafficStats  — ?siteUrl=…; returns RankAndTrafficStats[]
//                             …iwebmasterapi.getrankandtrafficstats
//
// No endpoint here is invented, and none of them writes. Both stats methods
// return the site's whole retained history rather than a range — neither takes
// date parameters — so the report period is applied on our side, in date-range.ts
// and snapshot.ts. That applies to the QUERY rows as much as to the traffic
// days: `QueryStats` states one query on one day, and the report's per-query
// figures are the days inside the period added up (snapshot.ts).
//
// A PAYLOAD THAT DOES NOT MATCH THE CONTRACT IS A FAILED REQUEST, NOT EMPTY DATA.
// The rule these schemas enforce is simple: a field the report's own type cannot
// represent as absent must be present and valid, or the call fails with
// `request_failed`. Clicks, impressions and the day a row belongs to are such
// fields, and the alternative to failing is a report that states "Bing sent 0
// clicks" when Bing in fact sent something we could not read — a sentence the
// owner would act on. Average positions are nullable in the report's own type
// (Bing omits them for rows with no clicks), so an absent one is recorded as
// absent rather than as a failure.

import { z } from 'zod';

import { BingApiError, MALFORMED_PAYLOAD_DETAIL } from './errors.ts';
import { bingJson, type BingRequestOptions } from './http.ts';
import { parseBingDate } from './date-range.ts';
import type { BingQueryRow, BingSite, BingTrafficDay } from './types.ts';

export const BING_METHODS = {
  userSites: 'GetUserSites',
  queryStats: 'GetQueryStats',
  rankAndTrafficStats: 'GetRankAndTrafficStats',
} as const;

/** A count Bing states as an integer. Never defaulted; never negative. */
const count = z.number().int().nonnegative();

/**
 * A position Bing states as a double, or nothing at all. Bing omits the click
 * position for a query that received no clicks, and the report's own type is
 * nullable for exactly that case.
 */
const position = z
  .number()
  .finite()
  .nullish()
  .transform((value) => value ?? null);

/**
 * One of Bing's `DateTime` values, as the ISO date it denotes.
 *
 * The JSON protocol serialises it in the ASP.NET `/Date(…)/` form; date-range.ts
 * owns reading it. A value that cannot be read fails the schema rather than
 * being dropped, because a traffic row placed in no period at all silently
 * understates the total the report prints.
 */
const bingDate = z
  .unknown()
  .transform((value) => parseBingDate(value))
  .refine((value): value is string => value !== null, {
    message: 'not a Bing DateTime',
  });

/** `Site`, as GetUserSites states it. */
const siteSchema = z.object({
  Url: z.string().min(1),
  IsVerified: z.boolean(),
});

/** `QueryStats`, as GetQueryStats states it. */
const queryStatsSchema = z.object({
  Query: z.string().min(1),
  Clicks: count,
  Impressions: count,
  AvgClickPosition: position,
  AvgImpressionPosition: position,
  Date: bingDate,
});

/** `RankAndTrafficStats`, as GetRankAndTrafficStats states it. */
const rankAndTrafficSchema = z.object({
  Clicks: count,
  Impressions: count,
  Date: bingDate,
});

function rate(clicks: number, impressions: number): number {
  return impressions === 0 ? 0 : clicks / impressions;
}

/**
 * The parsed payload, or a thrown `request_failed`.
 *
 * The provider's own text is never propagated: the caller gets the same state it
 * gets for a timeout, because from the report's point of view "Bing answered
 * something we cannot read" and "Bing did not answer" are the same fact.
 */
function parsePayload<T>(schema: z.ZodType<T>, method: string, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  throw new BingApiError('request_failed', MALFORMED_PAYLOAD_DETAIL, {
    method,
    issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  });
}

/**
 * Every site the connected Bing account can see, verified or not.
 *
 * Unverified sites are kept rather than filtered: an owner who added a site to
 * Bing but never finished verifying it needs to be told that, and a list that
 * silently omitted it would read as "Bing does not know this site".
 */
export async function listBingSites(
  accessToken: string,
  options: BingRequestOptions = {},
): Promise<readonly BingSite[]> {
  const payload = await bingJson<unknown>({ method: BING_METHODS.userSites, accessToken }, options);
  const entries = parsePayload(z.array(siteSchema), BING_METHODS.userSites, payload);
  return entries.map((entry) => ({ siteUrl: entry.Url, isVerified: entry.IsVerified }));
}

/** Top-query traffic for one site, as Bing's own rows. */
export async function fetchBingQueryStats(
  accessToken: string,
  siteUrl: string,
  options: BingRequestOptions = {},
): Promise<readonly BingQueryRow[]> {
  const payload = await bingJson<unknown>(
    { method: BING_METHODS.queryStats, accessToken, parameters: { siteUrl } },
    options,
  );
  const entries = parsePayload(z.array(queryStatsSchema), BING_METHODS.queryStats, payload);
  return entries.map((entry) => ({
    query: entry.Query,
    clicks: entry.Clicks,
    impressions: entry.Impressions,
    // Derived, not reported: Bing states clicks and impressions but no rate.
    ctr: rate(entry.Clicks, entry.Impressions),
    avgImpressionPosition: entry.AvgImpressionPosition,
    avgClickPosition: entry.AvgClickPosition,
    date: entry.Date,
  }));
}

/** Daily clicks and impressions for one site, as Bing's own rows. */
export async function fetchBingTrafficStats(
  accessToken: string,
  siteUrl: string,
  options: BingRequestOptions = {},
): Promise<readonly BingTrafficDay[]> {
  const payload = await bingJson<unknown>(
    { method: BING_METHODS.rankAndTrafficStats, accessToken, parameters: { siteUrl } },
    options,
  );
  const entries = parsePayload(
    z.array(rankAndTrafficSchema),
    BING_METHODS.rankAndTrafficStats,
    payload,
  );
  return entries.map((entry) => ({
    date: entry.Date,
    clicks: entry.Clicks,
    impressions: entry.Impressions,
  }));
}
