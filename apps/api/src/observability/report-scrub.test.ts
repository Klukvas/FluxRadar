import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';

import {
  MAX_REPORTED_TEXT_LENGTH,
  scrubEvent,
  scrubRecord,
  scrubText,
  scrubValue,
} from './report-scrub.ts';

const SCAN_ID = 'cmh3k2x9a0001qz8l4w7v2b1c';
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('scrubText', () => {
  it('removes email addresses', () => {
    expect(scrubText('no account for anna.k+test@example.co.uk, retry')).toBe(
      'no account for [email], retry',
    );
  });

  // PageSpeed puts its API key in the query string; verification, reset and
  // OAuth return links put their one-time tokens there.
  it('keeps a URL’s origin and path and drops its query and fragment', () => {
    expect(
      scrubText(
        'GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Fx.com&key=AIzaSyA-1234567890abcdefghijklmnopqrstu failed',
      ),
    ).toBe('GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed failed');
    expect(scrubText('see https://fluxradar.net/reset?reset_token=abc#done')).toBe(
      'see https://fluxradar.net/reset',
    );
  });

  it('drops credentials embedded in a URL', () => {
    const text = scrubText('connect ECONNREFUSED http://proxyuser:hunter2@173.242.53.147:13128/');

    expect(text).toBe('connect ECONNREFUSED http://173.242.53.147:13128/');
  });

  it('drops the query of a relative path too', () => {
    expect(scrubText('GET /integrations/google/callback?code=4/0Ab_x&state=s1 failed')).toBe(
      'GET /integrations/google/callback failed',
    );
  });

  it('redacts credential parameters and authorization values outside a URL', () => {
    expect(scrubText('body had token=abc123 and password=hunter2;')).toBe(
      'body had token=[redacted] and password=[redacted];',
    );
    expect(scrubText('sent Authorization: Bearer abcdef0123456789')).toBe(
      'sent Authorization: Bearer [redacted]',
    );
  });

  // Probes from the review: each of these used to leave the value in place.
  it.each([
    [
      '{"email":"anna@example.com","password":"hunter2","token":"abc"}',
      '{"email":"[email]","password":"[redacted]","token":"[redacted]"}',
    ],
    ['{"accessToken": 12345, "apiKey":"k"}', '{"accessToken":"[redacted]", "apiKey":"[redacted]"}'],
    ['password: hunter2', 'password: [redacted]'],
    ['password hunter2', 'password [redacted]'],
    ['example.com/?email=anna%40example.com', 'example.com/?email=[redacted]'],
    [
      'reset_token=abc and ANTHROPIC_API_KEY=sk-x',
      'reset_token=[redacted] and ANTHROPIC_API_KEY=[redacted]',
    ],
    ['Authorization: Bearer eyJhbGciOi…', 'Authorization: Bearer [redacted]'],
  ])('redacts the credential in %s', (text, expected) => {
    expect(scrubText(text)).toBe(expected);
  });

  // Second review: values in quotes, the way util.inspect, JSON and shells write them.
  it.each([
    ["{ token: 'abc123', password: 'hunter2' }", '{ token: [redacted], password: [redacted] }'],
    ['token: "abc123"', 'token: [redacted]'],
    ['password="hunter2"', 'password=[redacted]'],
    ["password='hunter2'", 'password=[redacted]'],
    ["'password': 'hunter2'", "'password':'[redacted]'"],
    ['Set-Cookie: session=abcdefghijklmnop; Path=/', 'Set-Cookie: session=[redacted]; Path=/'],
    ['sid=abcdef0123 cookie=xyz', 'sid=[redacted] cookie=[redacted]'],
    [
      'hash $2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy kept',
      'hash [redacted] kept',
    ],
  ])('redacts the quoted or cookie value in %s', (text, expected) => {
    expect(scrubText(text)).toBe(expected);
  });

  // Third review: key-named secrets in the `k: v` and JSON forms, and `=` with spaces.
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

  // A bare `key` is not a credential word in these forms.
  it('leaves an object key name readable', () => {
    const text = 'report storage putText failed for objectKey: reports/acct/scan.json';

    expect(scrubText(text)).toBe(text);
  });

  // Every quantifier is bounded and the input is cut to 8,000 characters first,
  // so a hostile string costs milliseconds, not seconds.
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
      return [long, long.slice(0, 7_999)];
    });
    const started = performance.now();

    for (const text of texts) scrubText(text);

    expect(performance.now() - started).toBeLessThan(200);
  });

  it.each([
    ['bounce from іван@укр.ua', 'bounce from [email]'],
    ['to іван.петренко@приклад.укр now', 'to [email] now'],
    ['sent to anna%40example.com', 'sent to [email]'],
  ])('removes an address in any script or URL-encoded: %s', (text, expected) => {
    expect(scrubText(text)).toBe(expected);
  });

  // The words alone are not credentials; error names and variable names stay readable.
  it.each([
    'TokenExpiredError: jwt expired',
    'CREEM_WEBHOOK_SECRET is set but unusable',
    'Argument `resetToken`: Invalid value provided',
  ])('leaves %s as it is', (text) => {
    expect(scrubText(text)).toBe(text);
  });

  it.each([
    'sk-ant-api03-AbCdEf0123456789_xyz',
    'sk-proj-AbCdEf0123456789abcd',
    'AIzaSyA-1234567890abcdefghijklmnopqrstu',
    'ya29.a0AfH6SMBx-example',
    '1//0gExampleRefreshToken_abcdef',
    're_123456789_abcdefghijk',
    'creem_live_abc123def456',
    'pplx-abcdef0123456789',
    '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl',
    'Zx9vQ2mR7tL4pW8kN3bH6cJ1sD5fG0aE',
  ])('redacts the credential %s', (secret) => {
    expect(scrubText(`failed with ${secret} attached`)).toBe('failed with [redacted] attached');
  });

  it('keeps the internal ids and paths an operator needs', () => {
    const text = `scan ${SCAN_ID} job ${UUID} at /app/apps/api/dist/orchestrator/worker.js:303`;

    expect(scrubText(text)).toBe(text);
  });

  // Prisma prints the call's arguments — values included — above its reason.
  it('withholds the Prisma call site and keeps the reason', () => {
    const prismaMessage = [
      'PrismaClientValidationError: ',
      'Invalid `prisma.account.update()` invocation in',
      '/app/apps/api/dist/auth/routes.js:120:31',
      '',
      '→ 120 await prisma.account.update({',
      '         where: { email: "anna@example.com" },',
      '         data: { resetToken: "secret-reset-token-value" }',
      '       })',
      '',
      'Unknown argument `resetToken`. Available options are marked with ?.',
    ].join('\n');

    const text = scrubText(prismaMessage);

    expect(text).toBe(
      'PrismaClientValidationError: Prisma call failed (call site withheld): Unknown argument `resetToken`. Available options are marked with ?.',
    );
  });

  it('withholds the value PostgreSQL echoes for a unique violation', () => {
    expect(scrubText('detail: Key (owner_reference)=(acct-private-77) already exists.')).toBe(
      'detail: Key (owner_reference)=([redacted]) already exists.',
    );
  });

  // Both forms V8 writes; the second is what body-parser surfaced for a
  // form-encoded login body sent as JSON.
  it.each([
    'SyntaxError: Unexpected token \'m\', "my note to support" is not valid JSON',
    'SyntaxError: Unexpected token \'m\', "my note to s"... is not valid JSON',
  ])('withholds the slice of a request body JSON.parse quotes: %s', (message) => {
    expect(scrubText(message)).toBe(
      "SyntaxError: Unexpected token 'm', [input withheld] is not valid JSON",
    );
  });

  // A string far past what the rules read is cut at a word boundary first, so
  // a secret straddling the cut cannot survive as an unmatched half.
  it('bounds what the rules read, without leaving half a secret at the edge', () => {
    // Keys that shrink to "[redacted]" pull what sits at the 8,000-character
    // bound inside the 2,000 that are sent; the bound cuts the address there to
    // "anna@exa", a fragment no rule recognises, so it has to take the whole word.
    const keys = `${'a1'.repeat(32)} `.repeat(122);
    const text = scrubText(`${keys}${'x'.repeat(61)} anna@example.com`);

    expect(text).not.toContain('anna');
    expect(text.length).toBeLessThan(MAX_REPORTED_TEXT_LENGTH);
  });

  it('truncates what no message of this API needs', () => {
    const text = scrubText('word '.repeat(MAX_REPORTED_TEXT_LENGTH));

    expect(text.length).toBeLessThanOrEqual(MAX_REPORTED_TEXT_LENGTH + 20);
    expect(text.endsWith('[truncated]')).toBe(true);
  });
});

