import { describe, expect, it, vi } from 'vitest';

import {
  MAX_SCANNED_TEXT_LENGTH,
  scrubBreadcrumb,
  scrubBrowserEvent,
} from './error-monitoring-scrub';
import { BREADCRUMB_SOURCES, createRootReporter, sentryOptions } from './error-monitoring-sentry';

const SETTINGS = {
  dsn: 'https://0123456789abcdef0123456789abcdef@o4500.ingest.de.sentry.io/4500123',
  release: '655a4aa8',
  environment: 'production',
} as const;
const ORIGIN = 'https://fluxradar.net';

// The options are the whole promise the privacy policy makes about the
// browser: pinned here, the way the API's error-reporting.test.ts pins its own.
describe('the browser SDK options', () => {
  const options = sentryOptions(SETTINGS, ORIGIN);

  it('installs error capture only, from an explicit list', () => {
    const names = Array.isArray(options.integrations)
      ? options.integrations.map((integration) => integration.name)
      : [];

    expect(options.defaultIntegrations).toBe(false);
    expect(names).toEqual([
      'EventFilters',
      'FunctionToString',
      'Breadcrumbs',
      'GlobalHandlers',
      'LinkedErrors',
      'Dedupe',
      'HttpContext',
    ]);
    // Session tracking sends a request on every page load; the rest are not errors.
    for (const absent of [/Session/i, /Tracing/i, /Replay/i, /Console/i, /Feedback/i]) {
      expect(
        names.some((name) => absent.test(name)),
        String(absent),
      ).toBe(false);
    }
    expect(options.tracesSampleRate).toBeUndefined();
    expect(options.sendClientReports).toBe(false);
    expect(options.enhanceFetchErrorMessages).toBe(false);
    // v11 has no default; values longer than what the scrubber reads are cut first.
    expect(options.maxValueLength).toBe(MAX_SCANNED_TEXT_LENGTH);
  });

  it('keeps navigation and request breadcrumbs, never DOM or SDK ones', () => {
    expect(BREADCRUMB_SOURCES).toEqual({
      dom: false,
      sentry: false,
      history: true,
      fetch: true,
      xhr: true,
    });
  });

  it('reports only errors from this site’s own scripts', () => {
    const [allowed] = options.allowUrls ?? [];

    expect(allowed).toBeInstanceOf(RegExp);
    expect((allowed as RegExp).test('https://fluxradar.net/assets/index-abc.js')).toBe(true);
    expect((allowed as RegExp).test('chrome-extension://abcdefgh/content.js')).toBe(false);
    expect((allowed as RegExp).test('https://fluxradar.net.evil.example/x.js')).toBe(false);
  });

  it('collects no personal data beyond the User-Agent', () => {
    expect(options.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });

  it('scrubs every event and breadcrumb on its way out', () => {
    expect(options.beforeSend).toBe(scrubBrowserEvent);
    expect(options.beforeBreadcrumb).toBe(scrubBreadcrumb);
  });

  it('names the DSN, release and environment it was given', () => {
    expect(options).toMatchObject(SETTINGS);
    expect(sentryOptions({ ...SETTINGS, release: null }, ORIGIN)).not.toHaveProperty('release');
  });
});

describe('createRootReporter', () => {
  it('files an uncaught root error as unhandled and the other two as handled', () => {
    const unhandled = vi.fn();
    const handled = vi.fn();
    const reporter = createRootReporter({ unhandled, handled });
    const info = { componentStack: '\n    at App' };

    reporter.reportRootError('uncaught', 'u', info);
    reporter.reportRootError('caught', 'c', info);
    reporter.reportRootError('recoverable', 'r', info);

    expect(unhandled.mock.calls).toEqual([['u', info]]);
    expect(handled.mock.calls).toEqual([
      ['c', info],
      ['r', info],
    ]);
  });
});
