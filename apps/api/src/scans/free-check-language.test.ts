// The AI question's language on a Free check (D-237: the owner's choice, else
// the site's language, else the UI language): validated at the route, captured
// into the scan's execution config at creation, and read back intact. No
// database: the transaction runs against an in-memory stand-in that records
// what createFreeScan writes.

import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from '@fluxradar/ai';
import { executionConfigSchema } from '@fluxradar/contracts';
import type { PrismaClient, SiteProfile } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../http/errors.ts';
import { parseInput } from '../http/validate.ts';
import { storedExecutionConfig } from '../profiles/execution-config.ts';
import { freeAiConsentSchema } from './free-ai-consent.ts';
import type { LaunchEgress } from './launch-egress.ts';
import { createFreeScan, freeCheckBodySchema } from './routes.ts';

const PROFILE = {
  id: 'profile-1',
  accountId: 'account-1',
  name: 'Smile Clinic',
  domain: 'https://smile.example',
  industry: null,
  region: null,
  language: 'ru',
  businessDescription: null,
  offerings: null,
  targetLanguages: 'ru, en',
  targetAudience: null,
  competitorsJson: null,
  scanConfigVersion: 1,
  scanConfigJson: '{}',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} as unknown as SiteProfile;

const NO_EGRESS = { location: null } as unknown as LaunchEgress;

function fakePrisma(profile: SiteProfile = PROFILE): {
  prisma: PrismaClient;
  created: () => Record<string, unknown>;
} {
  let createdScan: Record<string, unknown> | null = null;
  const tx = {
    $queryRaw: () => Promise.resolve([{ id: PROFILE.id }]),
    siteProfile: { findFirst: () => Promise.resolve(profile) },
    account: { updateMany: () => Promise.resolve({ count: 1 }) },
    freeCheckClaim: { create: () => Promise.resolve({}) },
    scan: {
      create: (args: { data: Record<string, unknown> }) => {
        createdScan = { id: 'scan-1', ...args.data };
        return Promise.resolve(createdScan);
      },
    },
    job: { create: () => Promise.resolve({}) },
    aiConsentRecord: { create: () => Promise.resolve({}) },
  };
  const prisma = {
    $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  } as unknown as PrismaClient;
  return {
    prisma,
    created: () => {
      if (createdScan === null) throw new Error('no scan was created');
      return createdScan;
    },
  };
}

async function createWith(language: 'en' | 'uk' | undefined, profile: SiteProfile = PROFILE) {
  const { prisma, created } = fakePrisma(profile);
  await createFreeScan(prisma, {
    accountId: 'account-1',
    siteProfileId: PROFILE.id,
    now: new Date('2026-11-06T00:00:00.000Z'),
    egress: NO_EGRESS,
    ...(language === undefined ? {} : { language }),
  });
  const config = storedExecutionConfig(String(created().executionConfigJson));
  if (config === null) throw new Error('the stored execution config did not parse');
  return config;
}

describe('free-check body language', () => {
  it('accepts en and uk beside the consent object, and no language at all', () => {
    for (const language of ['en', 'uk'] as const) {
      expect(parseInput(freeCheckBodySchema, { language })?.language).toBe(language);
    }
    expect(parseInput(freeCheckBodySchema, {})?.language).toBeUndefined();
    expect(parseInput(freeCheckBodySchema, undefined)).toBeUndefined();
  });

  it.each(['ru', 'UK', 'uk-UA', '', 1, null])('refuses %o with a 400, never coerced', (value) => {
    let thrown: unknown;
    try {
      parseInput(freeCheckBodySchema, { language: value });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).status).toBe(400);
  });

  it('keeps the consent object strict: a language inside it is refused', () => {
    const consent = {
      providers: ['anthropic'],
      noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
    };
    expect(freeAiConsentSchema.safeParse(consent).success).toBe(true);
    expect(freeAiConsentSchema.safeParse({ ...consent, language: 'uk' }).success).toBe(false);
    expect(parseInput(freeCheckBodySchema, { aiConsent: consent, language: 'uk' })).toEqual({
      aiConsent: consent,
      language: 'uk',
    });
  });
});

describe('createFreeScan language capture', () => {
  it('stores the body language in the execution config and reads it back', async () => {
    expect((await createWith('uk'))?.language).toBe('uk');
  });

  // D-237 (owner decision, superseding W1's "reader language wins"): a body
  // without a language asks in the site's language from the stored profile.
  it.each([
    ['Ukrainian, English', null, 'uk'],
    ['Russian, Ukrainian', null, 'uk'],
    ['English, Ukrainian', 'uk', 'en'],
    ['Українська', null, 'uk'],
    ['uk-UA', null, 'uk'],
    [null, 'uk', 'uk'],
    ['Russian', 'ru', 'en'],
    [null, null, 'en'],
    [null, 'Polish', 'en'],
  ] as const)(
    'with no body language, targets %o and language %o ask in %s',
    async (targetLanguages, language, expected) => {
      const profile = { ...PROFILE, targetLanguages, language } as SiteProfile;
      expect((await createWith(undefined, profile))?.language).toBe(expected);
    },
  );

  it('keeps the explicit body language over the site language', async () => {
    const ukrainianSite = {
      ...PROFILE,
      targetLanguages: 'Ukrainian',
      language: 'uk',
    } as SiteProfile;
    expect((await createWith('en', ukrainianSite))?.language).toBe('en');
    const config = await createWith('uk');
    expect(config?.language).toBe('uk');
    expect(config?.profile.language).toBe('ru');
  });
});

describe('executionConfigSchema language', () => {
  const base = {
    schemaVersion: 1,
    source: 'launch',
    profileConfigVersion: 1,
    profile: { name: 'Smile Clinic', domain: 'https://smile.example' },
    plan: 'Free',
    scope: { includeSubdomains: false },
  };

  it('keeps language through a parse instead of stripping it', () => {
    expect(executionConfigSchema.parse({ ...base, language: 'uk' }).language).toBe('uk');
    expect(storedExecutionConfig(JSON.stringify({ ...base, language: 'uk' }))?.language).toBe('uk');
  });

  it('reads a config captured before the field existed as no language (English)', () => {
    const stored = storedExecutionConfig(JSON.stringify(base));
    expect(stored).not.toBeNull();
    expect(stored?.language).toBeUndefined();
  });

  it('rejects an unknown language rather than guessing', () => {
    expect(executionConfigSchema.safeParse({ ...base, language: 'ru' }).success).toBe(false);
  });
});
