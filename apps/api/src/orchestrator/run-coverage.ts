// Доказательство повторной проверки: что каждое правило модуля реально
// прочитало в этом прогоне, о чём оно спрашивало обход и на каком материале
// держится каждая его находка (§14; политика — resolution-policy.ts).
//
// Зачем это хранится. «Находки больше нет» доказывает исправление только там,
// где ту же цель тем же правилом действительно смотрели снова. Внутри прогона
// это знает движок правил (RuleEvaluation), но решение о статусе прошлых issues
// принимается ПОСЛЕ прогона и должно сравнивать два скана, из которых один
// давно закончился. Поэтому покрытие переживает прогон.
//
// Где лежит. В собственной таблице RuleCoverageProof, а не в
// ScanModule.metadataJson. Метадата модуля грузится на каждом обращении к скану
// (/scans, /scans/active, дашборд, поллинг статуса) — и ради этого прошлая
// версия держала доказательство в потолке 2 000 целей, из-за чего обход крупнее
// не получал доказательства вовсе и НИ ОДНА находка такого сайта не могла стать
// Resolved: ровно на тарифах, которые продают 5 000 и 50 000 URL. Теперь
// доказательство читает единственный потребитель — политика Resolved
// следующего Complete-скана, — и платит за чтение только он.
//
// Что именно хранится на каждое правило:
//   • checkedTargets — цели, о которых правило вынесло вердикт;
//   • inputTargets — материал обхода, на который правило посмотрело помимо
//     самой цели и получило ответ (снимки целей ссылок, media, граф ссылок);
//   • requestedInputs — всё, о чём правило спрашивало, отвеченное и нет. Вход,
//     о котором сайт больше не спрашивает (удалённая ссылка, снятая картинка),
//     — это починка; вход, о котором спрашивают, но ответа нет, —
//     неизвестность. Без этой пары одна необойдённая страница замораживала все
//     находки правила по всему сайту;
//   • dependencyTargets каждой находки (по fingerprint) — материал, на котором
//     держится именно она. Это и есть per-issue доказательство: починенная
//     ссылка закрывается, даже если в другом углу сайта что-то не обошли.
// И один раз на модуль — context (run-context.ts): тот же URL под другим
// User-Agent или другое GA4-property это другие данные.
//
// Формат: URL-таблица + дедуплицированные наборы индексов, JSON, gzip. Почти
// все page-правила модуля смотрят на один и тот же набор страниц, поэтому
// наборов обычно 1–5 на модуль, а не по одному на каждое правило. Измерено на
// SEO-модуле (12 page-правил + три правила со входами и спросом):
// 1 000 страниц — 102 КБ JSON → 12 КБ в базе; 5 000 (лимит Basic) — 517 КБ →
// 52 КБ; 50 000 (лимит Complete) — 5,4 МБ → 787 КБ, кодирование 213 мс.
// Распаковать строку вручную: `gunzip -c` над выгруженным bytea.
//
// Пишется только для Complete-сканов: закрывать находки вправе только Complete
// (§515), и сравнивается он тоже только с предыдущим Complete — доказательство
// Free/Basic не прочитает никто и никогда (writesCoverageProof).

import { gunzipSync, gzipSync } from 'node:zlib';

import type { Plan } from '@fluxradar/contracts';
import type { Prisma, PrismaClient, Scan } from '@prisma/client';
import { z } from 'zod';

import { UNKNOWN_RUN_CONTEXT, type RunRequestContext } from './run-context.ts';

/** Что прочитало одно правило: цели в той же нормализации, что normalizedUrl его findings. */
export interface RuleCoverage {
  readonly ruleId: string;
  readonly checkedTargets: readonly string[];
  /** Входы за пределами целей; пусто — вердикт зависит только от самой цели. */
  readonly inputTargets?: readonly string[];
  /** Спрос правила; undefined — правило о нём не отчиталось (см. шапку). */
  readonly requestedInputs?: readonly string[];
}

