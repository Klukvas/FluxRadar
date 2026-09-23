// Точка записи результата ОДНОГО модуля: строка ScanModule и её findings
// сохраняются вместе, как только модуль закончил работу.
//
// Раньше строки модулей писались по ходу прогона, а весь снимок issues — одной
// вставкой в конце. Отмена между этими двумя моментами давала отчёт, в котором
// секция Completed со score 84.50 не имеет ни одной находки: доказательства
// своей же оценки она теряла, потому что их вставка ещё не произошла. При этом
// findings завершённого модуля полны по построению — неполон был только снимок
// незавершённых модулей.
//
// Поэтому запись атомарна и идемпотентна по модулю: транзакция переписывает
// строку модуля и ровно его issues. Повторная попытка (module retry, resume
// после отмены, platform retry) даёт тот же результат без дублей, а будущая
// persisted pause сможет останавливаться на границе модуля, не придумывая новых
// правил записи.
//
// Перезапись не стирает решения владельца по этому же скану: статусы
// Acknowledged/Ignored/False Positive читаются перед транзакцией и переносятся
// на новые строки того же fingerprint (issueStatusesForModule).

import { severityRank, siteReachStatusReason } from '@fluxradar/contracts';
import type { CrawlSummary } from '@fluxradar/contracts';
import type { Prisma, PrismaClient, Scan } from '@prisma/client';

/** Works both on the root client and inside a `$transaction` callback. */
type DbClient = PrismaClient | Prisma.TransactionClient;

import { issueStatusesForModule } from './issue-sync.ts';
import type { IssueRowData } from './module-result.ts';
import type { ModuleRowData } from './module-row.ts';
import {
  coverageProofDelete,
  coverageProofWrite,
  writesCoverageProof,
  type ModuleCoverage,
} from './run-coverage.ts';

export interface ModuleResultToPersist {
  readonly module: string;
  readonly row: ModuleRowData;
  /** Findings этого модуля; пустой список — валидный результат «ничего не найдено». */
  readonly issueRows: readonly IssueRowData[];
  /**
   * Доказательство повторной проверки этого модуля (§14, run-coverage.ts).
   * Не задано — модуль правил не содержит (GEO, Performance).
   */
  readonly coverage?: ModuleCoverage;
}

/**
 * Строка модуля сама по себе — без findings и без доказательства покрытия.
 *
 * Это переходы состояния (`Pending`, `Running`) и промежуточный прогресс: у них
 * ещё нет результата, который надо было бы записать атомарно с ними. Работает и
 * внутри транзакции, поэтому прогресс обхода пишется вместе со своими счётчиками.
 */
export async function setModule(
  db: DbClient,
  scanId: string,
  module: string,
  data: ModuleRowData,
): Promise<void> {
  await db.scanModule.upsert({
    where: { scanId_module: { scanId, module } },
    create: { scanId, module, runtimeStatus: data.runtimeStatus, ...withoutStatus(data) },
    update: { runtimeStatus: data.runtimeStatus, ...withoutStatus(data) },
  });
}

function withoutStatus(data: ModuleRowData): Omit<ModuleRowData, 'runtimeStatus'> {
  const { runtimeStatus, ...rest } = data;
  void runtimeStatus;
  return rest;
}

/**
 * Every module of the attempt reports the same thing: there was no site to read.
 *
 * `Unavailable` rather than `Not applicable` is the honest status — the checks
 * are applicable to this site, they simply had nothing to run on — and §15
 * requires `applicable > 0, completed = 0` for it, which is what the single
 * "could the site be read" check stands for. No score, because scoring a site
 * we never saw is the whole failure being fixed here.
 */
export async function markEveryModuleUnreadable(
  prisma: PrismaClient,
  scanId: string,
  modules: readonly string[],
  summary: CrawlSummary,
): Promise<void> {
  const statusReason = siteReachStatusReason(summary) ?? 'SiteUnreachable';
  for (const module of modules) {
    await setModule(prisma, scanId, module, {
      runtimeStatus: 'Unavailable',
      statusReason,
      coverage: 0,
      score: null,
      applicableChecks: 1,
      completedApplicableChecks: 0,
      usableOutput: false,
      metadataJson: JSON.stringify({ crawl: summary }),
    });
  }
}

export async function persistModuleResult(
  prisma: PrismaClient,
  scan: Scan,
  result: ModuleResultToPersist,
): Promise<void> {
  // Начальные статусы (Reopened / перенос пользовательских, §14/D-110) читаются
  // до транзакции: это запросы к другим сканам и к прежним строкам этого же
  // модуля, и держать их внутри незачем.
  const statuses = await issueStatusesForModule(
    prisma,
    scan,
    result.module,
    result.issueRows.map((row) => row.fingerprint),
  );
  await prisma.$transaction([
    prisma.scanModule.upsert({
      where: { scanId_module: { scanId: scan.id, module: result.module } },
      create: { scanId: scan.id, module: result.module, ...result.row },
      update: result.row,
    }),
    prisma.issue.deleteMany({ where: { scanId: scan.id, module: result.module } }),
    prisma.issue.createMany({
      data: result.issueRows.map((row): Prisma.IssueCreateManyInput => ({
        ...row,
        severityRank: severityRank(row.severity),
        status: statuses.get(row.fingerprint) ?? 'New',
      })),
    }),
    // Доказательство повторной проверки едет здесь же: findings без него
    // означали бы «нашли, но доказать повтор не сможем», а доказательство без
    // findings — наоборот. Переигранный модуль перезаписывает и его.
    ...coverageWrites(prisma, scan, result),
  ]);
}

/**
 * Запись (или снятие) доказательства покрытия модуля в той же транзакции.
 *
 * Free и Basic доказательства не пишут: закрывать находки вправе только
 * Complete, и сравнивается он только с предыдущим Complete (§515,
 * writesCoverageProof). Удаление нужно ровно на границе: модуль, переигранный
 * после того, как план перестал требовать доказательство, не должен оставить
 * чужую запись о прошлом прогоне.
 */
function coverageWrites(
  prisma: PrismaClient,
  scan: Scan,
  result: ModuleResultToPersist,
): readonly Prisma.PrismaPromise<unknown>[] {
  if (result.coverage === undefined) {
    return [];
  }
  return writesCoverageProof(scan.plan)
    ? [coverageProofWrite(prisma, scan.id, result.module, result.coverage)]
    : [coverageProofDelete(prisma, scan.id, result.module)];
}
