// Liveness vs readiness (CR-04). Liveness answers "is the process up"; readiness
// answers "can it serve traffic", which for FluxRadar means the database is
// reachable. Readiness runs a bounded `SELECT 1` and fails closed with a safe
// 503 so the deploy gate never routes to a process that cannot reach PostgreSQL.
// Responses never expose connection detail.

import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';

export const READINESS_TIMEOUT_MS = 2_000;

export interface HealthRouterDeps {
  readonly prisma: PrismaClient;
  /** Test seam; production uses READINESS_TIMEOUT_MS. */
  readonly timeoutMs?: number;
}

/** Resolves true when `SELECT 1` returns before the timeout, false otherwise. */
export async function checkDatabaseReady(
  prisma: PrismaClient,
  timeoutMs: number = READINESS_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('readiness probe timed out')), timeoutMs);
    timer.unref?.();
  });
  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function healthRouter(deps: HealthRouterDeps): Router {
  const router = Router();

  // Liveness: the HTTP loop is running. Deliberately does not touch the database
  // so a transient DB outage does not trigger a container restart loop.
  router.get('/health', (_req, res) => {
    res.status(200).json({ ok: true, data: { service: 'api', status: 'ok' }, error: null });
  });

  // Readiness: safe to receive traffic. 503 when the database is unreachable.
  router.get('/health/ready', async (_req, res) => {
    const ready = await checkDatabaseReady(deps.prisma, deps.timeoutMs);
    if (ready) {
      res.status(200).json({ ok: true, data: { status: 'ready' }, error: null });
      return;
    }
    res.status(503).json({
      ok: false,
      data: { status: 'not-ready' },
      error: 'service is not ready',
    });
  });

  return router;
}