/** Доказательство одного модуля целиком. */
export interface ModuleCoverage {
  readonly rules: readonly RuleCoverage[];
  /** fingerprint находки → материал, на котором она держится. */
  readonly issueDependencies?: ReadonlyMap<string, readonly string[]>;
  readonly context: RunRequestContext;
}

/** Прочитанное покрытие одного правила. */
export interface RuleCoverageEntry {
  readonly checkedTargets: ReadonlySet<string>;
  readonly inputTargets: ReadonlySet<string>;
  /** null — правило спрос не объявляло: «больше не спрашивают» доказать нечем. */
  readonly requestedInputs: ReadonlySet<string> | null;
  readonly context: RunRequestContext;
}

/** ruleId → что оно прочитало. Правила без записи не проверили ничего. */
export type RuleCoverageIndex = ReadonlyMap<string, RuleCoverageEntry>;

/** Покрытие скана: правила всех его модулей и зависимости их находок. */
export interface ScanCoverage {
  readonly byRule: RuleCoverageIndex;
  /** fingerprint → материал этой находки; пусто — правило его не называло. */
  readonly issueDependencies: ReadonlyMap<string, readonly string[]>;
}

export const EMPTY_SCAN_COVERAGE: ScanCoverage = {
  byRule: new Map(),
  issueDependencies: new Map(),
};

/**
 * Потолок URL-таблицы одного модуля.
 *
 * Обход Complete — 50 000 URL (TARIFFS.urlLimit), и доказательство модуля
 * ссылается на него плюс на цели ссылок и media этих страниц, поэтому потолок —
 * пятикратный лимит тарифа, а не число «на глаз». Он существует не ради размера
 * строки (она сжата и читается одним запросом раз в скан), а как предохранитель
 * от патологии: правило, объявившее входами миллионы URL, иначе писало бы
 * мегабайты молча.
 *
 * Превышение не обрезает доказательство до «частичного»: обрезанный список
 * прошлого прогона выглядел бы как меньшие требования и УПРОЩАЛ бы закрытие
 * находки. Блок помечается truncated и читается как «доказательства нет».
 */
export const MAX_COVERAGE_PROOF_TARGETS = 250_000;

/**
 * Отдельный потолок для спроса (requestedInputs).
 *
 * Спрос нужен ровно для одного вывода — «этого входа сайт больше не
 * запрашивает», — и его потеря делает политику строже, а не мягче. Поэтому
 * слишком большой спрос выбрасывается отдельно: модуль сохраняет доказательство
 * проверки и теряет только возможность признать вход снятым.
 */
export const MAX_REQUESTED_INPUT_TARGETS = 150_000;

const runContextSchema = z.object({
  userAgent: z.string().nullable().default(null),
  ga4PropertyId: z.string().nullable().default(null),
  searchConsoleSiteUrl: z.string().nullable().default(null),
  // Записи, сделанные до того, как scope обхода вошёл в контекст, поля не
  // содержат: null не совпадёт ни с чем, и их находки остаются открытыми.
  crawlScope: z.string().nullable().default(null),
  bingSiteUrl: z.string().nullable().default(null),
});

const ruleEntrySchema = z.object({
  /** Индекс набора проверенных целей. */
  checked: z.number().int().nonnegative(),
  /** Индекс набора отвеченных входов; отсутствует — входов нет. */
  inputs: z.number().int().nonnegative().optional(),
  /** Индекс набора спроса; отсутствует — правило спрос не объявляло. */
  requested: z.number().int().nonnegative().optional(),
});

const encodedCoverageSchema = z.object({
  urls: z.array(z.string()),
  targetSets: z.array(z.array(z.number().int().nonnegative())),
  rules: z.record(z.string(), ruleEntrySchema),
  /** fingerprint → индекс набора зависимостей этой находки. */
  issues: z.record(z.string(), z.number().int().nonnegative()).optional(),
  context: runContextSchema.optional(),
  /** Обход не поместился в лимит: доказательства нет (fail closed). */
  truncated: z.literal(true).optional(),
});

export type EncodedRuleCoverage = z.infer<typeof encodedCoverageSchema>;

