// GEO-правила ×5 (T-10): обе ветки каждого правила; все выводы informational
// (severity null, scoreDelta 0 — D-109/GEO-METHOD-005).

import { describe, expect, it } from 'vitest';

import { AiModuleError } from './errors.js';
import {
  evaluateGeoMethod002,
  evaluateGeoMethod005,
  evaluateGeoProvider001,
  evaluateGeoRules,
  evaluateGeoVis003,
  evaluateGeoVis004,
} from './geo-rules.js';
import type { GeoRuleInput } from './geo-rules.js';
import {
  BRAND,
  DOMAIN,
  makeRequest,
  makeResponse,
  makeResponseOutcome,
  makeUnavailableOutcome,
  ORIGIN,
} from './testing/harness.js';

function input(overrides: Partial<GeoRuleInput> = {}): GeoRuleInput {
  return {
    domain: DOMAIN,
    siteUrl: ORIGIN,
    brand: BRAND,
    outcomes: [makeResponseOutcome()],
    ...overrides,
  };
}

const outcomeWithoutBrandAndLink = makeResponseOutcome({
  request: makeRequest({ sequence: 2, question: 'What are alternatives?' }),
  response: makeResponse({
    rawText: 'Popular vendors include Acme Audit and Globex Scanner.',
    citations: [],
  }),
});

describe('GEO-VIS-003 — присутствие бренда', () => {
  it('бренд упомянут → без findings', () => {
    const evaluation = evaluateGeoVis003(input());
    expect(evaluation.applicableTargets).toBe(1);
    expect(evaluation.affectedTargets).toBe(0);
    expect(evaluation.findings).toEqual([]);
  });

  it('бренд отсутствует → informational finding с нулевым score-влиянием', () => {
    const evaluation = evaluateGeoVis003(input({ outcomes: [outcomeWithoutBrandAndLink] }));
    expect(evaluation.affectedTargets).toBe(1);
    const finding = evaluation.findings[0];
    expect(finding).toMatchObject({
      ruleId: 'GEO-VIS-003',
      targetKind: 'site',
      severity: null,
      scoreDelta: 0,
      normalizedUrl: '',
      normalizedParameter: 'q2',
      normalizedResource: 'openai',
    });
    expect(finding?.aiRequestKey).toBe(outcomeWithoutBrandAndLink.aiRequestKey);
    expect(finding?.evidenceExcerpt).toContain(BRAND);
  });

  it('сравнение case-insensitive', () => {
    const outcome = makeResponseOutcome({
      response: makeResponse({ rawText: 'try FLUXRADAR for audits', citations: [] }),
    });
    expect(evaluateGeoVis003(input({ outcomes: [outcome] })).affectedTargets).toBe(0);
  });

  it('unavailable-итоги не входят в applicable', () => {
    const evaluation = evaluateGeoVis003(input({ outcomes: [makeUnavailableOutcome()] }));
    expect(evaluation.applicableTargets).toBe(0);
    expect(evaluation.findings).toEqual([]);
  });

  it('пустой бренд — ошибка конфигурации, не молчание', () => {
    expect(() => evaluateGeoVis003(input({ brand: '  ' }))).toThrow(AiModuleError);
  });
});

