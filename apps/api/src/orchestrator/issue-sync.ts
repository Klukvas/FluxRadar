// Resolved/Reopened по fingerprint между сканами ОДНОГО плана внутри профиля
// (§14, D-110). Начальный статус нового issue наследует последнюю известную
// судьбу того же fingerprint в успешных сканах того же плана: Resolved →
// Reopened, пользовательские Acknowledged/Ignored/False Positive переносятся
// (решение принято о том же evidence), остальное → New. После успешного скана
// issues предыдущего скана того же плана помечаются Resolved — но только те,
// повторную проверку которых прогон действительно доказал
// (resolution-policy.ts).
//
// Сравнение ограничено одним планом, потому что планы читают разные наборы
// модулей: Website Audit не запускает SEO и GEO вовсе, поэтому отсутствие
// SEO-находки в нём — не исправление, а другой набор проверок. Сравнение
// Complete → Website Audit пометило бы каждую SEO/GEO-находку как Resolved.

import type { PrismaClient, Scan } from '@prisma/client';
import type { IssueStatus } from '@fluxradar/contracts';
import { planSupports } from '@fluxradar/contracts';

import { previousRunCoverage, resolvableIssues } from './resolution-policy.ts';
import type { RunCoverage } from './resolution-policy.ts';
import { loadScanCoverage, type UnreadableCoverage } from './run-coverage.ts';

const CARRIED_USER_STATUSES: readonly IssueStatus[] = ['Acknowledged', 'Ignored', 'False Positive'];

function inheritedStatus(previous: string): IssueStatus {
  if (previous === 'Resolved') {
    return 'Reopened';
  }
  if ((CARRIED_USER_STATUSES as readonly string[]).includes(previous)) {
    return previous as IssueStatus;
  }
  return 'New';
}

/**
 * Начальные статусы новых issues скана. Ищется последнее вхождение каждого
 * fingerprint среди более ранних успешных сканов ТОГО ЖЕ плана в профиле.
 */
export async function initialIssueStatuses(
  prisma: PrismaClient,
  scan: Scan,
  fingerprints: readonly string[],
): Promise<ReadonlyMap<string, IssueStatus>> {
  if (!planSupports(scan.plan, 'issueHistory') || fingerprints.length === 0) {
    return new Map();
  }
  const previous = await prisma.issue.findMany({
    where: {
      fingerprint: { in: [...fingerprints] },
      scan: {
        siteProfileId: scan.siteProfileId,
        plan: scan.plan,
        status: 'Completed',
        id: { not: scan.id },
      },
    },
    orderBy: { observedAt: 'desc' },
    select: { fingerprint: true, status: true },
  });
  const statuses = new Map<string, IssueStatus>();
  for (const issue of previous) {
    // Сортировка desc: первое вхождение fingerprint — самое свежее.
    if (!statuses.has(issue.fingerprint)) {
      statuses.set(issue.fingerprint, inheritedStatus(issue.status));
    }
  }
  return statuses;
}

/**
 * Статусы для issues, которые модуль записывает прямо сейчас.
 *
 * Запись модуля идемпотентна: она удаляет свои прежние строки и создаёт их
 * заново (module-persistence.ts). Само по себе это правильно — дублей не
 * остаётся, — но перезапуск модуля (ExternalRetryGranted, повтор секции) стирал
 * бы и решение владельца по ЭТОМУ скану: Acknowledged/Ignored/False Positive,
 * поставленные до перезапуска. Поэтому статус того же fingerprint в текущем
 * скане читается перед записью и побеждает унаследованный: решение принято о том
 * же evidence, и новый прогон его не отменяет.
 *
 * Вне окна: статус, поставленный ПОКА идёт перезапись (скан не терминален, UI
 * его не показывает как готовый), может потеряться — чтения и записи разделены
 * транзакцией модуля, а не блокировкой строки.
 */
export async function issueStatusesForModule(
  prisma: PrismaClient,
  scan: Scan,
  module: string,
  fingerprints: readonly string[],
): Promise<ReadonlyMap<string, IssueStatus>> {
  if (fingerprints.length === 0) {
    return new Map();
  }
  const inherited = await initialIssueStatuses(prisma, scan, fingerprints);
  const current = await prisma.issue.findMany({
    where: { scanId: scan.id, module, fingerprint: { in: [...fingerprints] } },
    select: { fingerprint: true, status: true },
  });
  const statuses = new Map(inherited);
  for (const issue of current) {
    if ((CARRIED_USER_STATUSES as readonly string[]).includes(issue.status)) {
      statuses.set(issue.fingerprint, issue.status as IssueStatus);
    }
  }
  return statuses;
}

export interface ResolveOptions {
  /** Нечитаемое доказательство покрытия прошлого скана — логируется вызывающим. */
  readonly onUnreadableCoverage?: UnreadableCoverage;
}

/**
 * После успешного скана: issues предыдущего скана ТОГО ЖЕ плана, которых
 * в новом нет И повторную проверку которых этот прогон действительно доказал,
 * получают Resolved (§14 + политика resolution-policy.ts).
 *
 * Отсутствия fingerprint-а мало: суженный scope, недоступный модуль, лимит URL
 * и смена ruleset дают ровно то же отсутствие, не починив ничего. Поэтому сюда
 * передаётся покрытие самого прогона, а покрытие прошлого скана читается из его
 * же строк модулей: site-level находку можно закрыть только прогоном, который
 * прочитал как минимум те же входы.
 */
export async function markResolvedAgainstPrevious(
  prisma: PrismaClient,
  scan: Scan,
  run: RunCoverage,
  options: ResolveOptions = {},
): Promise<number> {
  if (!planSupports(scan.plan, 'issueHistory')) {
    return 0;
  }
  const previousScan = await prisma.scan.findFirst({
    where: {
      siteProfileId: scan.siteProfileId,
      plan: scan.plan,
      status: 'Completed',
      id: { not: scan.id },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (previousScan === null) {
    return 0;
  }
  const currentFingerprints = new Set(
    (
      await prisma.issue.findMany({ where: { scanId: scan.id }, select: { fingerprint: true } })
    ).map((issue) => issue.fingerprint),
  );
  const previousIssues = await prisma.issue.findMany({
    where: { scanId: previousScan.id, status: { not: 'Resolved' } },
    select: {
      id: true,
      fingerprint: true,
      ruleId: true,
      module: true,
      targetKind: true,
      normalizedUrl: true,
    },
  });
  const resolvable = resolvableIssues(
    previousIssues,
    currentFingerprints,
    run,
    previousRunCoverage(
      await loadScanCoverage(prisma, previousScan.id, options.onUnreadableCoverage),
      previousScan.rulesetVersion,
    ),
  );
  let resolved = 0;
  // Чанками: список id прошлого скана может быть в тысячах строк, а параметры
  // одного оператора IN в PostgreSQL не бесконечны.
  for (const chunk of chunked(
    resolvable.map((issue) => issue.id),
    RESOLVE_CHUNK_SIZE,
  )) {
    const { count } = await prisma.issue.updateMany({
      where: { id: { in: [...chunk] }, status: { not: 'Resolved' } },
      data: { status: 'Resolved' },
    });
    resolved += count;
  }
  return resolved;
}

const RESOLVE_CHUNK_SIZE = 500;

function chunked<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_unused, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}
