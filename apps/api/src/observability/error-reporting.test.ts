import * as Sentry from '@sentry/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSentryReporter,
  isTestRuntime,
  sentryOptions,
  startErrorReporting,
  type SentryCapture,
} from './error-reporting.ts';

const EU_DSN = 'https://0123456789abcdef0123456789abcdef@o4500.ingest.de.sentry.io/4500123';

describe('the test-runner guard', () => {
  it.each([
    [{ NODE_ENV: 'test' }, true],
    [{ VITEST: 'true' }, true],
    [{ NODE_ENV: 'production', VITEST: '1' }, true],
    [{ NODE_ENV: 'production' }, false],
    [{}, false],
  ])('reads %o as a test run: %s', (env, expected) => {
    expect(isTestRuntime(env)).toBe(expected);
  });

  // The API test command loads the repository .env, which may hold a live DSN.
  it.each([
    { NODE_ENV: 'test', SENTRY_DSN: EU_DSN },
    { NODE_ENV: 'production', VITEST: 'true', SENTRY_DSN: EU_DSN },
  ])('refuses to start reporting under a test runner, DSN or not (%o)', (env) => {
    expect(startErrorReporting(env)).toBeNull();
    expect(Sentry.getClient()).toBeUndefined();
  });

  it('starts nothing without a DSN', () => {
    expect(startErrorReporting({ NODE_ENV: 'production' })).toBeNull();
    expect(Sentry.getClient()).toBeUndefined();
  });
});

describe('the SDK options', () => {
  const options = sentryOptions({ dsn: EU_DSN, environment: 'production', release: '655a4aa8' });

  it('installs error capture only: no tracing, http, fetch or console instrumentation', () => {
    const names = Array.isArray(options.integrations)
      ? options.integrations.map((integration) => integration.name)
      : [];

    expect(names).toEqual([
      'EventFilters',
      'FunctionToString',
      'LinkedErrors',
      'OnUncaughtException',
      'ContextLines',
      'Context',
    ]);
    expect(options.tracesSampleRate).toBeUndefined();
    expect(options.tracesSampler).toBeUndefined();
    expect(options.profileSessionSampleRate).toBeUndefined();
    expect(options.enableOpenTelemetrySetup).toBe(false);
    expect(options.enableRuntimeChannelInjection).toBe(false);
    expect(options.traceLifecycle).toBe('static');
    expect(options.sendClientReports).toBe(false);
    expect(options.includeServerName).toBe(false);
  });

  it('collects no personal data and keeps no breadcrumbs', () => {
    expect(options.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    });
    expect(options.includeLocalVariables).toBe(false);
    expect(options.maxBreadcrumbs).toBe(0);
    expect(options.beforeBreadcrumb?.({ message: 'GET https://x.com/?key=1' })).toBeNull();
  });

  it('scrubs every event on its way out', async () => {
    const event = await options.beforeSend?.(
      { type: undefined, message: 'bounce for anna@example.com' },
      {},
    );

    expect(event?.message).toBe('bounce for [email]');
  });

  it('names the release and environment it was given', () => {
    expect(options).toMatchObject({ dsn: EU_DSN, environment: 'production', release: '655a4aa8' });
    expect(sentryOptions({ dsn: EU_DSN, environment: 'x', release: null })).not.toHaveProperty(
      'release',
    );
  });
});

describe('the reporter', () => {
  function fakeSdk(): SentryCapture & {
    readonly captureException: ReturnType<typeof vi.fn>;
    readonly captureMessage: ReturnType<typeof vi.fn>;
  } {
    return {
      captureException: vi.fn(() => 'event-id'),
      captureMessage: vi.fn(() => 'event-id'),
      flush: vi.fn(async () => true),
    };
  }

  it('files the logged error with its own stack, grouped by the log message', () => {
    const sdk = fakeSdk();
    const cause = new Error('connection reset');

    createSentryReporter(sdk).report('queue drain failed', { scanId: 's1' }, cause);

    expect(sdk.captureException).toHaveBeenCalledTimes(1);
    expect(sdk.captureException).toHaveBeenCalledWith(cause, {
      level: 'error',
      fingerprint: ['queue drain failed'],
      contexts: { api_log: { message: 'queue drain failed', scanId: 's1' } },
    });
    expect(sdk.captureMessage).not.toHaveBeenCalled();
  });

  it('files a message event when there is no Error to carry a stack', () => {
    const sdk = fakeSdk();

    createSentryReporter(sdk).report('refund dispatches need an operator', { count: 2 }, undefined);
    createSentryReporter(sdk).report('thrown string', undefined, 'not an error');

    expect(sdk.captureException).not.toHaveBeenCalled();
    expect(sdk.captureMessage).toHaveBeenNthCalledWith(1, 'refund dispatches need an operator', {
      level: 'error',
      fingerprint: ['refund dispatches need an operator'],
      contexts: { api_log: { message: 'refund dispatches need an operator', count: 2 } },
    });
    expect(sdk.captureMessage).toHaveBeenCalledTimes(2);
  });

  it('flushes through the SDK with the timeout it is given', async () => {
    const sdk = fakeSdk();

    await expect(createSentryReporter(sdk).flush(2_000)).resolves.toBe(true);
    expect(sdk.flush).toHaveBeenCalledWith(2_000);
  });
});