/**
 * Ключ, под которым доказательство лежало в ScanModule.metadataJson.
 *
 * Новые сканы его не пишут. Строки, записанные до переезда (dev-база этой
 * ветки), всё ещё могут его содержать, и отчёт обязан его вырезать: это
 * внутренний артефакт политики, а не текст для читателя (scans/routes.ts).
 */
export const LEGACY_COVERAGE_PROOF_KEY = 'coverageProof';

/** Плану, который не умеет закрывать находки, доказательство не нужно (§515). */
export function writesCoverageProof(plan: string): boolean {
  return (plan as Plan) === 'Complete';
}

export function encodeRuleCoverage(coverage: ModuleCoverage): EncodedRuleCoverage {
  const urlIds = new Map<string, number>();
  const setIds = new Map<string, number>();
  const targetSets: number[][] = [];
  const rules: Record<string, z.infer<typeof ruleEntrySchema>> = {};
  const issues: Record<string, number> = {};

  const setId = (targets: readonly string[]): number => {
    const indices = [...new Set(targets.map((target) => urlId(urlIds, target)))].sort(
      (left, right) => left - right,
    );
    const key = indices.join(',');
    const existing = setIds.get(key);
    if (existing !== undefined) {
      return existing;
    }
    setIds.set(key, targetSets.length);
    targetSets.push(indices);
    return targetSets.length - 1;
  };

  for (const rule of coverage.rules) {
    const inputs = rule.inputTargets ?? [];
    // Спрос сверх потолка отбрасывается отдельно и молча делает правило строже:
    // без него ни один вход не может быть признан снятым.
    const requested =
      rule.requestedInputs !== undefined &&
      rule.requestedInputs.length <= MAX_REQUESTED_INPUT_TARGETS
        ? rule.requestedInputs
        : undefined;
    rules[rule.ruleId] = {
      checked: setId(rule.checkedTargets),
      ...(inputs.length > 0 ? { inputs: setId(inputs) } : {}),
      ...(requested !== undefined ? { requested: setId(requested) } : {}),
    };
  }
  for (const [fingerprint, targets] of coverage.issueDependencies ?? []) {
    if (targets.length > 0) {
      issues[fingerprint] = setId(targets);
    }
  }
  if (urlIds.size > MAX_COVERAGE_PROOF_TARGETS) {
    return { urls: [], targetSets: [], rules: {}, context: coverage.context, truncated: true };
  }
  return {
    urls: [...urlIds.keys()],
    targetSets,
    rules,
    ...(Object.keys(issues).length > 0 ? { issues } : {}),
    context: coverage.context,
  };
}

function urlId(urlIds: Map<string, number>, url: string): number {
  const existing = urlIds.get(url);
  if (existing !== undefined) {
    return existing;
  }
  urlIds.set(url, urlIds.size);
  return urlIds.size - 1;
}

/**
 * Байты строки RuleCoverageProof: gzip(JSON) — см. шапку файла.
 *
 * Копия в собственный ArrayBuffer, а не сам Buffer: Prisma ждёт байты, не
 * разделяющие память с пулом Node, — иначе в колонку может уехать чужой хвост.
 */
export function serializeCoverageProof(coverage: ModuleCoverage): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    gzipSync(Buffer.from(JSON.stringify(encodeRuleCoverage(coverage)), 'utf8')),
  );
}

/**
 * Прочитанное доказательство и, отдельно, причина его непригодности.
 *
 * Непригодное доказательство равносильно отсутствию доказательства — находка
 * останется открытой, и это безопасная сторона ошибки. Но молча это не
 * происходит: причина возвращается наверх, где её логирует worker.
 */
export interface CoverageRead {
  readonly coverage: RuleCoverageIndex;
  readonly issueDependencies: ReadonlyMap<string, readonly string[]>;
  readonly problem: string | null;
}

function unusable(problem: string): CoverageRead {
  return { coverage: new Map(), issueDependencies: new Map(), problem };
}