describe('scrubRecord', () => {
  it('rebuilds the context: strings scrubbed, sensitive keys dropped, the input untouched', () => {
    const context = Object.freeze({
      scanId: SCAN_ID,
      error: 'Error: no account for anna@example.com',
      password: 'hunter2',
      apiKey: 'plain',
      email: 'anna@example.com',
      nested: Object.freeze({ accessToken: 'x', url: 'https://x.com/a?b=c' }),
      list: Object.freeze(['https://x.com/?token=1', 3]),
      when: new Date('2026-10-23T10:00:00Z'),
      cause: new Error('mail to anna@example.com bounced'),
    });

    expect(scrubRecord(context)).toEqual({
      scanId: SCAN_ID,
      error: 'Error: no account for [email]',
      password: '[redacted]',
      apiKey: '[redacted]',
      email: '[redacted]',
      nested: { accessToken: '[redacted]', url: 'https://x.com/a' },
      list: ['https://x.com/', 3],
      when: '2026-10-23T10:00:00.000Z',
      cause: 'Error: mail to [email] bounced',
    });
    expect(context.password).toBe('hunter2');
  });

  it('drops session ids and passphrases by key, but not a key that merely contains "sid"', () => {
    expect(scrubRecord({ session: 'abc', sid: 'x', passphrase: 'p', sidebar: 'open' })).toEqual({
      session: '[redacted]',
      sid: '[redacted]',
      passphrase: '[redacted]',
      sidebar: 'open',
    });
  });

  // The billing error code and the sender kind are not secrets; only the
  // names that mean one are.
  it('keeps keys that only resemble a credential', () => {
    expect(scrubRecord({ code: 'BILLING_UNAVAILABLE', sender: 'account' })).toEqual({
      code: 'BILLING_UNAVAILABLE',
      sender: 'account',
    });
  });

  it('stops at a depth no log context reaches', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 'x' } } } } } } };

    expect(JSON.stringify(scrubValue(deep))).toContain('[too deep]');
  });
});

