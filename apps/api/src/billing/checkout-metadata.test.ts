import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from '@fluxradar/ai';

describe('paid AI processing notice contract', () => {
  it('matches the disclosure version submitted by the web checkout', () => {
    // apps/web intentionally has no workspace dependency. Read its tiny source
    // declaration so a frontend/backend version mismatch fails before deploy.
    const webContract = readFileSync(
      resolve(process.cwd(), '..', 'web', 'src', 'ai-processing-notice.ts'),
      'utf8',
    );
    const submittedVersion = /AI_PROCESSING_NOTICE_VERSION\s*=\s*'([^']+)'/.exec(webContract)?.[1];

    expect(submittedVersion).toBe(CURRENT_AI_PROCESSING_NOTICE_VERSION);
  });
});
