import { Router, type Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import {
  BRANDING_WRITE_LIMIT,
  BRANDING_WRITE_IP_LIMIT,
  BRANDING_WRITE_WINDOW_MS,
  RequestRateLimiter,
  accountAndIpRules,
} from '../auth/rate-limit.ts';
import { ApiError } from '../http/errors.ts';
import { sendOk } from '../http/envelope.ts';
import { parseInput } from '../http/validate.ts';
import { silentLogger, type ApiLogger } from '../http/logger.ts';
import { brandingSchema } from './schema.ts';
import { sanitizeLogoPng } from './png.ts';
import { brandingView } from './load.ts';

type BrandingDeps = {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly requestRateLimiter?: RequestRateLimiter;
  readonly logger?: ApiLogger;
};

async function logoUpdate(
  logo: string | null | undefined,
  accountId: string,
  logger: ApiLogger,
): Promise<{
  logoPng?: Uint8Array<ArrayBuffer> | null;
  logoWidth?: number | null;
  logoHeight?: number | null;
}> {
  if (logo === undefined) return {};
  if (logo === null) return { logoPng: null, logoWidth: null, logoHeight: null };
  try {
    const result = await sanitizeLogoPng(Buffer.from(logo, 'base64'));
    return {
      logoPng: new Uint8Array(result.png),
      logoWidth: result.width,
      logoHeight: result.height,
    };
  } catch (error) {
    logger.warn('branding.logo.rejected', {
      accountId,
      event: 'branding.logo.rejected',
      name: error instanceof Error ? error.name : 'Unknown',
      code: error instanceof ApiError ? error.code : 'LOGO_UNREADABLE',
    });
    throw error;
  }
}

async function saveBrand(
  deps: BrandingDeps,
  accountId: string,
  body: unknown,
  logger: ApiLogger,
): Promise<object> {
  const { logo, ...input } = parseInput(brandingSchema, body);
  const logoData = await logoUpdate(logo, accountId, logger);
  try {
    const row = await deps.prisma.reportBranding.upsert({
      where: { accountId },
      create: { accountId, ...input, ...logoData },
      update: { ...input, ...logoData },
    });
    logger.info('branding.saved', { accountId, event: 'branding.saved' });
    return brandingView(row);
  } catch (error) {
    logger.error('branding save failed', {
      accountId,
      name: error instanceof Error ? error.name : 'Unknown',
      code: 'BRANDING_SAVE_FAILED',
    });
    throw new ApiError(500, 'BRANDING_SAVE_FAILED', 'branding could not be saved');
  }
}

export function brandingRouter(deps: BrandingDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);
  const limiter = deps.requestRateLimiter ?? new RequestRateLimiter();
  const logger = deps.logger ?? silentLogger;
  const limit = (req: Request, accountId: string): void =>
    limiter.assertAllowedAll(
      accountAndIpRules('branding-write', accountId, req.ip ?? 'unknown', {
        account: BRANDING_WRITE_LIMIT,
        ip: BRANDING_WRITE_IP_LIMIT,
        windowMs: BRANDING_WRITE_WINDOW_MS,
      }),
    );
  router.get('/account/branding', auth, async (_req, res) => {
    const row = await deps.prisma.reportBranding.findUnique({
      where: { accountId: accountIdFrom(res) },
    });
    sendOk(res, row === null ? null : brandingView(row));
  });
  router.put('/account/branding', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    limit(req, accountId);
    sendOk(res, await saveBrand(deps, accountId, req.body, logger));
  });
  router.delete('/account/branding', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    limit(req, accountId);
    await deps.prisma.reportBranding.deleteMany({ where: { accountId } });
    logger.info('branding.deleted', { accountId, event: 'branding.deleted' });
    sendOk(res, null);
  });
  return router;
}
