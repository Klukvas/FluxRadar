import { afterEach, describe, expect, it, vi } from 'vitest';

import { stdoutLogger, type ApiLogger } from '../http/logger.ts';
import type { ErrorReporter } from './error-reporting.ts';
import { withErrorReporting } from './reporting-logger.ts';

interface Call {
  readonly level: 'info' | 'warn' | 'error';
  readonly args: readonly unknown[];
}

function recordingLogger(): { readonly calls: Call[]; readonly logger: ApiLogger } {
  const calls: Call[] = [];
  return {
    calls,
    logger: {
      info: (...args) => calls.push({ level: 'info', args }),
      warn: (...args) => calls.push({ level: 'warn', args }),
      error: (...args) => calls.push({ level: 'error', args }),
    },
  };
}

function recordingReporter(): {
  readonly reports: (readonly unknown[])[];
  readonly reporter: ErrorReporter;
} {
  const reports: (readonly unknown[])[] = [];
  return {
    reports,
    reporter: {
      report: (...args) => {
        reports.push(args);
      },
      flush: async () => true,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withErrorReporting', () => {
  it('is the plain logger when there is nothing to report to', () => {
    const { logger } = recordingLogger();

    expect(withErrorReporting(logger, null)).toBe(logger);
  });

  it('logs every error exactly as before and files it exactly once', () => {
    const { calls, logger } = recordingLogger();
    const { reports, reporter } = recordingReporter();
    const cause = new Error('boom');

    withErrorReporting(logger, reporter).error('scan execution failed', { scanId: 's1' }, cause);

    expect(calls).toEqual([
      { level: 'error', args: ['scan execution failed', { scanId: 's1' }, cause] },
    ]);
    expect(reports).toEqual([['scan execution failed', { scanId: 's1' }, cause]]);
  });

  it('reports no info or warn line', () => {
    const { calls, logger } = recordingLogger();
    const { reports, reporter } = recordingReporter();
    const reporting = withErrorReporting(logger, reporter);

    reporting.info('http request', { status: 200 });
    reporting.warn('performance audit runs in its reduced keyless mode');

    expect(calls.map((call) => call.level)).toEqual(['info', 'warn']);
    expect(reports).toEqual([]);
  });

  it('keeps the log line when the report cannot be queued, and says so as a warning', () => {
    const { calls, logger } = recordingLogger();
    const failing: ErrorReporter = {
      report: () => {
        throw new Error('transport unavailable');
      },
      flush: async () => false,
    };

    expect(() => withErrorReporting(logger, failing).error('queue drain failed')).not.toThrow();
    expect(calls).toEqual([
      { level: 'error', args: ['queue drain failed', undefined, undefined] },
      {
        level: 'warn',
        args: [
          'error report could not be queued',
          { reportedMessage: 'queue drain failed', error: 'Error: transport unavailable' },
        ],
      },
    ]);
  });
});

// The production log is read by people and scripts; a report must not change it.
describe('stdoutLogger', () => {
  it('writes the same line whether or not it is handed the cause', () => {
    const lines: string[] = [];
    vi.useFakeTimers({ now: new Date('2026-10-23T10:00:00Z'), toFake: ['Date'] });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    stdoutLogger.error('queue drain failed', { error: 'Error: boom' });
    stdoutLogger.error('queue drain failed', { error: 'Error: boom' }, new Error('boom'));
    vi.useRealTimers();

    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(lines[0]);
    expect(lines[0]).toBe(
      '{"time":"2026-10-23T10:00:00.000Z","level":"error","message":"queue drain failed","error":"Error: boom"}\n',
    );
  });
});
