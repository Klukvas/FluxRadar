// Google property discovery and per-site binding.
//
// Discovery is read-only and never returns a raw provider error: each service
// carries a state the UI can explain. Binding writes validate the chosen
// property against what the caller's own Google grant can actually read, so an
// account can never point a report at a property it does not own.

import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { accountIdFrom, requireAuth } from '../../auth/middleware.ts';
import { sendOk } from '../../http/envelope.ts';
import { ApiError, conflict } from '../../http/errors.ts';
import type { ApiLogger } from '../../http/logger.ts';
import { requiredParam } from '../../http/params.ts';
import { parseInput } from '../../http/validate.ts';
import { findOwnProfile } from '../../profiles/routes.ts';
import { oauthConfigFor, readIntegrationConfig } from '../config.ts';
import { listGa4Properties } from './analytics.ts';
import { GoogleApiError, detailFor, detailOf, stateOf } from './errors.ts';
import type { GoogleRequestOptions } from './http.ts';
import { listSearchConsoleSites } from './search-console.ts';
import { prismaGoogleConnectionStore } from './store.ts';
import { resolveGoogleAccess, type GoogleAccess } from './tokens.ts';
import type { Ga4Property, GoogleDataState, SearchConsoleSite } from './types.ts';

export interface GoogleRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly requestOptions?: GoogleRequestOptions;
  readonly tokenFetcher?: typeof fetch;
  /** Where Google's reason for a refused discovery request is written. */
  readonly logger?: ApiLogger;
}

const bindingInputSchema = z.object({
  searchConsoleSiteUrl: z.string().min(1).max(2048).nullable().optional(),
  // GA4 ids are numeric; anything else cannot address a property.
  ga4PropertyId: z
    .string()
    .regex(/^\d{1,20}$/, 'ga4PropertyId must be a numeric GA4 property id')
    .nullable()
    .optional(),
});

/**
 * Why a list is unavailable, where the state alone does not say. `no_access`
 * covers both a grant that never included the service and Google refusing the
 * listing, and only the first is fixed by reconnecting with the right consent.
 */
type DiscoveryReason = 'missing_scope';

interface DiscoverySection<T> {
  readonly state: GoogleDataState;
  readonly detail: string;
  readonly reason: DiscoveryReason | null;
  readonly items: readonly T[];
}

function section<T>(
  state: GoogleDataState,
  detail: string,
  items: readonly T[],
  reason: DiscoveryReason | null = null,
): DiscoverySection<T> {
  return { state, detail, reason, items };
}

/**
 * A refused listing. The shared `no_access` sentence speaks of "the selected
 * property", which is wrong while the owner is still choosing one.
 */
const LISTING_DENIED_DETAIL = 'Google refused to list the properties this account can read.';

function discoveryFailure<T>(error: unknown): DiscoverySection<T> {
  const state = stateOf(error);
  return section(state, state === 'no_access' ? LISTING_DENIED_DETAIL : detailOf(error), []);
}

/**
 * Turns a Google failure into a typed API error. Without this the generic error
 * handler would answer 500 and the UI would show a technical message for what
 * is usually an ordinary "reconnect Google" situation.
 */
