// executionProfile (T7-fix F8) is a pure function with no DB pin anywhere
// (T7-fix2 N4) — execution-config.e2e.test.ts only asserts what a real scan
// captures and reads back through the HTTP layer, never the four branches
// this function itself resolves between. These are unit tests, no database.

import { describe, expect, it } from 'vitest';
import type { SiteProfile } from '@prisma/client';
import { executionConfigSchema } from '@fluxradar/contracts';
import { executionProfile } from './execution-config.ts';

const LIVE_PROFILE: SiteProfile = {
  id: 'profile-1',
  accountId: 'owner',
  name: 'Live Name',
  domain: 'https://live.example',
  industry: 'Dentistry',
  region: null,
  language: null,
  businessDescription: null,
  offerings: null,
  targetLanguages: null,
  targetAudience: null,
  competitorsJson: JSON.stringify(['Live Rival']),
  scanConfigVersion: 3,
  scanConfigJson: '{}',
  createdAt: new Date('2026-01-01'),
};

function configJsonWith(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    schemaVersion: 1,
    source: 'launch',
    profileConfigVersion: 1,
    profile: { name: 'Snapshot Name', domain: 'https://snapshot.example' },
    plan: 'Complete',
    scope: { includeSubdomains: false },
    ...overrides,
  });
}

describe('executionProfile (T7-fix2 N4)', () => {
  it('reads the launch-time snapshot, not the live row edited since', () => {
    // Parsed through the schema first so the fixture is provably a valid
    // stored ExecutionConfig, the same shape captureExecutionConfig writes.
    const executionConfigJson = executionConfigSchema.parse(
      JSON.parse(configJsonWith({ competitors: ['Acme Dental', 'Bright Smile'] })),
    );
    const result = executionProfile(
      { domain: 'https://live.example', executionConfigJson: JSON.stringify(executionConfigJson) },
      LIVE_PROFILE,
    );
    expect(result.name).toBe('Snapshot Name');
    expect(result.domain).toBe('https://snapshot.example');
    expect(result.competitorsJson).toBe(JSON.stringify(['Acme Dental', 'Bright Smile']));
  });

  it('resolves to no competitors when the snapshot predates the competitors key', () => {
    // No `competitors` field at all — a config captured before T7 shipped.
    const executionConfigJson = configJsonWith({});
    const result = executionProfile(
      { domain: 'https://live.example', executionConfigJson },
      LIVE_PROFILE,
    );
    expect(result.competitorsJson).toBeNull();
    expect(result.name).toBe('Snapshot Name');
  });

  it('falls back to the scan domain and no competitors when executionConfigJson is null', () => {
    const result = executionProfile(
      { domain: 'https://fallback.example/page', executionConfigJson: null },
      LIVE_PROFILE,
    );
    expect(result.name).toBe('fallback.example');
    expect(result.domain).toBe('https://fallback.example/page');
    expect(result.competitorsJson).toBeNull();
  });

  it('resolves to no competitors for a legacy-checkout config with an empty captured list', () => {
    const executionConfigJson = JSON.stringify({
      schemaVersion: 1,
      source: 'legacy-checkout',
      profileConfigVersion: null,
      profile: { name: 'legacy.example', domain: 'https://legacy.example' },
      plan: 'Complete',
      scope: { includeSubdomains: false },
      competitors: [],
    });
    const result = executionProfile(
      { domain: 'https://legacy.example', executionConfigJson },
      LIVE_PROFILE,
    );
    expect(result.competitorsJson).toBeNull();
    expect(result.name).toBe('legacy.example');
  });
});
