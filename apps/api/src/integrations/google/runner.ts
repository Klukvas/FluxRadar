// Scan-time entry point. Produces the Google snapshot for one scan and never
// throws: a Google problem is data in the report, not a scan failure.

import type { PrismaClient } from '@prisma/client';

import { oauthConfigFor, readIntegrationConfig } from '../config.ts';
import { detailOf, stateOf } from './errors.ts';
import type { GoogleRequestOptions } from './http.ts';
import {
  connectionStateSnapshot,
  fetchGoogleDataSnapshot,
  type GoogleBinding,
} from './snapshot.ts';
import { isEmptyBinding, loadGoogleBinding, prismaGoogleConnectionStore } from './store.ts';
import { resolveGoogleAccess } from './tokens.ts';
import type { GoogleDataSnapshot } from './types.ts';

export type GoogleDataRunner = (
  accountId: string,
  siteProfileId: string,
) => Promise<GoogleDataSnapshot>;

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
        return connectionStateSnapshot(
          'no_property_selected',
          'No Google property is linked to this website yet. Choose one in Integrations.',
          timestamp,
        );
      }
      return await fetchGoogleDataSnapshot({
        access,
        binding,
        now: timestamp,
        ...(options.requestOptions === undefined ? {} : { requestOptions: options.requestOptions }),
      });
    } catch (error) {
      return connectionStateSnapshot(stateOf(error), detailOf(error), timestamp);
    }
  };
}
