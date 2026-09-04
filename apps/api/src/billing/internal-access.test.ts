import { describe, expect, it } from 'vitest';

import { getInternalFreeEmails, isInternalFreeEmail } from './internal-access.ts';

describe('internal free access', () => {
  it('parses and normalizes an exact comma-separated email allowlist', () => {
    const allowlist = getInternalFreeEmails({
      FLUXRADAR_INTERNAL_FREE_EMAILS: ' Test@Example.com,second@example.com , ',
    });

    expect(isInternalFreeEmail('test@example.com', allowlist)).toBe(true);
    expect(isInternalFreeEmail('SECOND@EXAMPLE.COM', allowlist)).toBe(true);
    expect(isInternalFreeEmail('third@example.com', allowlist)).toBe(false);
  });

  it('fails closed when the environment variable is absent', () => {
    const allowlist = getInternalFreeEmails({});

    expect(allowlist.size).toBe(0);
    expect(isInternalFreeEmail('pavlenkoandrey56@gmail.com', allowlist)).toBe(false);
  });
});
