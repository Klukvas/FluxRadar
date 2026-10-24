import type { ErrorEvent } from '@sentry/react';
import { describe, expect, it } from 'vitest';

import {
  MAX_REPORTED_TEXT_LENGTH,
  scrubBreadcrumb,
  scrubBrowserEvent,
  scrubRecord,
  scrubText,
  withoutQueryAndHash,
} from './error-monitoring-scrub';

describe('withoutQueryAndHash', () => {
  it.each([
    ['https://fluxradar.net/?verify_token=abc', 'https://fluxradar.net/'],
    ['https://fluxradar.net/account#reset_token=abc', 'https://fluxradar.net/account'],
    ['/api/integrations/google/callback?code=4/0Ab&state=x', '/api/integrations/google/callback'],
    [
      'https://fluxradar.net/scans/cmh3k2x9a0001qz8l4w7v2b1c',
      'https://fluxradar.net/scans/cmh3k2x9a0001qz8l4w7v2b1c',
    ],
  ])('reduces %s to %s', (url, expected) => {
    expect(withoutQueryAndHash(url)).toBe(expected);
  });
});

describe('scrubText', () => {
  it('cuts the query off every URL in a message and removes email addresses', () => {
    expect(
      scrubText('Failed to load https://fluxradar.net/api/auth/me?token=abc for anna@example.com'),
    ).toBe('Failed to load https://fluxradar.net/api/auth/me for [email]');
  });

  // The review's probes: each of these used to leave its secret in the message.
  it.each([
    ['GET /api/auth/verify?token=abc failed', 'GET /api/auth/verify failed'],
    ['token=abc password=hunter2', 'token=[redacted] password=[redacted]'],
    ['Authorization: Bearer eyJhbGciOi…', 'Authorization: Bearer [redacted]'],
    ['HTTP 401 at /api/account?email=anna%40example.com', 'HTTP 401 at /api/account'],
  ])('scrubs %s', (text, expected) => {
    expect(scrubText(text)).toBe(expected);
  });

  // The same rules as the API's report-scrub.ts, so a message reads the same in both projects.
  it.each([
    [
      '{"email":"anna@example.com","password":"hunter2","token":"abc"}',
      '{"email":"[email]","password":"[redacted]","token":"[redacted]"}',
    ],
    ['password: hunter2 / password hunter2', 'password: [redacted] / password [redacted]'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl here', 'jwt [redacted] here'],
    ['from іван@укр.ua and anna%40example.com', 'from [email] and [email]'],
  ])('scrubs %s like the API does', (text, expected) => {
    expect(scrubText(text)).toBe(expected);
  });

  // Second review: quoted values, cookies, and the API's key shapes, opaque
  // runs and database echo, so the two scrubbers agree string for string.
  it.each([
    ["{ token: 'abc123', password: 'hunter2' }", '{ token: [redacted], password: [redacted] }'],
    ['token: "abc123"', 'token: [redacted]'],
    ['password="hunter2"', 'password=[redacted]'],
    ["password='hunter2'", 'password=[redacted]'],
    ["'password': 'hunter2'", "'password':'[redacted]'"],
    ['Set-Cookie: session=abcdefghijklmnop; Path=/', 'Set-Cookie: session=[redacted]; Path=/'],
    ['key sk-ant-api03-AbCdEf0123456789_xyz here', 'key [redacted] here'],
    ['store creem_live_abc123def456 here', 'store [redacted] here'],
    ['access_token: "ya29.a0AfH6SMBx-example"', 'access_token: [redacted]'],
    [
      'hash $2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy kept',
      'hash [redacted] kept',
    ],
    ['opaque Zx9vQ2mR7tL4pW8kN3bH6cJ1sD5fG0aE end', 'opaque [redacted] end'],
    [
      'detail: Key (owner_reference)=(acct-private-77) already exists.',
      'detail: Key (owner_reference)=([redacted]) already exists.',
    ],
  ])('scrubs %s', (text, expected) => {
    expect(scrubText(text)).toBe(expected);
  });

  // Third review: the same additions as the API's scrubber.
  it.each([
    ['private_key: abcdef', 'private_key: [redacted]'],
    ['encryption_key: abcdef', 'encryption_key: [redacted]'],
    ['{"private_key":"abc"}', '{"private_key":"[redacted]"}'],
    ['token = abc123', 'token = [redacted]'],
    // The scheme word is left for the Bearer rule, which then takes the value.
    ['authorization=Bearer abcdefgh12345678', 'authorization=Bearer [redacted]'],
  ])('redacts %s', (text, expected) => {
    expect(scrubText(text)).toBe(expected);
  });

  it('leaves an object key name readable', () => {
    const text = 'storage failed for objectKey: reports/acct/scan.json';

    expect(scrubText(text)).toBe(text);
  });

  it('keeps ids the report needs: scan cuids and UUIDs', () => {
    const text = 'scan cmh3k2x9a0001qz8l4w7v2b1c job 0f8fad5b-d9cb-469f-a165-70867728950e';

    expect(scrubText(text)).toBe(text);
  });

  it('sends at most its bound, and leaves no half of a secret at the cut', () => {
    // Keys that shrink to "[redacted]" pull what sits at the 8,000-character
    // bound inside the 2,000 that are sent; the cut there takes the whole word.
    const keys = `${'a1'.repeat(32)} `.repeat(122);
    const shrunk = scrubText(`${keys}${'x'.repeat(61)} anna@example.com`);
    const long = scrubText('word '.repeat(MAX_REPORTED_TEXT_LENGTH));

    expect(shrunk).not.toContain('anna');
    expect(long.length).toBeLessThanOrEqual(MAX_REPORTED_TEXT_LENGTH + 20);
    expect(long.endsWith('[truncated]')).toBe(true);
  });

  // It runs on the main thread inside beforeSend: a hostile message must cost
  // milliseconds. These shapes took up to 18 s at 128k before the bound.
  it('scrubs adversarial input in linear time', () => {
    const units = [
      'ab-',
      'a.',
      '=/',
      'a://',
      '"token":"',
      'x',
      'password ',
      "'a'",
      'token: ',
      'Key (',
      '%40a.',
      'a@',
    ];
    const texts = units.flatMap((unit) => {
      const long = unit.repeat(Math.ceil(128_000 / unit.length));
      return [long, `${long.slice(0, 7_998)} `];
    });
    const started = performance.now();

    for (const text of texts) scrubText(text);

    expect(performance.now() - started).toBeLessThan(200);
  });

  it('leaves an ordinary error message as it is', () => {
    const message = 'TypeError: Cannot read properties of undefined (reading "id") at /scans/abc';

    expect(scrubText(message)).toBe(message);
  });
});

describe('scrubBreadcrumb', () => {
  it('keeps a navigation, without the query on either side', () => {
    expect(
      scrubBreadcrumb({
        category: 'navigation',
        data: { from: '/?reset_token=abc', to: '/account#x' },
      }),
    ).toEqual({ category: 'navigation', data: { from: '/', to: '/account' } });
  });

  it.each(['fetch', 'xhr'])('keeps a %s call, without its query', (category) => {
    expect(
      scrubBreadcrumb({
        category,
        type: 'http',
        data: {
          method: 'GET',
          url: 'https://fluxradar.net/api/scans?cursor=abc',
          status_code: 200,
        },
      }),
    ).toEqual({
      category,
      type: 'http',
      data: { method: 'GET', url: 'https://fluxradar.net/api/scans', status_code: 200 },
    });
  });

  it.each(['console', 'ui.click', 'ui.input', 'sentry.event', undefined])(
    'drops a %s breadcrumb',
    (category) => {
      expect(scrubBreadcrumb({ category, message: 'typed anna@example.com' })).toBeNull();
    },
  );
});

describe('scrubRecord', () => {
  it('drops sensitive keys, the API’s list, and scrubs every string it keeps', () => {
    const record = Object.freeze({
      session: 'abc',
      sid: 'x',
      passphrase: 'p',
      sidebar: 'open',
      nested: Object.freeze({ apiKey: 'k', note: 'see https://x.example/?token=1' }),
    });

    expect(scrubRecord(record)).toEqual({
      session: '[redacted]',
      sid: '[redacted]',
      passphrase: '[redacted]',
      sidebar: 'open',
      nested: { apiKey: '[redacted]', note: 'see https://x.example/' },
    });
    expect(record.session).toBe('abc');
  });
});

// A third-party script or an extension that rejects with a plain object gets
// it serialized into `extra.__serialized__`, and a frameless event passes
// allowUrls — so `extra` and contexts are scrubbed like log context.
describe('scrubBrowserEvent, on extra and contexts', () => {
  const event: ErrorEvent = Object.freeze({
    type: undefined,
    extra: {
      __serialized__: {
        email: 'anna@example.com',
        token: 'abc123',
        note: 'from anna@example.com at /account?reset_token=abc',
      },
    },
    contexts: {
      trace: { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', span_id: '00f067aa0ba902b7' },
      react: { version: '19.2.8' },
      checkout: { session: 'cs_live_abc', message: 'mail anna@example.com failed' },
    },
  });

  it('scrubs the serialized rejection and every custom context, and keeps trace and versions', () => {
    const scrubbed = scrubBrowserEvent(event);

    expect(scrubbed.extra).toEqual({
      __serialized__: {
        email: '[redacted]',
        token: '[redacted]',
        note: 'from [email] at /account',
      },
    });
    expect(scrubbed.contexts?.checkout).toEqual({
      session: '[redacted]',
      message: 'mail [email] failed',
    });
    expect(scrubbed.contexts?.trace).toEqual(event.contexts?.trace);
    expect(scrubbed.contexts?.react).toEqual({ version: '19.2.8' });
    expect(JSON.stringify(scrubbed)).not.toMatch(/anna@example\.com|abc123|cs_live_abc/);
  });
});

describe('scrubBrowserEvent', () => {
  const event: ErrorEvent = Object.freeze({
    type: undefined,
    message: 'see https://fluxradar.net/?verify_token=abc',
    request: {
      url: 'https://fluxradar.net/account?reset_token=abc#top',
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://mail.example/?u=anna@example.com' },
    },
    user: { ip_address: '203.0.113.7' },
    exception: {
      values: [
        {
          type: 'TypeError',
          value: 'Failed to fetch https://fluxradar.net/api/auth/verify?token=abc',
          stacktrace: {
            frames: [{ filename: 'https://fluxradar.net/assets/index.js?v=1', lineno: 3 }],
          },
        },
      ],
    },
    breadcrumbs: [
      { category: 'console', message: 'anna@example.com' },
      { category: 'navigation', data: { from: '/', to: '/?reset_token=abc' } },
    ],
  });

  it('sends the page address without its query, and only the User-Agent header', () => {
    expect(scrubBrowserEvent(event).request).toEqual({
      url: 'https://fluxradar.net/account',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
  });

  it('scrubs the message, exception values and frame URLs, and drops the user', () => {
    const scrubbed = scrubBrowserEvent(event);

    expect(scrubbed.message).toBe('see https://fluxradar.net/');
    expect(scrubbed.exception?.values?.[0]?.value).toBe(
      'Failed to fetch https://fluxradar.net/api/auth/verify',
    );
    expect(scrubbed.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename).toBe(
      'https://fluxradar.net/assets/index.js',
    );
    expect(scrubbed).not.toHaveProperty('user');
  });

  it('keeps only the kept breadcrumbs, scrubbed', () => {
    expect(scrubBrowserEvent(event).breadcrumbs).toEqual([
      { category: 'navigation', data: { from: '/', to: '/' } },
    ]);
  });

  it('leaves no token or address anywhere, and the original untouched', () => {
    const serialized = JSON.stringify(scrubBrowserEvent(event));

    expect(serialized).not.toMatch(/token=|anna@example\.com|203\.0\.113\.7|Referer/);
    expect(event.request?.url).toBe('https://fluxradar.net/account?reset_token=abc#top');
  });
});