describe('scrubEvent', () => {
  const event: ErrorEvent = Object.freeze({
    type: undefined,
    message: 'retention sweep failed for anna@example.com',
    exception: {
      values: [
        {
          type: 'Error',
          value: 'fetch https://api.creem.io/v1/checkouts?email=anna@example.com failed',
          stacktrace: {
            frames: [
              {
                filename: '/app/apps/api/dist/billing/creem/client.js',
                lineno: 12,
                context_line: '  const response = await fetch(url);',
                vars: { email: 'anna@example.com' },
              },
            ],
          },
        },
        { type: 'TypeError', value: 'cause: token=abc123' },
      ],
    },
    breadcrumbs: [{ message: 'GET https://x.com/?key=1' }],
    request: { url: 'https://fluxradar.net/api/auth/login?x=1', cookies: { a: 'b' } },
    user: { email: 'anna@example.com', ip_address: '203.0.113.7' },
    contexts: {
      api_log: { message: 'retention sweep failed', error: 'Error: anna@example.com' },
      trace: { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', span_id: '00f067aa0ba902b7' },
    },
    extra: { password: 'hunter2' },
    tags: { route: '/reset?token=1' },
  });

  it('scrubs the message, every exception value and the attached context', () => {
    const scrubbed = scrubEvent(event);

    expect(scrubbed.message).toBe('retention sweep failed for [email]');
    expect(scrubbed.exception?.values?.map((value) => value.value)).toEqual([
      'fetch https://api.creem.io/v1/checkouts failed',
      'cause: token=[redacted]',
    ]);
    expect(scrubbed.contexts?.api_log).toEqual({
      message: 'retention sweep failed',
      error: 'Error: [email]',
    });
    expect(scrubbed.extra).toEqual({ password: '[redacted]' });
    expect(scrubbed.tags).toEqual({ route: '/reset' });
  });

  it('keeps frames and their source lines, and drops their local variables', () => {
    const frame = scrubEvent(event).exception?.values?.[0]?.stacktrace?.frames?.[0];

    expect(frame).toEqual({
      filename: '/app/apps/api/dist/billing/creem/client.js',
      lineno: 12,
      context_line: '  const response = await fetch(url);',
    });
  });

  it('drops breadcrumbs, request and user data outright, and leaves trace ids readable', () => {
    const scrubbed = scrubEvent(event);

    expect(scrubbed).not.toHaveProperty('breadcrumbs');
    expect(scrubbed).not.toHaveProperty('request');
    expect(scrubbed).not.toHaveProperty('user');
    expect(scrubbed.contexts?.trace).toEqual(event.contexts?.trace);
    expect(JSON.stringify(scrubbed)).not.toContain('anna@example.com');
    expect(JSON.stringify(scrubbed)).not.toContain('hunter2');
  });

  it('leaves the event it was given as it was', () => {
    scrubEvent(event);

    expect(event.message).toBe('retention sweep failed for anna@example.com');
    expect(event.breadcrumbs).toHaveLength(1);
  });
});
