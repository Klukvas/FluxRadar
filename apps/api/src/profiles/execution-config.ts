import {
  executionConfigSchema,
  scanScopeSchema,
  type ExecutionConfig,
  type Plan,
  type ScanScopeInput,
} from '@fluxradar/contracts';
import { redact } from '@fluxradar/ai';
import type { Prisma, Scan, SiteProfile } from '@prisma/client';
import { conflict, notFound } from '../http/errors.ts';

const CONTEXT_FIELDS = [
  'industry',
  'region',
  'language',
  'businessDescription',
  'offerings',
  'targetLanguages',
  'targetAudience',
] as const;

export function assertProfileRevision(profile: SiteProfile, expected: number | undefined): void {
  if (expected !== undefined && profile.scanConfigVersion !== expected) {
    throw conflict(
      'PROFILE_CONFIG_CHANGED',
      'The profile changed. Reload it and review the configuration before trying again.',
    );
  }
}

/** Serialize launches with profile updates so a revision and its contents are captured together. */
export async function lockOwnProfile(
  tx: Prisma.TransactionClient,
  accountId: string,
  profileId: string,
  expected?: number,
): Promise<SiteProfile> {
  await tx.$queryRaw`SELECT "id" FROM "SiteProfile" WHERE "id" = ${profileId} AND "accountId" = ${accountId} FOR UPDATE`;
  const profile = await tx.siteProfile.findFirst({ where: { id: profileId, accountId } });
  if (profile === null) throw notFound('site profile not found');
  assertProfileRevision(profile, expected);
  return profile;
}

export function captureExecutionConfig(
  profile: SiteProfile,
  plan: Plan,
  scope: ScanScopeInput,
): ExecutionConfig {
  return executionConfigSchema.parse({
    schemaVersion: 1,
    source: 'launch',
    profileConfigVersion: profile.scanConfigVersion,
    plan,
    scope,
    profile: {
      name: redact(profile.name).text,
      domain: profile.domain,
      ...Object.fromEntries(
        CONTEXT_FIELDS.flatMap((key) => {
          const value = profile[key];
          return value === null ? [] : [[key, redact(value).text]];
        }),
      ),
    },
  });
}

export function storedExecutionConfig(value: string | null | undefined): ExecutionConfig | null {
  if (value == null) return null;
  try {
    const parsed = executionConfigSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Historical context cannot be reconstructed from today's editable profile. */
export function executionProfile(
  scan: Pick<Scan, 'domain' | 'executionConfigJson'>,
  profile: SiteProfile,
): SiteProfile {
  const stored = storedExecutionConfig(scan.executionConfigJson)?.profile;
  return {
    ...profile,
    name: stored?.name ?? new URL(scan.domain).hostname,
    domain: stored?.domain ?? scan.domain,
    industry: stored?.industry ?? null,
    region: stored?.region ?? null,
    language: stored?.language ?? null,
    businessDescription: stored?.businessDescription ?? null,
    offerings: stored?.offerings ?? null,
    targetLanguages: stored?.targetLanguages ?? null,
    targetAudience: stored?.targetAudience ?? null,
  };
}

export function legacyCheckoutConfig(
  domain: string,
  plan: Plan,
  scopeJson: string,
): ExecutionConfig {
  return executionConfigSchema.parse({
    schemaVersion: 1,
    source: 'legacy-checkout',
    profileConfigVersion: null,
    profile: { name: new URL(domain).hostname, domain },
    plan,
    scope: scanScopeSchema.parse(JSON.parse(scopeJson)),
  });
}
