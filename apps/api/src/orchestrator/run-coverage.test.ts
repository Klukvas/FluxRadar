// Доказательство покрытия переживает прогон в собственной таблице, поэтому
// важны четыре вещи: оно кодируется без потерь, непригодная запись не
// превращается в «проверено», его размер честно ограничен — и реальный обход
// самого дорогого тарифа в этот предел помещается.

import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import type { RunRequestContext } from './run-context.ts';
import { UNKNOWN_RUN_CONTEXT } from './run-context.ts';
import {
  MAX_COVERAGE_PROOF_TARGETS,
  MAX_REQUESTED_INPUT_TARGETS,
  decodeCoverageProof,
  encodeRuleCoverage,
  serializeCoverageProof,
  writesCoverageProof,
  type ModuleCoverage,
  type RuleCoverage,
} from './run-coverage.ts';

const HOME = 'https://example.com/';
const SHOP = 'https://example.com/shop';
const BLOG = 'https://example.com/blog';

const DESKTOP: RunRequestContext = {
  userAgent: 'desktop',
  ga4PropertyId: null,
  searchConsoleSiteUrl: null,
  crawlScope: 'scope-v2:whole-site',
  bingSiteUrl: null,
};

function proofOf(
  rules: readonly RuleCoverage[],
  extra: Partial<ModuleCoverage> = {},
): ModuleCoverage {
  return { rules, context: DESKTOP, ...extra };
}

/** Запись, как её увидит политика: сериализация → чтение из байтов. */
function roundTrip(coverage: ModuleCoverage): ReturnType<typeof decodeCoverageProof> {
  return decodeCoverageProof(serializeCoverageProof(coverage));
}

describe('кодирование покрытия', () => {
  it('восстанавливает цели каждого правила без потерь', () => {
    const read = roundTrip(
      proofOf([
        { ruleId: 'SEO-TECH-004', checkedTargets: [HOME, SHOP] },
        { ruleId: 'SEO-TECH-007', checkedTargets: [HOME, SHOP, BLOG] },
        { ruleId: 'SEO-TECH-001', checkedTargets: [`${HOME}robots.txt`] },
      ]),
    );
    expect(read.problem).toBeNull();
    expect([...read.coverage.keys()].toSorted()).toEqual([
      'SEO-TECH-001',
      'SEO-TECH-004',
      'SEO-TECH-007',
    ]);
    expect([...(read.coverage.get('SEO-TECH-004')?.checkedTargets ?? [])].toSorted()).toEqual([
      HOME,
      SHOP,
    ]);
    expect(read.coverage.get('SEO-TECH-007')?.checkedTargets.size).toBe(3);
  });

  it('входы, спрос и цели правила хранятся тремя отдельными величинами', () => {
    // SEO-TECH-006 судит страницу-источник, читает снимки целей её ссылок и
    // спрашивает обход обо всех ссылках: политика Resolved обязана видеть все
    // три по отдельности — иначе «вход пропал» и «ссылки больше нет» сливаются.
    const read = roundTrip(
      proofOf([
        {
          ruleId: 'SEO-TECH-006',
          checkedTargets: [HOME],
          inputTargets: [HOME, SHOP],
          requestedInputs: [HOME, SHOP, BLOG],
        },
        { ruleId: 'SEO-TECH-004', checkedTargets: [HOME] },
      ]),
    );
    const brokenLinks = read.coverage.get('SEO-TECH-006');
    expect([...(brokenLinks?.checkedTargets ?? [])]).toEqual([HOME]);
    expect([...(brokenLinks?.inputTargets ?? [])].toSorted()).toEqual([HOME, SHOP]);
    expect([...(brokenLinks?.requestedInputs ?? [])].toSorted()).toEqual([HOME, BLOG, SHOP]);
    // Правило без объявленных входов не получает их «по умолчанию», а его
    // неназванный спрос остаётся null — это «не знаю», а не «пустой спрос».
    expect(read.coverage.get('SEO-TECH-004')?.inputTargets.size).toBe(0);
    expect(read.coverage.get('SEO-TECH-004')?.requestedInputs).toBeNull();
  });

  it('объявленный пустой спрос отличается от необъявленного', () => {
    const read = roundTrip(
      proofOf([{ ruleId: 'CONTENT-004', checkedTargets: [HOME], requestedInputs: [] }]),
    );
    expect(read.coverage.get('CONTENT-004')?.requestedInputs).toEqual(new Set());
  });

  it('зависимости находки хранятся по её fingerprint', () => {
    const read = roundTrip(
      proofOf([{ ruleId: 'SEO-TECH-006', checkedTargets: [HOME], inputTargets: [HOME, SHOP] }], {
        issueDependencies: new Map([['fp-link', [SHOP]]]),
      }),
    );
    expect(read.issueDependencies.get('fp-link')).toEqual([SHOP]);
  });

  it('конфигурация запроса едет вместе с целями', () => {
    const read = roundTrip(
      proofOf([{ ruleId: 'ANALYTICS-GA-001', checkedTargets: [HOME] }], {
        context: {
          userAgent: 'mobile',
          ga4PropertyId: '4242',
          searchConsoleSiteUrl: 'sc-domain:example.com',
          crawlScope: 'scope-v2:blog-only',
          bingSiteUrl: 'https://example.com/',
        },
      }),
    );
    expect(read.coverage.get('ANALYTICS-GA-001')?.context).toEqual({
      userAgent: 'mobile',
      ga4PropertyId: '4242',
      searchConsoleSiteUrl: 'sc-domain:example.com',
      crawlScope: 'scope-v2:blog-only',
      bingSiteUrl: 'https://example.com/',
    });
  });

  it('правило, не смотревшее ни на что, остаётся в записи с пустым набором', () => {
    // Иначе «не проверяли» стало бы неотличимо от «правила не было».
    const read = roundTrip(proofOf([{ ruleId: 'PRIVACY-004', checkedTargets: [] }]));
    expect(read.coverage.get('PRIVACY-004')?.checkedTargets).toEqual(new Set());
  });

  it('одинаковые наборы страниц хранятся один раз', () => {
    // Почти все page-правила модуля смотрят на один и тот же набор страниц: на
    // 20 правил и 100 страниц разница между «набор на правило» и общим набором —
    // два порядка размера записи.
    const encoded = encodeRuleCoverage(
      proofOf([
        { ruleId: 'SEO-TECH-003', checkedTargets: [HOME, SHOP] },
        { ruleId: 'SEO-TECH-004', checkedTargets: [HOME, SHOP] },
        { ruleId: 'SEO-TECH-005', checkedTargets: [SHOP, HOME] },
        { ruleId: 'CONTENT-004', checkedTargets: [HOME] },
      ]),
    );
    expect(encoded.urls).toEqual([HOME, SHOP]);
    expect(encoded.targetSets).toHaveLength(2);
    expect(encoded.rules['SEO-TECH-005']?.checked).toBe(encoded.rules['SEO-TECH-003']?.checked);
  });

  it('дубли целей одного правила не раздувают запись', () => {
    const encoded = encodeRuleCoverage(
      proofOf([{ ruleId: 'SEO-TECH-004', checkedTargets: [HOME, HOME] }]),
    );
    expect(encoded.targetSets).toEqual([[0]]);
  });
});

