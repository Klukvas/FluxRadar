// Scan-time entry point for the Bing section. It never throws: a Bing problem is
// data in the report, not a scan failure — the same contract the Google runner
// keeps, for the same reason.

import type { PrismaClient } from '@prisma/client';

import { oauthConfigFor, readIntegrationConfig } from '../config.ts';
import { bingFindings, type BingFinding } from './checks.ts';
import { detailFor, detailOf, stateOf } from './errors.ts';
import type { BingRequestOptions } from './http.ts';
import { bingConnectionStateSnapshot, fetchBingScanData } from './snapshot.ts';
import { isEmptyBingBinding, loadBingBinding, prismaBingConnectionStore } from './store.ts';
import { resolveBingAccess } from './tokens.ts';
import type { BingDataState, BingScanData } from './types.ts';

/** What one scan collected from Bing, plus what it concluded from it. */
export interface BingScanResult extends BingScanData {
  readonly findings: readonly BingFinding[];
}

export type BingDataRunner = (accountId: string, siteProfileId: string) => Promise<BingScanResult>;

export interface BingDataRunnerOptions {
  readonly prisma: PrismaClient;
  readonly now?: () => Date;
  readonly requestOptions?: BingRequestOptions;
  /** Test seam for the token endpoint; Bing API reads use requestOptions.fetcher. */
  readonly tokenFetcher?: typeof fetch;
}

const NO_SITE_DETAIL =
  'No Bing site is linked to this profile yet. Choose one in Integrations to include Bing data.';

export function createBingDataRunner(options: BingDataRunnerOptions): BingDataRunner {
  const now = options.now ?? ((): Date => new Date());
  return async (accountId, siteProfileId) => {
    const timestamp = now();
    const withFindings = (data: BingScanData): BingScanResult => ({
      ...data,
      findings: bingFindings(data.snapshot, data.detail),
    });
    try {
      const binding = await loadBingBinding(options.prisma, accountId, siteProfileId);
      const access = await resolveBingAccess(
        {
          store: prismaBingConnectionStore(options.prisma, now),
          oauthConfig: oauthConfigFor(readIntegrationConfig(), 'bing'),
          now,
          ...(options.tokenFetcher === undefined ? {} : { fetcher: options.tokenFetcher }),
        },
        accountId,
      );
      if (isEmptyBingBinding(binding)) {
        // Connected but unbound is a distinct, actionable state: the report tells
        // the owner to pick a site instead of implying Bing has no data.
        return withFindings({
          snapshot: bingConnectionStateSnapshot('no_property_selected', NO_SITE_DETAIL, timestamp),
          detail: null,
        });
      }
      return withFindings(
        await fetchBingScanData({
          access,
          binding,
          now: timestamp,
          ...(options.requestOptions === undefined
            ? {}
            : { requestOptions: options.requestOptions }),
        }),
      );
    } catch (error) {
      return withFindings({
        snapshot: bingConnectionStateSnapshot(stateOf(error), detailOf(error), timestamp),
        detail: null,
      });
    }
  };
}

/** The snapshot a scan stores when this deployment has no Bing data flow at all. */
export function bingNotConnectedResult(now: Date): BingScanResult {
  return bingStateResult('not_connected', now);
}

/**
 * The snapshot for a state the caller decided on, with no data behind it. Kept
 * separate from `bingNotConnectedResult` so an unexpected client failure is
 * reported as a failure rather than as "the owner never connected Bing" — the
 * two send a reader to completely different places.
 */
export function bingStateResult(state: BingDataState, now: Date): BingScanResult {
  return {
    snapshot: bingConnectionStateSnapshot(state, detailFor(state), now),
    detail: null,
    findings: [],
  };
}
