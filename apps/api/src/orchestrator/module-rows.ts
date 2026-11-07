// The module rows an attempt starts from (run-attempt.ts): what it clears, what
// it resets to Pending, and — for a Free scan — the GEO preview guard, which has
// to be read before the clear removes its proof (D-236).

import type { PrismaClient } from '@prisma/client';

import { freePreviewAlreadyRequested } from './free-geo.ts';
import type { GeoScope } from './module-plan.ts';
import { setModule, type DbClient } from './module-persistence.ts';

const GEO_MODULE = 'AI SEO / GEO';

/**
 * The sticky proof that a Free scan's preview already reached the AI step.
 *
 * Status-independent on purpose: a row is cleared and reset to Pending at the
 * start of every attempt, so a Running status alone does not survive two failed
 * attempts in a row. Any GEO row carrying this marker blocks the preview for
 * the rest of the scan (free-geo.ts `geoStageReached`).
 */
export const FREE_PREVIEW_REQUESTED_METADATA: Readonly<Record<string, Record<string, unknown>>> = {
  [GEO_MODULE]: { freePreview: true, previewRequested: true },
};

export interface PrepareModuleRowsOptions {
  readonly retryModule?: string;
  /** Null replaces the whole snapshot; otherwise only these modules are cleared. */
  readonly modules: readonly string[] | null;
  /** Reset to Pending after the clear. */
  readonly modulesToRun: readonly string[];
  readonly geoScope: GeoScope;
}

/**
 * Reads the Free preview guard, THEN clears the previous rows, then resets the
 * modules this attempt runs to Pending. When the guard is true the GEO row is
 * written back with the sticky marker, so the next attempt still sees it.
 */
export async function prepareModuleRows(
  prisma: PrismaClient,
  scanId: string,
  options: PrepareModuleRowsOptions,
): Promise<{ readonly freePreviewRequestedBefore: boolean }> {
  const freePreviewRequestedBefore =
    options.geoScope === 'free-preview' &&
    (await freePreviewAlreadyRequested(prisma, scanId, options.retryModule));
  const reset = async (db: DbClient): Promise<void> => {
    await clearPreviousModuleRows(db, scanId, {
      ...(options.retryModule !== undefined ? { retryModule: options.retryModule } : {}),
      modules: options.modules,
    });
    for (const module of options.modulesToRun) {
      const marker = freePreviewRequestedBefore
        ? FREE_PREVIEW_REQUESTED_METADATA[module]
        : undefined;
      await setModule(db, scanId, module, {
        runtimeStatus: 'Pending',
        ...(marker !== undefined ? { metadataJson: JSON.stringify(marker) } : {}),
      });
    }
  };
  // On Free the clear and the marker write are one transaction: a process that
  // died between them would delete the Running row and its ledger without
  // writing the marker back, and the next attempt would ask again. The paid
  // path keeps HEAD's separate writes, unchanged.
  if (options.geoScope === 'free-preview') {
    await prisma.$transaction(reset);
  } else {
    await reset(prisma);
  }
  return { freePreviewRequestedBefore };
}

/**
 * Clears what this attempt is about to rewrite, and nothing else.
 *
 * `modules === null` means the whole snapshot is being replaced — a first run,
 * a module-less retry, or an attempt without a control. Otherwise only the
 * stages this attempt will actually run are cleared, so a module that already
 * settled keeps its row, its findings and its provider records.
 */
export async function clearPreviousModuleRows(
  prisma: DbClient,
  scanId: string,
  options: { readonly retryModule?: string; readonly modules: readonly string[] | null },
): Promise<void> {
  const { retryModule, modules } = options;
  if (retryModule !== undefined) {
    await prisma.issue.deleteMany({ where: { scanId, module: retryModule } });
    if (retryModule === 'AI SEO / GEO' || retryModule === 'UX/Conversion') {
      await prisma.aiResponseRecord.deleteMany({ where: { scanId, module: retryModule } });
    }
    await prisma.scanModule.deleteMany({ where: { scanId, module: retryModule } });
    return;
  }
  if (modules === null) {
    await prisma.issue.deleteMany({ where: { scanId } });
    await prisma.aiResponseRecord.deleteMany({ where: { scanId } });
    await prisma.scanModule.deleteMany({ where: { scanId } });
    return;
  }
  await prisma.issue.deleteMany({ where: { scanId, module: { in: [...modules] } } });
  await prisma.aiResponseRecord.deleteMany({ where: { scanId, module: { in: [...modules] } } });
  await prisma.scanModule.deleteMany({ where: { scanId, module: { in: [...modules] } } });
}
