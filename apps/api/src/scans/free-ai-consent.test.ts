import {
  ACCEPTED_AI_PROCESSING_NOTICE_VERSIONS,
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
} from '@fluxradar/ai';
import { describe, expect, it } from 'vitest';

import { freeAiConsentSchema } from './free-ai-consent.ts';

// The Free record (D-236) authorises one recipient under the notice this
// release shows, and nothing a client could widen it to.

const OLDER_NOTICE = ACCEPTED_AI_PROCESSING_NOTICE_VERSIONS.find(
  (version) => version !== CURRENT_AI_PROCESSING_NOTICE_VERSION,
);

describe('freeAiConsentSchema', () => {
  it('accepts exactly Anthropic under the current notice', () => {
    const exact = { providers: ['anthropic'], noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION };
    expect(freeAiConsentSchema.parse(exact)).toEqual(exact);
  });

  it.each([
    ['a second provider', { providers: ['anthropic', 'openai'] }],
    ['another provider alone', { providers: ['openai'] }],
    ['no provider', { providers: [] }],
    ['an older accepted notice', { noticeVersion: OLDER_NOTICE }],
    ['an unknown notice', { noticeVersion: 'core-ai-processing-notice-v99' }],
    ['an extra key', { extra: true }],
  ])('refuses %s', (_label, change) => {
    const candidate = {
      providers: ['anthropic'],
      noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
      ...change,
    };
    expect(freeAiConsentSchema.safeParse(candidate).success).toBe(false);
  });

  it('has an older accepted notice to refuse', () => {
    expect(OLDER_NOTICE).toBeDefined();
  });
});
