// What the Performance row says, for every way an audit can end.
//
// The row is the whole of what a reader is told about this section on the report
// card and on the scan-progress window, so each ending has to produce a reason
// the reader's own language has a sentence for. `apps/web/src/module-status.ts`
// holds the other half of that contract: every token written here is listed
// there, and its test refuses a token that is not.
//
// No database and no provider: the row is built from an injected audit, which is
// exactly what the orchestrator hands it in production.

import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient, Scan } from '@prisma/client';

import {
  deviceResult,
  fakePerformanceAudit,
  fakePerformanceRunner,
} from '../test-utils/performance-fixtures.ts';
import type { PerformanceRunner } from '../integrations/performance/index.ts';
import type { ApiLogger } from '../http/logger.ts';
import type { WorkerDeps } from './deps.ts';
import {
  devicePreferenceFor,
  PERFORMANCE_MODULE,
  PERFORMANCE_STATUS_REASONS,
  runPerformanceModule,
} from './performance-module.ts';

type WrittenRow = Readonly<Record<string, unknown>>;

const SCAN = {
  id: 'scan-1',
  accountId: 'account-1',
  siteProfileId: 'profile-1',
  domain: 'https://example.com',
} as unknown as Scan;

const SILENT_LOGGER: ApiLogger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * A prisma stand-in that records the upserted row and reports no previous scan,
 * so the comparison is `null` and the reason under test is the only one.
 */
function recordingPrisma(): { readonly rows: WrittenRow[]; readonly prisma: PrismaClient } {
  const rows: WrittenRow[] = [];
  return {
    rows,
    prisma: {
      scanModule: {
        upsert: vi.fn(async (args: { create: WrittenRow }) => {
          rows.push(args.create);
          return args.create;
        }),
      },
      scan: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaClient,
  };
}

async function rowFrom(runner: PerformanceRunner | undefined): Promise<WrittenRow> {
  const { rows, prisma } = recordingPrisma();
  const deps: WorkerDeps = {
    prisma,
    logger: SILENT_LOGGER,
    createAiProvider: () => {
      throw new Error('the Performance module must not build an AI provider');
    },
    createPerformanceRunner: () => runner,
  };

  await runPerformanceModule(deps, {
    scan: SCAN,
    origin: 'https://example.com/',
    candidateUrls: ['https://example.com/'],
  });

  expect(rows).toHaveLength(1);
  const row = rows[0];
  expect(row?.module).toBe(PERFORMANCE_MODULE);
  return row ?? {};
}

describe('the Performance module row', () => {
  it('carries no reason when every run closed and the score is real', async () => {
    const row = await rowFrom(fakePerformanceRunner());

    expect(row.runtimeStatus).toBe('Completed');
    expect(row.statusReason).toBeNull();
    expect(row.score).toBe(79);
    expect(row.coverage).toBe(1);
  });

  // One failed sample out of the ones the audit asked for. The row is real, it
  // is just smaller than promised, and the reader is told which of the two.
  it('names incomplete measurement when a device produced nothing', async () => {
    const runner = fakePerformanceRunner({
      urls: [
        {
          url: 'https://example.com/',
          primary: true,
          devices: [
            deviceResult('mobile', { performanceScore: 71, lcpMs: 2_400 }),
            deviceResult('desktop', {}, { usableSamples: 0, failures: ['HTTP 429'] }),
          ],
        },
      ],
    });

    const row = await rowFrom(runner);

    expect(row.runtimeStatus).toBe('Partial');
    expect(row.statusReason).toBe(PERFORMANCE_STATUS_REASONS.partialCoverage);
    expect(row.coverage).toBe(0.5);
  });

  // Lighthouse can answer with metrics and no category score. The row completed;
  // the number did not, and a score-less section with no reason for it would
  // read as a bug in the report rather than a fact about the measurement.
  it('names a missing score when every run closed without one', async () => {
    const row = await rowFrom(fakePerformanceRunner({ score: null }));

    expect(row.runtimeStatus).toBe('Completed');
    expect(row.statusReason).toBe(PERFORMANCE_STATUS_REASONS.scoreUnavailable);
    expect(row.score).toBeNull();
  });

  it('names the provider when nothing at all could be measured', async () => {
    const runner = fakePerformanceRunner({
      urls: [
        {
          url: 'https://example.com/',
          primary: true,
          devices: [deviceResult('mobile', {}, { usableSamples: 0, failures: ['HTTP 500'] })],
        },
      ],
      score: null,
    });

    const row = await rowFrom(runner);

    expect(row.runtimeStatus).toBe('Unavailable');
    expect(row.statusReason).toBe(PERFORMANCE_STATUS_REASONS.providerUnavailable);
    expect(row.usableOutput).toBe(false);
  });

  it('names the deployment, not the provider, when no runner is configured', async () => {
    const row = await rowFrom(undefined);

    expect(row.runtimeStatus).toBe('Unavailable');
    expect(row.statusReason).toBe(PERFORMANCE_STATUS_REASONS.notConfigured);
  });

  // A provider that throws must not fail an otherwise valid website scan.
  it('records an outage instead of throwing', async () => {
    const row = await rowFrom(async () => {
      throw new Error('socket hang up');
    });

    expect(row.runtimeStatus).toBe('Unavailable');
    expect(row.statusReason).toBe(PERFORMANCE_STATUS_REASONS.providerUnavailable);
  });

  it('writes the flat snapshot beside the audit, so an old reader still renders', async () => {
    const row = await rowFrom(fakePerformanceRunner());
    const metadata: unknown = JSON.parse(String(row.metadataJson));
    const parsed = metadata as { readonly metrics?: unknown; readonly audit?: unknown };

    expect(parsed.metrics).toBeDefined();
    expect(parsed.audit).toBeDefined();
  });

  // The device order is the whole of the scope's influence on this section, and a
  // keyless deployment measures the first device and nothing else — so the
  // profile's own choice has to lead rather than the audit's default.
  it('leads with the device the scan asked for', () => {
    expect(devicePreferenceFor('mobile')).toEqual(['mobile', 'desktop']);
    expect(devicePreferenceFor('desktop')).toEqual(['desktop', 'mobile']);
    // The contract's own default, and what an older stored scope that states no
    // device is read as.
    expect(devicePreferenceFor(undefined)).toEqual(['desktop', 'mobile']);
  });

  it('hands the preference to the audit unchanged', async () => {
    const asked: (readonly string[] | undefined)[] = [];
    const { prisma } = recordingPrisma();
    await runPerformanceModule(
      {
        prisma,
        logger: SILENT_LOGGER,
        createAiProvider: () => {
          throw new Error('the Performance module must not build an AI provider');
        },
        createPerformanceRunner: () => async (request) => {
          asked.push(request.strategies);
          return fakePerformanceAudit({ origin: request.origin });
        },
      },
      {
        scan: SCAN,
        origin: 'https://example.com/',
        candidateUrls: ['https://example.com/'],
        strategies: devicePreferenceFor('mobile'),
      },
    );

    expect(asked).toEqual([['mobile', 'desktop']]);
  });

  it('measures a device with no usable samples as an unclosed check', async () => {
    const audit = fakePerformanceAudit({
      urls: [
        {
          url: 'https://example.com/',
          primary: true,
          devices: [
            deviceResult('mobile', { performanceScore: 60 }),
            deviceResult('desktop', {}, { usableSamples: 0, failures: ['timeout'] }),
          ],
        },
      ],
    });

    expect(audit.coverage).toMatchObject({ applicableChecks: 2, completedApplicableChecks: 1 });
  });
});