describe('предел размера и его цена', () => {
  const targets = (count: number, prefix = 'page'): readonly string[] =>
    Array.from({ length: count }, (_unused, index) => `${HOME}${prefix}-${index}`);

  it('обход крупнее лимита не хранит частичное доказательство', () => {
    // Обрезанный список входов ПРОШЛОГО прогона выглядел бы как меньшие
    // требования и упрощал бы закрытие находки — обрезать доказательство нельзя.
    const encoded = encodeRuleCoverage(
      proofOf([
        { ruleId: 'SEO-TECH-004', checkedTargets: targets(MAX_COVERAGE_PROOF_TARGETS + 1) },
      ]),
    );
    expect(encoded.truncated).toBe(true);
    expect(encoded.urls).toEqual([]);
    expect(encoded.rules).toEqual({});
  });

  it('обрезанное доказательство читается как отсутствие доказательства', () => {
    const read = roundTrip(
      proofOf([
        { ruleId: 'SEO-TECH-004', checkedTargets: targets(MAX_COVERAGE_PROOF_TARGETS + 1) },
      ]),
    );
    expect(read.coverage.size).toBe(0);
    expect(read.problem).toContain('coverage proof limit');
  });

  it('слишком большой спрос выбрасывается отдельно и делает правило строже', () => {
    // Потеря спроса не позволяет признать вход снятым, поэтому её цена —
    // лишняя открытая находка, а не ошибочно закрытая. Доказательство проверки
    // при этом сохраняется целиком.
    const read = roundTrip(
      proofOf([
        {
          ruleId: 'SEO-TECH-006',
          checkedTargets: [HOME],
          inputTargets: [HOME],
          requestedInputs: targets(MAX_REQUESTED_INPUT_TARGETS + 1, 'link'),
        },
      ]),
    );
    expect(read.problem).toBeNull();
    expect(read.coverage.get('SEO-TECH-006')?.checkedTargets).toEqual(new Set([HOME]));
    expect(read.coverage.get('SEO-TECH-006')?.requestedInputs).toBeNull();
  });

  it('обход тарифа Complete (50 000 URL) помещается в запись обычного размера', () => {
    // Ровно та ситуация, в которой прошлая версия не хранила ничего и НИ ОДНА
    // находка сайта не могла стать Resolved. Числа — измеренные, а не обещанные.
    const pages = targets(50_000);
    const pageRules: readonly RuleCoverage[] = Array.from({ length: 12 }, (_unused, index) => ({
      ruleId: `SEO-TECH-0${String(index + 10)}`,
      checkedTargets: pages,
    }));
    const bytes = serializeCoverageProof(
      proofOf([
        ...pageRules,
        {
          ruleId: 'SEO-TECH-006',
          checkedTargets: pages,
          inputTargets: pages,
          requestedInputs: [...pages, ...targets(10_000, 'link')],
        },
        { ruleId: 'SEO-TECH-007', checkedTargets: pages, requestedInputs: pages },
      ]),
    );
    expect(bytes.byteLength).toBeLessThan(2 * 1024 * 1024);
    const read = decodeCoverageProof(bytes);
    expect(read.problem).toBeNull();
    expect(read.coverage.get('SEO-TECH-006')?.checkedTargets.size).toBe(50_000);
    expect(read.coverage.get('SEO-TECH-006')?.requestedInputs?.size).toBe(60_000);
  });
});

