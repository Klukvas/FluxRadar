// Writes the Analytics module row from live Google data.
//
// This runs AFTER resolveScanOutcome, in the same phase the module previously
// occupied as a fixed stub. That ordering is deliberate: Analytics is a
// side-score module (§15) and must never turn a Completed public-site scan into
// a Partial one because Google was unreachable or was never connected.

import { TARIFFS, type Plan } from '@fluxradar/contracts';

import { analyticsModuleRow } from '../integrations/google/module-row.ts';
import { connectionStateSnapshot } from '../integrations/google/snapshot.ts';
import type { GoogleDataSnapshot } from '../integrations/google/types.ts';
import { detailFor } from '../integrations/google/errors.ts';
import type { WorkerDeps } from './deps.ts';

const ANALYTICS_MODULE = 'Analytics';

function planIncludesAnalytics(plan: string): boolean {
  const tariff = TARIFFS[plan as Plan] as (typeof TARIFFS)[Plan] | undefined;
  return tariff?.modules.includes(ANALYTICS_MODULE) ?? false;
}

export async function persistAnalyticsModule(deps: WorkerDeps, scanId: string): Promise<void> {
  const now = deps.now ?? ((): Date => new Date());
  const scan = await deps.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
  if (!planIncludesAnalytics(scan.plan)) {
    return;
  }
  const runner = deps.createGoogleDataRunner?.();
  let snapshot: GoogleDataSnapshot;
  if (runner === undefined) {
    snapshot = connectionStateSnapshot('not_connected', detailFor('not_connected'), now());
  } else {
    try {
      snapshot = await runner(scan.accountId, scan.siteProfileId);
    } catch (error) {
      // The runner already degrades internally; this is the last guard so a
      // terminal scan is never lost to an unexpected Google client failure.
      deps.logger.warn('google data collection failed', {
        scanId,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      snapshot = connectionStateSnapshot('request_failed', detailFor('request_failed'), now());
    }
  }
  const row = analyticsModuleRow(snapshot);
  await deps.prisma.scanModule.upsert({
    where: { scanId_module: { scanId, module: ANALYTICS_MODULE } },
    create: { scanId, module: ANALYTICS_MODULE, ...row },
    update: row,
  });
}