describe('GEO-VIS-004 — ссылка на домен', () => {
  it('домен в тексте ответа → без findings', () => {
    expect(evaluateGeoVis004(input()).affectedTargets).toBe(0);
  });

  it('домен только в citations (включая поддомен) → без findings', () => {
    const outcome = makeResponseOutcome({
      response: makeResponse({
        rawText: 'A scanner with transparent pricing exists.',
        citations: [`https://docs.${DOMAIN}/start`],
      }),
    });
    expect(evaluateGeoVis004(input({ outcomes: [outcome] })).affectedTargets).toBe(0);
  });

  it('ни текста, ни citations с доменом → finding', () => {
    const evaluation = evaluateGeoVis004(input({ outcomes: [outcomeWithoutBrandAndLink] }));
    expect(evaluation.affectedTargets).toBe(1);
    expect(evaluation.findings[0]).toMatchObject({
      ruleId: 'GEO-VIS-004',
      severity: null,
      scoreDelta: 0,
      normalizedParameter: 'q2',
    });
  });

  it('подстрока домена внутри чужого hostname в тексте — не ссылка (D-178)', () => {
    const outcome = makeResponseOutcome({
      response: makeResponse({
        rawText: `try not${DOMAIN} or ${DOMAIN}.evil.com today`,
        citations: [],
      }),
    });
    expect(evaluateGeoVis004(input({ outcomes: [outcome] })).affectedTargets).toBe(1);
  });

  it('поддомен и домен на границе предложения в тексте — ссылка', () => {
    const subdomain = makeResponseOutcome({
      response: makeResponse({ rawText: `visit www.${DOMAIN} now`, citations: [] }),
    });
    const sentenceEnd = makeResponseOutcome({
      response: makeResponse({ rawText: `Visit ${DOMAIN.toUpperCase()}.`, citations: [] }),
    });
    expect(evaluateGeoVis004(input({ outcomes: [subdomain, sentenceEnd] })).affectedTargets).toBe(
      0,
    );
  });

  it('битый citation-URL и чужой похожий домен не считаются ссылкой', () => {
    const outcome = makeResponseOutcome({
      response: makeResponse({
        rawText: 'Nothing relevant here.',
        citations: ['not a url', `https://evil-${DOMAIN}.example.com/`],
      }),
    });
    expect(evaluateGeoVis004(input({ outcomes: [outcome] })).affectedTargets).toBe(1);
  });
});

describe('GEO-PROVIDER-001 — контракт §5', () => {
  it('валидные ответы → без findings', () => {
    const evaluation = evaluateGeoProvider001(input());
    expect(evaluation.applicableTargets).toBe(1);
    expect(evaluation.findings).toEqual([]);
  });

  it('total != input + output → finding с перечислением нарушений', () => {
    const outcome = makeResponseOutcome({
      response: makeResponse({ usage: { inputTokens: 10, outputTokens: 5, totalTokens: 99 } }),
    });
    const evaluation = evaluateGeoProvider001(input({ outcomes: [outcome] }));
    expect(evaluation.affectedTargets).toBe(1);
    expect(evaluation.findings[0]?.evidenceExcerpt).toContain('totalTokens');
    expect(evaluation.findings[0]?.severity).toBeNull();
  });

  it('estimated без tokenizerVersion → finding', () => {
    const outcome = makeResponseOutcome({
      response: makeResponse({ usageSource: 'estimated' }),
    });
    expect(evaluateGeoProvider001(input({ outcomes: [outcome] })).affectedTargets).toBe(1);
  });
});

describe('GEO-METHOD-002 — фиксация метаданных', () => {
  it('полные метаданные → без findings', () => {
    expect(evaluateGeoMethod002(input()).findings).toEqual([]);
  });

  it('пустой promptVersion → finding с именем поля', () => {
    const outcome = makeResponseOutcome({
      request: makeRequest({ promptVersion: '' }),
    });
    const evaluation = evaluateGeoMethod002(input({ outcomes: [outcome] }));
    expect(evaluation.affectedTargets).toBe(1);
    expect(evaluation.findings[0]?.evidenceExcerpt).toContain('prompt_version');
  });
});

describe('GEO-METHOD-005 — Unavailable без штрафа', () => {
  it('все запросы успешны → без findings', () => {
    const evaluation = evaluateGeoMethod005(input());
    expect(evaluation.applicableTargets).toBe(1);
    expect(evaluation.findings).toEqual([]);
  });

  it('недоступный запрос → informational finding, scoreDelta 0, без ai_response', () => {
    const unavailable = makeUnavailableOutcome();
    const evaluation = evaluateGeoMethod005(
      input({ outcomes: [makeResponseOutcome(), unavailable] }),
    );
    expect(evaluation.applicableTargets).toBe(2);
    expect(evaluation.affectedTargets).toBe(1);
    const finding = evaluation.findings[0];
    expect(finding).toMatchObject({
      ruleId: 'GEO-METHOD-005',
      severity: null,
      scoreDelta: 0,
      aiRequestKey: null,
    });
    expect(finding?.evidenceExcerpt).toContain('ProviderUnavailable');
  });
});

describe('evaluateGeoRules', () => {
  it('возвращает все 5 правил в порядке реестра', () => {
    const evaluations = evaluateGeoRules(input());
    expect(evaluations.map((evaluation) => evaluation.ruleId)).toEqual([
      'GEO-PROVIDER-001',
      'GEO-VIS-003',
      'GEO-VIS-004',
      'GEO-METHOD-002',
      'GEO-METHOD-005',
    ]);
  });
});
