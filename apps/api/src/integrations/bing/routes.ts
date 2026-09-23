// Bing site discovery and per-profile binding.
//
// Discovery is read-only and never returns a raw provider error: the section
// carries a state the UI can explain. Binding writes validate the chosen site
// against what the caller's own Bing grant can actually read, so an account can
// never point a report at a site it does not own — the same authorization rule
// the Google binding enforces, and for the same reason.

import { Router } from 'express';
import type { PrismaClient, SiteBingBinding } from '@prisma/client';
import { z } from 'zod';

import { accountIdFrom, requireAuth } from '../../auth/middleware.ts';
import { sendOk } from '../../http/envelope.ts';
import { ApiError, conflict } from '../../http/errors.ts';
import type { ApiLogger } from '../../http/logger.ts';
import { requiredParam } from '../../http/params.ts';
import { parseInput } from '../../http/validate.ts';
import { findOwnProfile } from '../../profiles/routes.ts';
import { oauthConfigFor, readIntegrationConfig } from '../config.ts';
import { listBingSites } from './api.ts';
import { BingApiError, detailFor, detailOf, stateOf } from './errors.ts';
import type { BingRequestOptions } from './http.ts';
import { prismaBingConnectionStore } from './store.ts';
import { resolveBingAccess, type BingAccess } from './tokens.ts';
import type { BingDataState, BingSite } from './types.ts';

export interface BingRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly requestOptions?: BingRequestOptions;
  readonly tokenFetcher?: typeof fetch;
  /** Where Bing's reason for a refused discovery request is written. */
  readonly logger?: ApiLogger;
}

const bindingInputSchema = z.object({
  // Bing matches on the exact string GetUserSites handed out, so the value is
  // length-checked and stored verbatim rather than normalised into an origin.
  siteUrl: z.string().min(1).max(2048).nullable().optional(),
});

/**
 * Why a list is unavailable, where the state alone does not say. `no_access`
 * covers both a grant that never included read scope and Bing refusing the
 * listing, and only the first is fixed by reconnecting with the right consent.
 */
type DiscoveryReason = 'missing_scope';

interface DiscoverySection<T> {
  readonly state: BingDataState;
  readonly detail: string;
  readonly reason: DiscoveryReason | null;
  readonly items: readonly T[];
}

function section<T>(
  state: BingDataState,
  detail: string,
  items: readonly T[],
  reason: DiscoveryReason | null = null,
): DiscoverySection<T> {
  return { state, detail, reason, items };
}

/**
 * A refused listing. The shared `no_access` sentence speaks of "the selected
 * site", which is wrong while the owner is still choosing one.
 */
const LISTING_DENIED_DETAIL = 'Bing refused to list the sites this account can read.';

const MISSING_SCOPE_DETAIL =
  'The Bing authorization does not include read access. Reconnect Bing Webmaster Tools to grant it.';

interface BingBindingView {
  readonly siteProfileId: string;
  readonly siteUrl: string | null;
  readonly verifiedAtSelection: boolean;
  readonly updatedAt: string;
}

function bindingView(binding: SiteBingBinding): BingBindingView {
  return {
    siteProfileId: binding.siteProfileId,
    siteUrl: binding.siteUrl,
    verifiedAtSelection: binding.verifiedAtSelection,
    updatedAt: binding.updatedAt.toISOString(),
  };
}

/**
 * Turns a Bing failure into a typed API error, so the UI shows "reconnect Bing"
 * rather than the generic 500 the error handler would otherwise answer.
 */
