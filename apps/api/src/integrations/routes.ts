import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import { sendOk } from '../http/envelope.ts';
import { conflict, notFound, validationError } from '../http/errors.ts';
import { requiredParam } from '../http/params.ts';
import {
  isUserIntegrationProvider,
  oauthConfigFor,
  readIntegrationConfig,
  type IntegrationConfig,
  type UserIntegrationProvider,
} from './config.ts';
import { encryptIntegrationSecret, hashOAuthState } from './crypto.ts';
import { authorizationUrl, createOAuthState, exchangeOAuthCode } from './oauth.ts';

export interface IntegrationsRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly frontendOrigin?: string;
}

const STATE_TTL_MS = 10 * 60 * 1000;

interface IntegrationDto {
  readonly provider: string;
  readonly label: string;
  readonly kind: 'user' | 'platform';
  readonly status: 'connected' | 'available' | 'not_configured' | 'needs_reconnect' | 'limited';
  readonly services: readonly string[];
  readonly canConnect: boolean;
  readonly lastCheckedAt: string | null;
  readonly lastError: string | null;
}

function userIntegration(
  provider: UserIntegrationProvider,
  config: IntegrationConfig,
  connection: {
    readonly status: string;
    readonly tokenExpiresAt: Date | null;
    readonly lastCheckedAt: Date | null;
    readonly lastError: string | null;
  } | null,
): IntegrationDto {
  const configured = oauthConfigFor(config, provider) !== null;
  const expired =
    connection?.tokenExpiresAt !== null &&
    connection?.tokenExpiresAt !== undefined &&
    connection.tokenExpiresAt <= new Date();
  const status: IntegrationDto['status'] = !configured
    ? 'not_configured'
    : connection === null
      ? 'available'
      : expired || connection.status !== 'connected'
        ? 'needs_reconnect'
        : 'connected';
  return {
    provider,
    label: provider === 'google' ? 'Google data' : 'Bing Webmaster Tools',
    kind: 'user',
    status,
    services:
      provider === 'google'
        ? ['Google Search Console', 'Google Analytics 4']
        : ['Bing Webmaster Tools'],
    canConnect: configured,
    lastCheckedAt: connection?.lastCheckedAt?.toISOString() ?? null,
    lastError: connection?.lastError ?? null,
  };
}

function callbackUrl(
  config: IntegrationConfig,
  provider: UserIntegrationProvider,
  result: 'connected' | 'error',
  message?: string,
): string {
  const origin = config.frontendOrigin.replace(/\/$/, '');
  const url = new URL(`${origin}/`);
  url.hash = 'integrations';
  url.searchParams.set('integration', provider);
  url.searchParams.set('result', result);
  if (message !== undefined) url.searchParams.set('message', message);
  return url.toString();
}

function safeCallbackMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes('OAuth token exchange failed')) {
    return 'The provider did not accept the authorization. Try connecting again.';
  }
  return 'The integration could not be connected. Check the provider settings and try again.';
}

