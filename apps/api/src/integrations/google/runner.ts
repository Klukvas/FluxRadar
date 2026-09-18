// Scan-time entry point. Produces the Google data for one scan and never
// throws: a Google problem is data in the report, not a scan failure.

import type { PrismaClient } from '@prisma/client';

import { oauthConfigFor, readIntegrationConfig } from '../config.ts';
import { detailOf, stateOf } from './errors.ts';
import type { GoogleRequestOptions } from './http.ts';
import { connectionStateSnapshot, fetchGoogleScanData, type GoogleBinding } from './snapshot.ts';
import { isEmptyBinding, loadGoogleBinding, prismaGoogleConnectionStore } from './store.ts';
import { resolveGoogleAccess } from './tokens.ts';
import type { GoogleScanData } from './types.ts';

export type GoogleDataRunner = (
  accountId: string,
  siteProfileId: string,
) => Promise<GoogleScanData>;

export interface GoogleDataRunnerOptions {
  readonly prisma: PrismaClient;
  readonly now?: () => Date;
  readonly requestOptions?: GoogleRequestOptions;
  /** Test seam for the token endpoint; Google API reads use requestOptions.fetcher. */
  readonly tokenFetcher?: typeof fetch;
}

export function createGoogleDataRunner(options: GoogleDataRunnerOptions): GoogleDataRunner {
  const now = options.now ?? ((): Date => new Date());
  return async (accountId, siteProfileId) => {
    const timestamp = now();
    const binding: GoogleBinding = await loadGoogleBinding(
      options.prisma,
      accountId,
      siteProfileId,
    );
    try {
      const access = await resolveGoogleAccess(
        {
          store: prismaGoogleConnectionStore(options.prisma, now),
          oauthConfig: oauthConfigFor(readIntegrationConfig(), 'google'),
          now,
          ...(options.tokenFetcher === undefined ? {} : { fetcher: options.tokenFetcher }),
        },
        accountId,
      );
      if (isEmptyBinding(binding)) {
        // Connected but unbound is a distinct, actionable state: the report tells
        // the user to pick a property instead of implying Google has no data.
        return {
          snapshot: connectionStateSnapshot(
            'no_property_selected',
            'No Google property is linked to this profile yet. Choose one in Integrations.',
            timestamp,
          ),
          searchConsoleDetail: null,
        };
      }
      return await fetchGoogleScanData({
        access,
        binding,
        now: timestamp,
        ...(options.requestOptions === undefined ? {} : { requestOptions: options.requestOptions }),
      });
    } catch (error) {
      return {
        snapshot: connectionStateSnapshot(stateOf(error), detailOf(error), timestamp),
        searchConsoleDetail: null,
      };
    }
  };
}