describe('чтение чужой записи', () => {
  it('повреждённое доказательство сообщается и ничего не подтверждает', () => {
    const broken = gzipSync(
      Buffer.from(JSON.stringify({ urls: [HOME], targetSets: 'nope', rules: {} })),
    );
    const read = decodeCoverageProof(broken);
    expect(read.coverage.size).toBe(0);
    expect(read.problem).toContain('malformed');
  });

  it('ссылка на несуществующий набор целей не проходит за проверенное', () => {
    const read = decodeCoverageProof(
      gzipSync(
        Buffer.from(
          JSON.stringify({
            urls: [HOME],
            targetSets: [[0]],
            rules: { 'SEO-TECH-004': { checked: 7 } },
          }),
        ),
      ),
    );
    expect(read.coverage.size).toBe(0);
    expect(read.problem).toContain('unknown target set');
  });

  it('доказательство без scope читается, но scope остаётся неизвестным', () => {
    // Запись, сделанная до того, как scope обхода вошёл в контекст: остальные
    // поля читаются, а scope остаётся null и сравнению не подлежит.
    const read = decodeCoverageProof(
      gzipSync(
        Buffer.from(
          JSON.stringify({
            urls: [HOME],
            targetSets: [[0]],
            rules: { 'SEO-TECH-004': { checked: 0 } },
            context: {
              userAgent: 'desktop',
              ga4PropertyId: null,
              searchConsoleSiteUrl: null,
            },
          }),
        ),
      ),
    );
    expect(read.problem).toBeNull();
    expect(read.coverage.get('SEO-TECH-004')?.context).toEqual({
      userAgent: 'desktop',
      ga4PropertyId: null,
      searchConsoleSiteUrl: null,
      bingSiteUrl: null,
      crawlScope: null,
    });
  });

  it('доказательство без контекста читается, но контекст остаётся неизвестным', () => {
    // Запись из времён до run-context.ts: политика обязана обойтись с ней
    // консервативно, а не подставить «desktop» за неё.
    const read = decodeCoverageProof(
      gzipSync(
        Buffer.from(
          JSON.stringify({
            urls: [HOME],
            targetSets: [[0]],
            rules: { 'SEO-TECH-004': { checked: 0 } },
          }),
        ),
      ),
    );
    expect(read.problem).toBeNull();
    expect(read.coverage.get('SEO-TECH-004')?.context).toEqual(UNKNOWN_RUN_CONTEXT);
  });

  it('несжатые или чужие байты сообщаются, а не тихо считаются пустыми', () => {
    expect(decodeCoverageProof(Buffer.from('{not gzip')).problem).toContain(
      'could not be decompressed',
    );
    expect(decodeCoverageProof(gzipSync(Buffer.from('{not json'))).problem).toContain(
      'not valid JSON',
    );
  });
});

describe('какие сканы вообще пишут доказательство', () => {
  it('только Complete: закрывать находки вправе только он (§515)', () => {
    expect(writesCoverageProof('Complete')).toBe(true);
    expect(writesCoverageProof('Basic')).toBe(false);
    expect(writesCoverageProof('Free')).toBe(false);
  });
});
