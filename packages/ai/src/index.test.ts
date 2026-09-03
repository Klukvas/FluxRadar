// Smoke-тест публичного API пакета: ключевые экспорты T-10 доступны из index.

import { rulesForModule } from '@fluxradar/contracts';
import { describe, expect, it } from 'vitest';

import * as api from './index.js';

describe('@fluxradar/ai — публичный API', () => {
  it('экспортирует все строительные блоки T-10', () => {
    expect(api.MockAiProvider).toBeTypeOf('function');
    expect(api.AiQuotaTracker).toBeTypeOf('function');
    expect(api.runGeoModule).toBeTypeOf('function');
    expect(api.runAiRequest).toBeTypeOf('function');
    expect(api.evaluateGeoRules).toBeTypeOf('function');
    expect(api.validateNormalizedResponse).toBeTypeOf('function');
    expect(api.buildPrompt).toBeTypeOf('function');
    expect(api.redact).toBeTypeOf('function');
    expect(api.ensureConsent).toBeTypeOf('function');
    expect(api.aiRequestKey).toBeTypeOf('function');
    expect(api.geoVisibilityFixtures).toBeTypeOf('function');
  });

  it('покрывает все 5 GEO-дескрипторов реестра rules-mvp-0.1', () => {
    const registryIds = rulesForModule('AI SEO / GEO').map((descriptor) => descriptor.ruleId);
    const evaluated = api
      .evaluateGeoRules({
        domain: 'example.com',
        siteUrl: 'https://example.com',
        brand: 'Example',
        outcomes: [],
      })
      .map((evaluation) => evaluation.ruleId);
    expect([...evaluated].sort()).toEqual([...registryIds].sort());
  });
});