export function decodeCoverageProof(stored: Uint8Array): CoverageRead {
  let json: string;
  try {
    json = gunzipSync(stored).toString('utf8');
  } catch (error) {
    return unusable(
      `coverage proof could not be decompressed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return unusable('coverage proof is not valid JSON');
  }
  const validated = encodedCoverageSchema.safeParse(parsed);
  if (!validated.success) {
    return unusable(`coverage proof is malformed: ${validated.error.message}`);
  }
  if (validated.data.truncated === true) {
    return unusable(
      `run exceeded the ${MAX_COVERAGE_PROOF_TARGETS}-target coverage proof limit; ` +
        'findings of this module stay open',
    );
  }
  return indexOf(validated.data);
}

function indexOf(encoded: EncodedRuleCoverage): CoverageRead {
  const coverage = new Map<string, RuleCoverageEntry>();
  const context = encoded.context ?? UNKNOWN_RUN_CONTEXT;
  for (const [ruleId, entry] of Object.entries(encoded.rules)) {
    const checked = targetsOf(encoded, entry.checked);
    const inputs = entry.inputs === undefined ? [] : targetsOf(encoded, entry.inputs);
    // undefined — правило спрос не объявляло; null — объявило, но набор битый.
    const requested =
      entry.requested === undefined ? undefined : targetsOf(encoded, entry.requested);
    if (checked === null || inputs === null || requested === null) {
      return unusable(`coverage proof of ${ruleId} references an unknown target set or URL`);
    }
    coverage.set(ruleId, {
      checkedTargets: new Set(checked),
      inputTargets: new Set(inputs),
      requestedInputs: requested === undefined ? null : new Set(requested),
      context,
    });
  }
  const issueDependencies = new Map<string, readonly string[]>();
  for (const [fingerprint, setId] of Object.entries(encoded.issues ?? {})) {
    const targets = targetsOf(encoded, setId);
    if (targets === null) {
      return unusable(`coverage proof of finding ${fingerprint} references an unknown target set`);
    }
    issueDependencies.set(fingerprint, targets);
  }
  return { coverage, issueDependencies, problem: null };
}

/** null — набор или один из его URL-ов отсутствует в таблице (битый блок). */
function targetsOf(encoded: EncodedRuleCoverage, setId: number): readonly string[] | null {
  const indices = encoded.targetSets[setId];
  if (indices === undefined) {
    return null;
  }
  const targets = indices.map((index) => encoded.urls[index]);
  return targets.some((target) => target === undefined) ? null : (targets as string[]);
}

/** Сообщение о непригодном доказательстве одного модуля. */
export type UnreadableCoverage = (detail: { module: string; problem: string }) => void;

/**
 * Запись доказательства модуля — операция для транзакции его результата.
 *
 * Возвращается, а не выполняется: строка модуля, его findings и это
 * доказательство обязаны появиться вместе, иначе сканы расходятся с тем, что
 * про них потом утверждает политика (module-persistence.ts, analytics-module.ts).
 */
export function coverageProofWrite(
  prisma: Pick<PrismaClient, 'ruleCoverageProof'>,
  scanId: string,
  module: string,
  coverage: ModuleCoverage,
): Prisma.PrismaPromise<unknown> {
  const proof = serializeCoverageProof(coverage);
  return prisma.ruleCoverageProof.upsert({
    where: { scanId_module: { scanId, module } },
    create: { scanId, module, proof },
    update: { proof },
  });
}

/** Модуль, переигранный без доказательства (Free/Basic), не должен оставить старое. */
export function coverageProofDelete(
  prisma: Pick<PrismaClient, 'ruleCoverageProof'>,
  scanId: string,
  module: string,
): Prisma.PrismaPromise<unknown> {
  return prisma.ruleCoverageProof.deleteMany({ where: { scanId, module } });
}

/**
 * Покрытие всего скана: объединение доказательств его модулей.
 *
 * Правило принадлежит одному модулю, поэтому объединение по ruleId — простое
 * слияние без конфликтов; повторная запись того же ruleId (module retry уже
 * перезаписал строку) даёт объединение целей при контексте первой записи.
 */
export async function loadScanCoverage(
  prisma: PrismaClient,
  scanId: string,
  onUnreadable?: UnreadableCoverage,
): Promise<ScanCoverage> {
  const proofs = await prisma.ruleCoverageProof.findMany({
    where: { scanId },
    select: { module: true, proof: true },
  });
  const byRule = new Map<string, RuleCoverageEntry>();
  const issueDependencies = new Map<string, readonly string[]>();
  for (const stored of proofs) {
    const read = decodeCoverageProof(stored.proof);
    if (read.problem !== null) {
      onUnreadable?.({ module: stored.module, problem: read.problem });
    }
    for (const [ruleId, entry] of read.coverage) {
      const existing = byRule.get(ruleId);
      byRule.set(ruleId, existing === undefined ? entry : mergeEntries(existing, entry));
    }
    for (const [fingerprint, targets] of read.issueDependencies) {
      issueDependencies.set(fingerprint, targets);
    }
  }
  return { byRule, issueDependencies };
}

function mergeEntries(left: RuleCoverageEntry, right: RuleCoverageEntry): RuleCoverageEntry {
  return {
    checkedTargets: new Set([...left.checkedTargets, ...right.checkedTargets]),
    inputTargets: new Set([...left.inputTargets, ...right.inputTargets]),
    // Спрос объединяется так же, но «не объявлен» побеждает: правило, чей спрос
    // неизвестен хотя бы в одной записи, не даёт признать вход снятым.
    requestedInputs:
      left.requestedInputs === null || right.requestedInputs === null
        ? null
        : new Set([...left.requestedInputs, ...right.requestedInputs]),
    context: left.context,
  };
}

/**
 * Сколько последних завершённых Complete-сканов профиля сохраняют доказательство.
 *
 * Политика сравнивает новый скан ровно с одним — предыдущим ЗАВЕРШЁННЫМ
 * Complete-сканом профиля (issue-sync.ts). Два последних покрывают этот разбор
 * целиком: текущий (он же будущий «предыдущий») и тот, с которым сравнивали.
 * Всё, что старше, не прочитает никто, а хранить его — это та самая
 * неограниченная растущая куча, которой здесь быть не должно.
 */
export const COVERAGE_PROOF_HISTORY = 2;

/**
 * Удаляет доказательства сканов профиля, кроме последних COVERAGE_PROOF_HISTORY.
 *
 * Набор «оставить» повторяет выбор политики: только Completed-сканы, потому что
 * именно среди них она ищет предыдущий. Считать все Complete-сканы подряд
 * нельзя — Queued/Running/Failed/Cancelled скан, созданный позже текущего,
 * занял бы место в истории, не будучи ничьим прошлым, и вытеснил бы настоящее
 * прошлое следующего сравнения.
 *
 * Скан, который прямо сейчас закончился, добавляется к набору отдельно: его
 * доказательство только что записано, и уборка собственного прогона —
 * единственный способ потерять его до первого чтения.
 *
 * Вызывается после разбора Resolved: к этому моменту всё, что политике нужно,
 * уже прочитано. Возвращает число удалённых строк — это единственный след
 * автоматического удаления, и вызывающий его логирует.
 */
export async function pruneCoverageProofs(
  prisma: PrismaClient,
  scan: Pick<Scan, 'id' | 'siteProfileId'>,
  keep: number = COVERAGE_PROOF_HISTORY,
): Promise<number> {
  const recent = await prisma.scan.findMany({
    where: { siteProfileId: scan.siteProfileId, plan: 'Complete', status: 'Completed' },
    orderBy: { createdAt: 'desc' },
    take: keep,
    select: { id: true },
  });
  const keepIds = new Set([scan.id, ...recent.map((completed) => completed.id)]);
  const { count } = await prisma.ruleCoverageProof.deleteMany({
    where: {
      scan: { siteProfileId: scan.siteProfileId },
      scanId: { notIn: [...keepIds] },
    },
  });
  return count;
}
