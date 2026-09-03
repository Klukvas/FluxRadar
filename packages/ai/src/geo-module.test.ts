// Фасад GEO-модуля (T-10, D-174): consent-гейт, агрегация статуса
// Completed/Partial/Unavailable, квота-инварианты на уровне модуля,
// детерминизм повторного прогона.

import { describe, expect, it } from 'vitest';

import { AiModuleError } from './errors.js';
import { runGeoModule } from './geo-module.js';
import type { GeoModuleInput, GeoModuleOptions } from './geo-module.js';
import { geoVisibilityFixtures, MockAiProvider } from './mock-provider.js';
import { AiQuotaTracker } from './quota.js';
import {
  BRAND,
  DOMAIN,
  makeConsent,
  makeRequest,
  ORIGIN,
  QUESTION_WITH_BRAND,
  QUESTION_WITHOUT_BRAND,
  SCAN_ID,
} from './testing/harness.js';
import type { AiProvider } from './types.js';

const TWO_REQUESTS = [
  makeRequest({ sequence: 1, question: QUESTION_WITH_BRAND }),
  makeRequest({ sequence: 2, question: QUESTION_WITHOUT_BRAND }),
];

function moduleInput(overrides: Partial<GeoModuleInput> = {}): GeoModuleInput {
  return {
    scanId: SCAN_ID,
    plan: 'Basic',
    brand: BRAND,
    siteOrigin: ORIGIN,
    siteDomain: DOMAIN,
    consent: makeConsent(),
    requests: TWO_REQUESTS,
    ...overrides,
  };
}

function makeOptions(overrides: Partial<GeoModuleOptions> = {}): GeoModuleOptions {
  return { provider: new MockAiProvider(geoVisibilityFixtures(BRAND, DOMAIN)), ...overrides };
}

function countingProvider(): { provider: AiProvider; calls: () => number } {
  const inner = new MockAiProvider(geoVisibilityFixtures(BRAND, DOMAIN));
  let sendCalls = 0;
  return {
    provider: {
      config: inner.config,
      send: (request, promptText) => {
        sendCalls += 1;
        return inner.send(request, promptText);
      },
    },
    calls: () => sendCalls,
  };
}

describe('runGeoModule — happy path (Basic)', () => {
  it('оба запроса успешны → Completed без statusReason, квота = 2', async () => {
    const result = await runGeoModule(moduleInput(), makeOptions());
    expect(result.module).toBe('AI SEO / GEO');
    expect(result.status).toBe('Completed');
    expect(result.statusReason).toBeNull();
    expect(result.responses).toHaveLength(2);
    expect(result.quota.spent).toBe(2);
    expect(result.quota.outstanding).toBe(0);
  });

  it('GEO-выводы: обе ветки VIS-003/VIS-004 на паре фикстур', async () => {
    const result = await runGeoModule(moduleInput(), makeOptions());
    const byRule = new Map(result.evaluations.map((evaluation) => [evaluation.ruleId, evaluation]));
    // Ответ №1 упоминает бренд и ссылку; №2 — нет: affected ровно 1 у обоих правил.
    expect(byRule.get('GEO-VIS-003')).toMatchObject({ applicableTargets: 2, affectedTargets: 1 });
    expect(byRule.get('GEO-VIS-004')).toMatchObject({ applicableTargets: 2, affectedTargets: 1 });
    expect(byRule.get('GEO-PROVIDER-001')).toMatchObject({ affectedTargets: 0 });
    expect(byRule.get('GEO-METHOD-002')).toMatchObject({ affectedTargets: 0 });
    expect(byRule.get('GEO-METHOD-005')).toMatchObject({ affectedTargets: 0 });
    for (const finding of result.findings) {
      expect(finding.severity).toBeNull();
      expect(finding.scoreDelta).toBe(0);
    }
  });

  it('повторный прогон детерминирован byte-в-byte', async () => {
    const first = await runGeoModule(moduleInput(), makeOptions());
    const second = await runGeoModule(moduleInput(), makeOptions());
    expect(JSON.stringify(second.responses)).toBe(JSON.stringify(first.responses));
    expect(JSON.stringify(second.findings)).toBe(JSON.stringify(first.findings));
  });

  it('retry прогона с прежней квотой не удваивает списание', async () => {
    const first = await runGeoModule(moduleInput(), makeOptions());
    const retried = await runGeoModule(moduleInput(), makeOptions({ quota: first.quota }));
    expect(retried.status).toBe('Completed');
    expect(retried.quota.spent).toBe(2);
  });
});

