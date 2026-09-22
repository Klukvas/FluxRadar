// Where an accepted support request goes.

import { describeError, type ApiLogger } from '../http/logger.ts';
import { formatSupportMessage, type SupportRequest } from './support-message.ts';
import { readTelegramConfig } from './telegram-config.ts';

export const TELEGRAM_TIMEOUT_MS = 10_000;
const TELEGRAM_API_ORIGIN = 'https://api.telegram.org';

export interface SupportChannel {
  /** Named in the delivery-failure log line; never a credential. */
  readonly kind: 'telegram' | 'development-log';
  /** Resolves once the channel accepted the request; rejects with a loggable reason. */
  send(request: SupportRequest): Promise<void>;
}

export class TelegramSupportChannel implements SupportChannel {
  readonly kind = 'telegram';
  private readonly botToken: string;
  private readonly chatId: string;
  private readonly fetcher: typeof fetch;

  constructor(options: {
    readonly botToken: string;
    readonly chatId: string;
    readonly fetcher?: typeof fetch;
  }) {
    this.botToken = options.botToken;
    this.chatId = options.chatId;
    this.fetcher = options.fetcher ?? fetch;
  }

  async send(request: SupportRequest): Promise<void> {
    let response: Response;
    try {
      response = await this.fetcher(`${TELEGRAM_API_ORIGIN}/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
        body: JSON.stringify({
          chat_id: this.chatId,
          text: formatSupportMessage(request),
          parse_mode: 'HTML',
          // A visitor's link must not unfurl into a preview in the channel.
          link_preview_options: { is_disabled: true },
        }),
      });
    } catch (error) {
      // Deliberately no `cause`: the caught error can quote the request URL, and
      // the URL carries the bot token. Its redacted text is all that travels on.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`Telegram request failed: ${this.redact(describeError(error))}`);
    }
    const payload = await readJson(response);
    if (!response.ok || !isAccepted(payload)) {
      const description = descriptionOf(payload);
      throw new Error(
        `Telegram refused the message with HTTP ${response.status}` +
          (description === null ? '' : `: ${this.redact(description)}`),
      );
    }
  }

  /** The bot token is part of the request URL, so it must never reach an error message. */
  private redact(value: string): string {
    return value.replaceAll(this.botToken, '[bot token]');
  }
}

/**
 * Local development and tests without a bot: the request is written to the log
 * instead, so the form can be exercised end to end without a Telegram channel.
 * Never used in production — there an unconfigured channel means no form.
 */
export class LoggingSupportChannel implements SupportChannel {
  readonly kind = 'development-log';
  private readonly logger: ApiLogger;

  constructor(logger: ApiLogger) {
    this.logger = logger;
  }

  async send(request: SupportRequest): Promise<void> {
    this.logger.info('support request received (development: not sent to Telegram)', {
      sender: request.sender.kind,
      email: request.sender.email,
      subject: request.subject,
      page: request.page,
    });
  }
}

/**
 * Telegram whenever it is configured; otherwise the development log outside
 * production, and nothing at all in production, which is what makes
 * `GET /support/status` answer `available: false` there. A half-configured pair
 * is treated as absent here and reported by name in the startup diagnostics.
 */
export function createSupportChannel(
  logger: ApiLogger,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): SupportChannel | null {
  const result = readTelegramConfig(env);
  if (result.state === 'configured')
    return new TelegramSupportChannel({ ...result.config, fetcher });
  return env.NODE_ENV === 'production' ? null : new LoggingSupportChannel(logger);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // A body that is not JSON carries nothing to report beyond the HTTP status,
    // which the caller already names.
    return null;
  }
}

function isAccepted(payload: unknown): boolean {
  return typeof payload === 'object' && payload !== null && 'ok' in payload && payload.ok === true;
}

function descriptionOf(payload: unknown): string | null {
  return typeof payload === 'object' &&
    payload !== null &&
    'description' in payload &&
    typeof payload.description === 'string'
    ? payload.description
    : null;
}