// Everything above checks the options; this runs them through the real SDK,
// with a transport that records instead of sending. The test-runner guard
// lives in startErrorReporting, so initialising here reaches no network.
describe('the real SDK, with these options', () => {
  interface RecordedEvent {
    readonly fingerprint?: readonly string[];
    readonly server_name?: string;
    readonly exception?: { readonly values?: readonly { readonly value?: string }[] };
    readonly contexts?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  }

  // close() disables the client but may leave it on the scope, and the guard
  // tests above assert there is none: unbind it so the order of tests is free.
  afterEach(async () => {
    await Sentry.close(0);
    Sentry.getCurrentScope().setClient(undefined);
  });

  function initRecording(): string[] {
    const bodies: string[] = [];
    const options = sentryOptions({ dsn: EU_DSN, environment: 'test', release: '655a4aa8' });
    Sentry.initWithoutDefaultIntegrations({
      ...options,
      // The crash handler registers a process-wide listener that would outlive
      // this test; its behaviour is the SDK's, and is left out here.
      integrations: (Array.isArray(options.integrations) ? options.integrations : []).filter(
        (integration) => integration.name !== 'OnUncaughtException',
      ),
      transport: (transportOptions) =>
        Sentry.createTransport(transportOptions, async (request) => {
          bodies.push(
            typeof request.body === 'string'
              ? request.body
              : new TextDecoder().decode(request.body),
          );
          return { statusCode: 200 };
        }),
    });
    return bodies;
  }

  function eventsIn(bodies: readonly string[]): RecordedEvent[] {
    return bodies.flatMap((body) => {
      const [, itemHeader, payload] = body.split('\n');
      return JSON.parse(itemHeader ?? '{}').type === 'event'
        ? [JSON.parse(payload ?? '{}') as RecordedEvent]
        : [];
    });
  }

  it('accepts the DSN, and files one scrubbed event per report', async () => {
    const bodies = initRecording();

    expect(Sentry.getClient()?.getDsn()).toBeDefined();
    createSentryReporter(Sentry).report(
      'queue drain failed',
      { scanId: 'cmh3k2x9a0001qz8l4w7v2b1c', email: 'anna@example.com', error: 'token=abc123' },
      new Error('mail to anna@example.com failed at https://x.example/?token=abc123'),
    );
    await Sentry.flush(2_000);

    const events = eventsIn(bodies);
    expect(bodies).toHaveLength(1);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.fingerprint).toEqual(['queue drain failed']);
    expect(event?.exception?.values?.at(-1)?.value).toBe(
      'mail to [email] failed at https://x.example/',
    );
    expect(event?.contexts?.api_log).toEqual({
      message: 'queue drain failed',
      scanId: 'cmh3k2x9a0001qz8l4w7v2b1c',
      email: '[redacted]',
      error: 'token=[redacted]',
    });
    expect(event).not.toHaveProperty('breadcrumbs');
    expect(event).not.toHaveProperty('request');
    expect(event).not.toHaveProperty('user');
    expect(event).not.toHaveProperty('server_name');
    // Frames carry this repository's own source lines around each call — here,
    // the literal above — and nothing else may hold the address or the token.
    const withoutSource = (bodies[0] ?? '').replace(
      /"(?:pre_|post_)?context(?:_line)?":(?:"(?:[^"\\]|\\.)*"|\[[^\]]*\])/g,
      '',
    );
    expect(withoutSource).not.toMatch(/anna@example\.com|abc123/);
  });
});
