import { describe, expect, it } from 'vitest';

import { ProxyConfigError } from './errors.js';
import { parseEgressProxyUrl } from './proxy.js';

describe('parseEgressProxyUrl', () => {
  it('reads host, port and credentials', () => {
    expect(parseEgressProxyUrl('http://bot:s3cret@203.0.113.10:13128')).toEqual({
      host: '203.0.113.10',
      port: 13128,
      credentials: { username: 'bot', password: 's3cret' },
    });
  });

  it('accepts a proxy that authorizes by source IP alone', () => {
    expect(parseEgressProxyUrl('http://proxy.internal:3128')).toEqual({
      host: 'proxy.internal',
      port: 3128,
      credentials: null,
    });
  });

  it('decodes percent-encoded credentials', () => {
    const proxy = parseEgressProxyUrl('http://bot:p%40ss%3Aword@203.0.113.10:13128');
    expect(proxy.credentials).toEqual({ username: 'bot', password: 'p@ss:word' });
  });

  it.each([
    ['', 'empty'],
    ['not a url', 'unparseable'],
    ['https://proxy:13128', 'https hop'],
    ['http://proxy', 'no port'],
    ['http://proxy:13128/path', 'path'],
    ['http://proxy:13128?a=b', 'query'],
    ['http://bot@proxy:13128', 'username without password'],
  ])('refuses %s (%s)', (value) => {
    expect(() => parseEgressProxyUrl(value)).toThrow(ProxyConfigError);
  });

  it('never leaks the setting, or its length, into the error message', () => {
    const secret = 'http://bot:top-secret-password@proxy:13128/path';

    try {
      parseEgressProxyUrl(secret);
      expect.unreachable('an unusable proxy URL must throw');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('top-secret-password');
      expect(message).not.toContain(String(secret.length));
    }
  });
});
