import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from '@fluxradar/ai';

import { GEO_VISIBILITY_PROVIDERS } from '../orchestrator/geo.ts';

// apps/web intentionally has no workspace dependency. Read its tiny source
// declaration so a frontend/backend mismatch fails before deploy.
function webNoticeSource(): string {
  return readFileSync(
    resolve(process.cwd(), '..', 'web', 'src', 'ai-processing-notice.ts'),
    'utf8',
  );
}

describe('paid AI processing notice contract', () => {
  it('matches the disclosure version submitted by the web checkout', () => {
    const submittedVersion = /AI_PROCESSING_NOTICE_VERSION\s*=\s*'([^']+)'/.exec(
      webNoticeSource(),
    )?.[1];

    expect(submittedVersion).toBe(CURRENT_AI_PROCESSING_NOTICE_VERSION);
  });

  it('names exactly the providers the GEO module asks', () => {
    // A provider the worker asks but the notice never named would be processing
    // nobody disclosed; one the notice names but nobody asks reads as ConsentMissing.
    const declared = /AI_PROCESSING_PROVIDERS\s*=\s*\[([^\]]+)\]/.exec(webNoticeSource())?.[1];
    const submittedProviders = [...(declared ?? '').matchAll(/'([^']+)'/g)].map(
      ([, provider]) => provider,
    );

    expect(submittedProviders).toEqual([...GEO_VISIBILITY_PROVIDERS]);
  });
});
