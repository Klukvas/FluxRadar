import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { CURRENT_AI_PROCESSING_NOTICE_VERSION, OPT_IN_VISIBILITY_PROVIDERS } from '@fluxradar/ai';

import { GEO_VISIBILITY_PROVIDERS } from '../orchestrator/geo.ts';

// apps/web intentionally has no workspace dependency. Read its tiny source
// declaration so a frontend/backend mismatch fails before deploy.
function webNotice(): string {
  return readFileSync(
    resolve(process.cwd(), '..', 'web', 'src', 'ai-processing-notice.ts'),
    'utf8',
  );
}

function providerListIn(source: string, constant: string): readonly string[] {
  const literal = new RegExp(`${constant}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source)?.[1] ?? '';
  return [...literal.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
}

describe('paid AI processing notice contract', () => {
  it('matches the disclosure version submitted by the web checkout', () => {
    const submittedVersion = /AI_PROCESSING_NOTICE_VERSION\s*=\s*'([^']+)'/.exec(webNotice())?.[1];

    expect(submittedVersion).toBe(CURRENT_AI_PROCESSING_NOTICE_VERSION);
  });

  it('matches the default provider list the worker will ask', () => {
    // The notice names the recipients; the worker asks them. A list that drifted
    // would send a customer's site context to a provider they were not told about.
    expect(providerListIn(webNotice(), 'AI_PROCESSING_PROVIDERS')).toEqual([
      ...GEO_VISIBILITY_PROVIDERS,
    ]);
  });

  it('matches the opt-in provider list the notice offers', () => {
    expect(providerListIn(webNotice(), 'AI_PROCESSING_OPT_IN_PROVIDERS')).toEqual([
      ...OPT_IN_VISIBILITY_PROVIDERS,
    ]);
  });

  it('keeps the opt-in providers out of the default list', () => {
    for (const provider of OPT_IN_VISIBILITY_PROVIDERS) {
      expect(GEO_VISIBILITY_PROVIDERS).not.toContain(provider);
    }
  });
});
