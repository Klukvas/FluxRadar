// The seam between the API's log and its error reports.
//
// Every operator alert in this codebase is already a `logger.error` line, so
// the reports follow the log rather than a second set of call sites: wrapping
// the logger once, in `startServer`, turns each of them into exactly one event.
// `info` and `warn` are not reported. Tests and `createApp`'s default keep the
// plain loggers, so nothing a test logs can reach a reporter.

import { describeError, type ApiLogger } from '../http/logger.ts';
import type { ErrorReporter } from './error-reporting.ts';

/** `logger` itself when there is no reporter, so a deployment without Sentry logs exactly as before. */
export function withErrorReporting(logger: ApiLogger, reporter: ErrorReporter | null): ApiLogger {
  if (reporter === null) return logger;
  return {
    info: (message, context) => logger.info(message, context),
    warn: (message, context) => logger.warn(message, context),
    error: (message, context, cause) => {
      logger.error(message, context, cause);
      try {
        reporter.report(message, context, cause);
      } catch (error) {
        // The line above is the record that matters; a report that could not
        // be queued is worth a warning, not a second error to report.
        logger.warn('error report could not be queued', {
          reportedMessage: message,
          error: describeError(error),
        });
      }
    },
  };
}