describe('runGeoModule — consent-гейт (§5)', () => {
  it('нет согласия → модуль Unavailable, провайдер не вызван, квота не тронута', async () => {
    const { provider, calls } = countingProvider();
    const result = await runGeoModule(moduleInput({ consent: null }), { provider });
    expect(result.status).toBe('Unavailable');
    expect(result.statusReason).toBe('ConsentMissing');
    expect(result.responses).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.evaluations).toEqual([]);
    expect(result.quota.spent).toBe(0);
    expect(result.quota.outstanding).toBe(0);
    expect(calls()).toBe(0);
  });

  it('consent чужого скана → та же Unavailable-ветка', async () => {
    const result = await runGeoModule(
      moduleInput({ consent: makeConsent({ scanId: 'other-scan' }) }),
      makeOptions(),
    );
    expect(result.status).toBe('Unavailable');
    expect(result.statusReason).toBe('ConsentMissing');
  });
});

describe('runGeoModule — деградации', () => {
  it('часть запросов без фикстуры → Partial + METHOD-005 finding, квота только за ответы', async () => {
    const result = await runGeoModule(
      moduleInput({
        requests: [...TWO_REQUESTS, makeRequest({ sequence: 3, question: 'Unmatched question' })],
      }),
      makeOptions(),
    );
    expect(result.status).toBe('Partial');
    expect(result.statusReason).toContain('1 of 3');
    expect(result.statusReason).toContain('ProviderUnavailable');
    expect(result.quota.spent).toBe(2);
    expect(result.quota.outstanding).toBe(0);
    const method005 = result.evaluations.find((item) => item.ruleId === 'GEO-METHOD-005');
    expect(method005).toMatchObject({ applicableTargets: 3, affectedTargets: 1 });
    expect(method005?.findings[0]?.normalizedParameter).toBe('q3');
  });

  it('квота меньше числа запросов → Partial, лишние запросы не отправлены', async () => {
    const { provider, calls } = countingProvider();
    const result = await runGeoModule(moduleInput(), {
      provider,
      quota: AiQuotaTracker.withLimit(1),
    });
    expect(result.status).toBe('Partial');
    expect(result.quota.spent).toBe(1);
    expect(calls()).toBe(1);
  });

  it('Free-тариф (лимит 0) → все QuotaExceeded, модуль Unavailable', async () => {
    const { provider, calls } = countingProvider();
    const result = await runGeoModule(moduleInput({ plan: 'Free' }), { provider });
    expect(result.status).toBe('Unavailable');
    expect(result.statusReason).toBe('QuotaExceeded');
    expect(result.quota.spent).toBe(0);
    expect(calls()).toBe(0);
  });

  it('redaction fail-closed на всех запросах → Unavailable RedactionBlocked', async () => {
    const { provider, calls } = countingProvider();
    let tick = 0;
    const result = await runGeoModule(moduleInput(), {
      provider,
      // Чётный вызов — startedAt, нечётный — за deadline: блокирует каждый запрос.
      redaction: { now: () => (tick++ % 2 === 0 ? 0 : 10_000) },
    });
    expect(result.status).toBe('Unavailable');
    expect(result.statusReason).toBe('RedactionBlocked');
    expect(result.responses).toEqual([]);
    expect(result.quota.spent).toBe(0);
    expect(calls()).toBe(0);
  });

  it('пустая библиотека вопросов → Unavailable с явной причиной', async () => {
    const result = await runGeoModule(moduleInput({ requests: [] }), makeOptions());
    expect(result.status).toBe('Unavailable');
    expect(result.statusReason).toBe('EmptyQuestionLibrary');
  });
});

describe('runGeoModule — валидация входа', () => {
  it('запрос чужого скана — ошибка вызывающего кода', async () => {
    const foreign = makeRequest({ scanId: 'other-scan' });
    await expect(
      runGeoModule(moduleInput({ requests: [foreign] }), makeOptions()),
    ).rejects.toThrow(AiModuleError);
  });

  it('пустой brand/siteDomain — ошибка, не молчаливый прогон', async () => {
    await expect(runGeoModule(moduleInput({ brand: ' ' }), makeOptions())).rejects.toThrow(
      AiModuleError,
    );
    await expect(runGeoModule(moduleInput({ siteDomain: '' }), makeOptions())).rejects.toThrow(
      AiModuleError,
    );
  });
});