export function integrationsRouter(deps: IntegrationsRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);

  router.get('/integrations', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const config = readIntegrationConfig();
    const connections = await deps.prisma.integrationConnection.findMany({ where: { accountId } });
    const byProvider = new Map(connections.map((connection) => [connection.provider, connection]));
    const data: IntegrationDto[] = [
      userIntegration('google', config, byProvider.get('google') ?? null),
      userIntegration('bing', config, byProvider.get('bing') ?? null),
    ];
    sendOk(res, data, { meta: { total: data.length, page: 1, limit: data.length } });
  });

  router.post('/integrations/:provider/start', auth, async (req, res) => {
    const providerValue = requiredParam(req.params.provider, 'provider');
    if (!isUserIntegrationProvider(providerValue)) {
      throw notFound('integration provider not found');
    }
    const config = readIntegrationConfig();
    const providerConfig = oauthConfigFor(config, providerValue);
    if (providerConfig === null) {
      throw conflict(
        'INTEGRATION_NOT_CONFIGURED',
        `${providerValue} OAuth is not configured on the server`,
      );
    }
    const state = createOAuthState();
    await deps.prisma.integrationOAuthState.create({
      data: {
        accountId: accountIdFrom(res),
        provider: providerValue,
        stateHash: hashOAuthState(state),
        expiresAt: new Date(deps.now().getTime() + STATE_TTL_MS),
      },
    });
    sendOk(res, {
      provider: providerValue,
      authorizationUrl: authorizationUrl(providerValue, providerConfig, state),
      expiresAt: new Date(deps.now().getTime() + STATE_TTL_MS).toISOString(),
    });
  });

  router.get('/integrations/:provider/callback', async (req, res) => {
    const providerValue = requiredParam(req.params.provider, 'provider');
    if (!isUserIntegrationProvider(providerValue)) {
      res.redirect(
        callbackUrl(readIntegrationConfig(), 'google', 'error', 'Unknown integration provider'),
      );
      return;
    }
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const config = readIntegrationConfig();
    if (state === '' || code === '') {
      res.redirect(callbackUrl(config, providerValue, 'error', 'Authorization was cancelled'));
      return;
    }
    const stateRecord = await deps.prisma.integrationOAuthState.findUnique({
      where: { stateHash: hashOAuthState(state) },
    });
    if (
      stateRecord === null ||
      stateRecord.provider !== providerValue ||
      stateRecord.usedAt !== null ||
      stateRecord.expiresAt <= deps.now()
    ) {
      res.redirect(
        callbackUrl(config, providerValue, 'error', 'Authorization expired; start again'),
      );
      return;
    }
    await deps.prisma.integrationOAuthState.update({
      where: { id: stateRecord.id },
      data: { usedAt: deps.now() },
    });
    const providerConfig = oauthConfigFor(config, providerValue);
    if (providerConfig === null) {
      res.redirect(callbackUrl(config, providerValue, 'error', 'Provider is not configured'));
      return;
    }
    try {
      const tokens = await exchangeOAuthCode(providerValue, providerConfig, code);
      const existing = await deps.prisma.integrationConnection.findUnique({
        where: {
          accountId_provider: { accountId: stateRecord.accountId, provider: providerValue },
        },
      });
      await deps.prisma.integrationConnection.upsert({
        where: {
          accountId_provider: { accountId: stateRecord.accountId, provider: providerValue },
        },
        create: {
          accountId: stateRecord.accountId,
          provider: providerValue,
          accessTokenEncrypted: encryptIntegrationSecret(tokens.accessToken),
          ...(tokens.refreshToken === null
            ? {}
            : { refreshTokenEncrypted: encryptIntegrationSecret(tokens.refreshToken) }),
          tokenExpiresAt: tokens.expiresAt,
          scopesJson: JSON.stringify(tokens.scopes),
          metadataJson: JSON.stringify({}),
          lastCheckedAt: deps.now(),
          lastError: null,
        },
        update: {
          accessTokenEncrypted: encryptIntegrationSecret(tokens.accessToken),
          ...(tokens.refreshToken === null && existing?.refreshTokenEncrypted !== undefined
            ? { refreshTokenEncrypted: existing.refreshTokenEncrypted }
            : tokens.refreshToken === null
              ? {}
              : { refreshTokenEncrypted: encryptIntegrationSecret(tokens.refreshToken) }),
          tokenExpiresAt: tokens.expiresAt,
          scopesJson: JSON.stringify(tokens.scopes),
          status: 'connected',
          lastCheckedAt: deps.now(),
          lastError: null,
        },
      });
      res.redirect(callbackUrl(config, providerValue, 'connected'));
    } catch (error) {
      await deps.prisma.integrationConnection.updateMany({
        where: { accountId: stateRecord.accountId, provider: providerValue },
        data: {
          status: 'needs_reconnect',
          lastError: safeCallbackMessage(error),
          lastCheckedAt: deps.now(),
        },
      });
      res.redirect(callbackUrl(config, providerValue, 'error', safeCallbackMessage(error)));
    }
  });

  router.delete('/integrations/:provider', auth, async (req, res) => {
    const providerValue = requiredParam(req.params.provider, 'provider');
    if (!isUserIntegrationProvider(providerValue)) {
      throw validationError('unsupported integration provider');
    }
    await deps.prisma.integrationConnection.deleteMany({
      where: { accountId: accountIdFrom(res), provider: providerValue },
    });
    sendOk(res, null);
  });

  return router;
}
