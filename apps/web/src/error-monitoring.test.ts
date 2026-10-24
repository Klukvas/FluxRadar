import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createRootErrorHandlers,
  errorMonitoringSettings,
  rootErrorHandlers,
  startErrorMonitoring,
  type RootErrorKind,
  type RootErrorReporter,
} from './error-monitoring';

const DSN = 'https://0123456789abcdef0123456789abcdef@o4500.ingest.de.sentry.io/4500123';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('errorMonitoringSettings', () => {
  it('reports with the DSN, release and mode a production build was given', () => {
    expect(
      errorMonitoringSettings({
        dsn: DSN,
        release: '655a4aa8',
        mode: 'production',
        isVitest: false,
      }),
    ).toEqual({ dsn: DSN, release: '655a4aa8', environment: 'production' });
  });

  it.each([undefined, '', '   '])('reports nothing without a DSN (%o)', (dsn) => {
    expect(
      errorMonitoringSettings({ dsn, release: '655a4aa8', mode: 'production', isVitest: false }),
    ).toBeNull();
  });

  it('reports nothing under Vitest, whatever the build was given', () => {
    expect(
      errorMonitoringSettings({ dsn: DSN, release: undefined, mode: 'production', isVitest: true }),
    ).toBeNull();
    expect(
      errorMonitoringSettings({ dsn: DSN, release: undefined, mode: 'test', isVitest: false }),
    ).toBeNull();
  });

  it('leaves the release empty when the build had none', () => {
    expect(
      errorMonitoringSettings({ dsn: DSN, release: ' ', mode: 'production', isVitest: false }),
    ).toEqual({ dsn: DSN, release: null, environment: 'production' });
  });
});

// The policy names the EU region and the production CSP admits nothing else:
// another region's DSN would be blocked silently, so it is refused aloud.
describe('the region a DSN may point at', () => {
  // The same refusals as the API's sentry-config.ts (sentry-dsn.ts); each one
  // turns monitoring off with exactly one warning that names the problem.
  it.each([
    ['https://0123456789abcdef0123456789abcdef@o4500.ingest.us.sentry.io/4500123', 'EU (Germany)'],
    [
      'https://0123456789abcdef0123456789abcdef@o4500.ingest.sentry.io/4500123',
      'ingest.de.sentry.io',
    ],
    [
      'https://0123456789abcdef0123456789abcdef@o4500.ingest.de.sentry.io.example.com/4500123',
      'EU (Germany)',
    ],
    ['http://0123456789abcdef0123456789abcdef@o4500.ingest.de.sentry.io/4500123', 'https://'],
    ['https://public-key@o4500.ingest.de.sentry.io/4500123', 'letters, digits and underscores'],
    ['https://0123456789abcdef0123456789abcdef@o4500.ingest.de.sentry.io/', 'numeric project id'],
    ['not a url', 'not a URL'],
  ])('refuses %s with one warning', (dsn, problem) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(
      errorMonitoringSettings({ dsn, release: undefined, mode: 'production', isVitest: false }),
    ).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(problem);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('0123456789abcdef0123456789abcdef');
  });

  // How a developer looks at what would be sent: a fake ingest on this machine.
  it('accepts a loopback ingest outside production builds only', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const local = 'http://0123456789abcdef0123456789abcdef@127.0.0.1:9912/2';

    expect(
      errorMonitoringSettings({ dsn: local, release: undefined, mode: 'proof', isVitest: false }),
    ).toEqual({ dsn: local, release: null, environment: 'proof' });
    expect(
      errorMonitoringSettings({
        dsn: local,
        release: undefined,
        mode: 'production',
        isVitest: false,
      }),
    ).toBeNull();
  });
});

describe('the root error handlers', () => {
  function recordingReporter(): {
    readonly reports: (readonly [RootErrorKind, unknown, unknown])[];
    readonly reporter: RootErrorReporter;
  } {
    const reports: (readonly [RootErrorKind, unknown, unknown])[] = [];
    return {
      reports,
      reporter: { reportRootError: (kind, error, info) => reports.push([kind, error, info]) },
    };
  }

  it('reports each root hook under its own kind and still writes it to the console', async () => {
    const { reports, reporter } = recordingReporter();
    const written: unknown[][] = [];
    const handlers = createRootErrorHandlers(
      () => Promise.resolve(reporter),
      (...args) => written.push(args),
    );
    const uncaught = new Error('uncaught');
    const caught = new Error('caught');
    const recoverable = new Error('recoverable');

    handlers.onUncaughtError?.(uncaught, { componentStack: '\n    at App' });
    handlers.onCaughtError?.(caught, { componentStack: '\n    at App' });
    handlers.onRecoverableError?.(recoverable, { componentStack: '\n    at App' });
    await Promise.resolve();
    await Promise.resolve();

    // As React's own default does: the error, then the component stack.
    expect(written).toEqual([
      [uncaught, '\n    at App'],
      [caught, '\n    at App'],
      [recoverable, '\n    at App'],
    ]);
    expect(reports.map(([kind, error]) => [kind, error])).toEqual([
      ['uncaught', uncaught],
      ['caught', caught],
      ['recoverable', recoverable],
    ]);
    expect(reports[0]?.[2]).toEqual({ componentStack: '\n    at App' });
  });

  // An error during hydration happens before the SDK chunk has arrived.
  it('holds an error raised before the SDK has loaded, and files it once it has', async () => {
    const { reports, reporter } = recordingReporter();
    let loaded: (value: RootErrorReporter) => void = () => undefined;
    const pending = new Promise<RootErrorReporter>((resolve) => {
      loaded = resolve;
    });
    const handlers = createRootErrorHandlers(
      () => pending,
      () => undefined,
    );

    handlers.onRecoverableError?.(new Error('hydration'), {});
    expect(reports).toEqual([]);
    loaded(reporter);
    await pending;
    await Promise.resolve();

    expect(reports.map(([kind]) => kind)).toEqual(['recoverable']);
  });

  it('only writes to the console when the SDK could not start', async () => {
    const written: unknown[] = [];
    const handlers = createRootErrorHandlers(
      () => Promise.resolve(null),
      (error) => written.push(error),
    );

    expect(() => handlers.onUncaughtError?.(new Error('x'), {})).not.toThrow();
    await Promise.resolve();
    expect(written).toHaveLength(1);
  });
});

describe('the default console write', () => {
  it('prints the component stack beside the error, and the error alone when there is none', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handlers = createRootErrorHandlers(() => Promise.resolve(null));
    const thrown = new Error('render failed');

    handlers.onCaughtError?.(thrown, { componentStack: '\n    at App' });
    handlers.onUncaughtError?.(thrown, {});
    await Promise.resolve();

    expect(error.mock.calls).toEqual([[thrown, '\n    at App'], [thrown]]);
  });
});

// This run is a Vitest run, so the module itself must be inert.
describe('in this test run', () => {
  it('keeps React’s own root error handling and loads nothing', () => {
    startErrorMonitoring();

    expect(rootErrorHandlers()).toEqual({});
  });
});