function asApiError(error: unknown): Error {
  if (!(error instanceof GoogleApiError)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return error.state === 'needs_reconnect' || error.state === 'not_connected'
    ? new ApiError(409, 'GOOGLE_NOT_CONNECTED', error.detail)
    : error.state === 'no_access'
      ? new ApiError(403, 'GOOGLE_NO_ACCESS', error.detail)
      : new ApiError(503, 'GOOGLE_UNAVAILABLE', error.detail);
}

const MISSING_SCOPE_DETAIL =
  'The Google authorization does not include this service. Reconnect Google to grant read-only access.';

async function discoverSearchConsole(
  access: GoogleAccess,
  options: GoogleRequestOptions,
): Promise<DiscoverySection<SearchConsoleSite>> {
  if (!access.hasSearchConsoleScope) {
    return section('no_access', MISSING_SCOPE_DETAIL, [], 'missing_scope');
  }
  try {
    const sites = await listSearchConsoleSites(access.accessToken, options);
    return sites.length === 0
      ? section('no_data', 'This Google account has no verified Search Console properties.', sites)
      : section('connected', detailFor('connected'), sites);
  } catch (error) {
    return discoveryFailure(error);
  }
}

async function discoverAnalytics(
  access: GoogleAccess,
  options: GoogleRequestOptions,
): Promise<DiscoverySection<Ga4Property>> {
  if (!access.hasAnalyticsScope) {
    return section('no_access', MISSING_SCOPE_DETAIL, [], 'missing_scope');
  }
  try {
    const properties = await listGa4Properties(access.accessToken, options);
    return properties.length === 0
      ? section('no_data', 'This Google account has no Google Analytics 4 properties.', properties)
      : section('connected', detailFor('connected'), properties);
  } catch (error) {
    return discoveryFailure(error);
  }
}

export function googleIntegrationRouter(deps: GoogleRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);
  const requestOptions: GoogleRequestOptions = {
    ...deps.requestOptions,
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),
  };

  const accessFor = async (accountId: string): Promise<GoogleAccess> =>
    resolveGoogleAccess(
      {
        store: prismaGoogleConnectionStore(deps.prisma, deps.now),
        oauthConfig: oauthConfigFor(readIntegrationConfig(), 'google'),
        now: deps.now,
        ...(deps.tokenFetcher === undefined ? {} : { fetcher: deps.tokenFetcher }),
      },
      accountId,
    );

  router.get('/integrations/google/properties', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    let access: GoogleAccess;
    try {
      access = await accessFor(accountId);
    } catch (error) {
      const state = stateOf(error);
      sendOk(res, {
        connection: { state, detail: detailOf(error) },
        searchConsole: section(state, detailOf(error), []),
        analytics: section(state, detailOf(error), []),
      });
      return;
    }
    const [searchConsole, analytics] = await Promise.all([
      discoverSearchConsole(access, requestOptions),
      discoverAnalytics(access, requestOptions),
    ]);
    sendOk(res, {
      connection: { state: 'connected' as const, detail: detailFor('connected') },
      searchConsole,
      analytics,
    });
  });

  router.get('/profiles/:profileId/google-binding', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const profile = await findOwnProfile(
      deps.prisma,
      accountId,
      requiredParam(req.params.profileId, 'profileId'),
    );
    const binding = await deps.prisma.siteGoogleBinding.findFirst({
      where: { siteProfileId: profile.id, accountId },
    });
    sendOk(
      res,
      binding === null
        ? null
        : {
            siteProfileId: profile.id,
            searchConsoleSiteUrl: binding.searchConsoleSiteUrl,
            ga4PropertyId: binding.ga4PropertyId,
            ga4PropertyName: binding.ga4PropertyName,
            updatedAt: binding.updatedAt.toISOString(),
          },
    );
  });

  router.put('/profiles/:profileId/google-binding', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const profile = await findOwnProfile(
      deps.prisma,
      accountId,
      requiredParam(req.params.profileId, 'profileId'),
    );
    const input = parseInput(bindingInputSchema, req.body);
    const searchConsoleSiteUrl = input.searchConsoleSiteUrl ?? null;
    const ga4PropertyId = input.ga4PropertyId ?? null;

    let ga4PropertyName: string | null = null;
    try {
      if (searchConsoleSiteUrl !== null || ga4PropertyId !== null) {
        const access = await accessFor(accountId);
        // Authorization, not convenience: the binding is only accepted for a
        // property this account's own Google grant can read.
        if (searchConsoleSiteUrl !== null) {
          const sites = await listSearchConsoleSites(access.accessToken, requestOptions);
          if (!sites.some((site) => site.siteUrl === searchConsoleSiteUrl)) {
            throw conflict(
              'GOOGLE_PROPERTY_NOT_AVAILABLE',
              'That Search Console property is not available to the connected Google account.',
            );
          }
        }
        if (ga4PropertyId !== null) {
          const properties = await listGa4Properties(access.accessToken, requestOptions);
          const match = properties.find((property) => property.propertyId === ga4PropertyId);
          if (match === undefined) {
            throw conflict(
              'GOOGLE_PROPERTY_NOT_AVAILABLE',
              'That Analytics property is not available to the connected Google account.',
            );
          }
          ga4PropertyName = match.displayName;
        }
      }
    } catch (error) {
      throw asApiError(error);
    }

    const data = { searchConsoleSiteUrl, ga4PropertyId, ga4PropertyName };
    const saved = await deps.prisma.siteGoogleBinding.upsert({
      where: { siteProfileId: profile.id },
      create: { accountId, siteProfileId: profile.id, ...data },
      update: data,
    });
    sendOk(res, {
      siteProfileId: profile.id,
      searchConsoleSiteUrl: saved.searchConsoleSiteUrl,
      ga4PropertyId: saved.ga4PropertyId,
      ga4PropertyName: saved.ga4PropertyName,
      updatedAt: saved.updatedAt.toISOString(),
    });
  });

  router.delete('/profiles/:profileId/google-binding', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const profile = await findOwnProfile(
      deps.prisma,
      accountId,
      requiredParam(req.params.profileId, 'profileId'),
    );
    await deps.prisma.siteGoogleBinding.deleteMany({
      where: { siteProfileId: profile.id, accountId },
    });
    sendOk(res, null);
  });

  return router;
}
