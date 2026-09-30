import type { AiProvider, NormalizedAiResponse } from '@fluxradar/ai';
import { describe, expect, it, vi } from 'vitest';

import {
  ProfileContextTranslationUnavailableError,
  profileContextTranslationSchema,
  translateProfileContextWithProvider,
} from './profile-context-translation.ts';

function response(rawText: string): NormalizedAiResponse {
  return {
    provider: 'anthropic',
    apiVersion: '2023-06-01',
    modelId: 'test-model',
    requestId: 'request',
    requestIdSource: 'provider',
    createdAt: '2026-01-01T00:00:00.000Z',
    rawText,
    citations: [],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    usageSource: 'provider',
    finishReason: 'stop',
  };
}

function providerReturning(rawText: string): AiProvider {
  return {
    config: {
      provider: 'anthropic',
      apiVersion: '2023-06-01',
      modelId: 'test-model',
      timeoutMs: 30_000,
      maxRetries: 1,
    },
    send: vi.fn().mockResolvedValue(response(rawText)),
  };
}

describe('profile context translation', () => {
  const input = {
    targetLanguage: 'uk' as const,
    industry: 'Product studio',
    offerings: 'Software development',
  };

  it('bounds and schemas a provider request, preserving the submitted field set', async () => {
    const provider = providerReturning(
      JSON.stringify({
        industry: 'Продуктова студія',
        offerings: 'Розробка програмного забезпечення',
      }),
    );
    await expect(translateProfileContextWithProvider(input, provider)).resolves.toEqual({
      industry: 'Продуктова студія',
      offerings: 'Розробка програмного забезпечення',
    });
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        reasoningMode: 'disabled',
        responseSchema: expect.objectContaining({ additionalProperties: false }),
        caps: { maxInputTokens: 2_000, maxOutputTokens: 1_500 },
      }),
      expect.stringContaining('"targetLanguage":"uk"'),
      undefined,
    );
    expect(provider.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.stringContaining('targetLanguages'),
      undefined,
    );
  });

  it.each([
    'not json',
    JSON.stringify({ industry: 'Продуктова студія' }),
    JSON.stringify({
      industry: 'Продуктова студія',
      offerings: 'Розробка',
      unexpected: 'not allowed',
    }),
    JSON.stringify({ industry: '', offerings: 'Розробка' }),
    JSON.stringify({ industry: '   ', offerings: 'Розробка' }),
  ])('fails closed for malformed or mismatched provider output', async (rawText) => {
    await expect(
      translateProfileContextWithProvider(input, providerReturning(rawText)),
    ).rejects.toBeInstanceOf(ProfileContextTranslationUnavailableError);
  });

  it('refuses identity and target-language fields at the boundary', () => {
    expect(
      profileContextTranslationSchema.safeParse({
        targetLanguage: 'uk',
        industry: 'Product studio',
        targetLanguages: 'en, uk',
      }).success,
    ).toBe(false);
  });
});

describe('profile context translation boundaries', () => {
  const limits = {
    industry: 64,
    businessDescription: 800,
    offerings: 1_200,
    region: 64,
    targetAudience: 500,
  } as const;

  it('rejects empty or whitespace-only context before the provider', () => {
    expect(profileContextTranslationSchema.safeParse({ targetLanguage: 'uk' }).success).toBe(false);
    expect(
      profileContextTranslationSchema.safeParse({
        targetLanguage: 'uk',
        industry: '   ',
      }).success,
    ).toBe(false);
  });

  it.each(Object.entries(limits))(
    'fails closed when translated %s exceeds its saveable limit',
    async (field, limit) => {
      const input = { targetLanguage: 'uk' as const, [field]: 'source' };
      const rawText = JSON.stringify({ [field]: 'x'.repeat(limit + 1) });
      await expect(
        translateProfileContextWithProvider(input, providerReturning(rawText)),
      ).rejects.toBeInstanceOf(ProfileContextTranslationUnavailableError);
    },
  );

  it('keeps the complete maximum saveable context below the bounded provider prompt cap', async () => {
    const input = {
      targetLanguage: 'uk' as const,
      industry: 'i'.repeat(limits.industry),
      businessDescription: 'd'.repeat(limits.businessDescription),
      offerings: 'o'.repeat(limits.offerings),
      region: 'r'.repeat(limits.region),
      targetAudience: 'a'.repeat(limits.targetAudience),
    };
    const provider = providerReturning(
      JSON.stringify({
        industry: input.industry,
        businessDescription: input.businessDescription,
        offerings: input.offerings,
        region: input.region,
        targetAudience: input.targetAudience,
      }),
    );
    await expect(translateProfileContextWithProvider(input, provider)).resolves.toMatchObject({
      industry: input.industry,
    });
    const prompt = vi.mocked(provider.send).mock.calls[0]?.[1] ?? '';
    expect(prompt.length).toBeLessThanOrEqual(4_000);
  });
});

it('rejects an escape-expanded maximum payload before calling the provider', async () => {
  const escaped = '"'.repeat(64);
  const input = {
    targetLanguage: 'uk' as const,
    industry: escaped,
    businessDescription: '"'.repeat(800),
    offerings: '"'.repeat(1_200),
    region: escaped,
    targetAudience: '"'.repeat(500),
  };
  const provider = providerReturning(JSON.stringify({}));
  await expect(translateProfileContextWithProvider(input, provider)).rejects.toBeInstanceOf(
    ProfileContextTranslationUnavailableError,
  );
  expect(provider.send).not.toHaveBeenCalled();
});