function asApiError(error: unknown): Error {
  if (!(error instanceof BingApiError)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return error.state === 'needs_reconnect' || error.state === 'not_connected'
    ? new ApiError(409, 'BING_NOT_CONNECTED', error.detail)
    : error.state === 'no_access'
      ? new ApiError(403, 'BING_NO_ACCESS', error.detail)
      : new ApiError(503, 'BING_UNAVAILABLE', error.detail);
}

async function discoverSites(
  access: BingAccess,
  options: BingRequestOptions,
): Promise<DiscoverySection<BingSite>> {
  if (!access.hasWebmasterScope) {
    return section('no_access', MISSING_SCOPE_DETAIL, [], 'missing_scope');
  }
  try {
    const sites = await listBingSites(access.accessToken, options);
    return sites.length === 0
      ? section('no_data', 'This Bing account has no sites in Bing Webmaster Tools.', sites)
      : section('connected', detailFor('connected'), sites);
  } catch (error) {
    const state = stateOf(error);
    return section(state, state === 'no_access' ? LISTING_DENIED_DETAIL : detailOf(error), []);
  }
}

export function bingIntegrationRouter(deps: BingRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);
  const requestOptions: BingRequestOptions = {
    ...deps.requestOptions,
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),
  };

  const accessFor = async (accountId: string): Promise<BingAccess> =>
    resolveBingAccess(
      {
        store: prismaBingConnectionStore(deps.prisma, deps.now),
        oauthConfig: oauthConfigFor(readIntegrationConfig(), 'bing'),
        now: deps.now,
        ...(deps.tokenFetcher === undefined ? {} : { fetcher: deps.tokenFetcher }),
      },
      accountId,
    );

  router.get('/integrations/bing/sites', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    let access: BingAccess;
    try {
      access = await accessFor(accountId);
    } catch (error) {
      const state = stateOf(error);
      sendOk(res, {
        connection: { state, detail: detailOf(error) },
        sites: section(state, detailOf(error), []),
      });
      return;
    }
    sendOk(res, {
      connection: { state: 'connected' as const, detail: detailFor('connected') },
      sites: await discoverSites(access, requestOptions),
    });
  });

  // Every profile's binding at once, so the panel can show which Bing site feeds
  // which profile without one request per profile.
  router.get('/integrations/bing/bindings', auth, async (req, res) => {
    const bindings = await deps.prisma.siteBingBinding.findMany({
      where: { accountId: accountIdFrom(res) },
      orderBy: { createdAt: 'asc' },
    });
    sendOk(res, bindings.map(bindingView));
  });

  router.get('/profiles/:profileId/bing-binding', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const profile = await findOwnProfile(
      deps.prisma,
      accountId,
      requiredParam(req.params.profileId, 'profileId'),
    );
    const binding = await deps.prisma.siteBingBinding.findFirst({
      where: { siteProfileId: profile.id, accountId },
    });
    sendOk(res, binding === null ? null : bindingView(binding));
  });

  router.put('/profiles/:profileId/bing-binding', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const profile = await findOwnProfile(
      deps.prisma,
      accountId,
      requiredParam(req.params.profileId, 'profileId'),
    );
    const siteUrl = parseInput(bindingInputSchema, req.body).siteUrl ?? null;

    let verifiedAtSelection = false;
    if (siteUrl !== null) {
      try {
        const access = await accessFor(accountId);
        // Authorization, not convenience: the binding is only accepted for a
        // site this account's own Bing grant can read.
        const sites = await listBingSites(access.accessToken, requestOptions);
        const match = sites.find((site) => site.siteUrl === siteUrl);
        if (match === undefined) {
          throw conflict(
            'BING_SITE_NOT_AVAILABLE',
            'That site is not available to the connected Bing account.',
          );
        }
        verifiedAtSelection = match.isVerified;
      } catch (error) {
        throw asApiError(error);
      }
    }

    const data = { siteUrl, verifiedAtSelection };
    const saved = await deps.prisma.siteBingBinding.upsert({
      where: { siteProfileId: profile.id },
      create: { accountId, siteProfileId: profile.id, ...data },
      update: data,
    });
    sendOk(res, bindingView(saved));
  });

  router.delete('/profiles/:profileId/bing-binding', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const profile = await findOwnProfile(
      deps.prisma,
      accountId,
      requiredParam(req.params.profileId, 'profileId'),
    );
    await deps.prisma.siteBingBinding.deleteMany({
      where: { siteProfileId: profile.id, accountId },
    });
    sendOk(res, null);
  });

  return router;
}
