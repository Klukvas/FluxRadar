// Support requests (Telegram) configuration.
//
// The floating support form on every page posts to a Telegram bot, which writes
// each request into the support channel. It is optional the way email is: with
// neither variable set the API boots, `GET /support/status` answers
// `available: false` and the form is simply not offered.
//
// What must not happen quietly is half of the pair. A token without a chat — or
// a chat the token cannot be shaped into a request for — looks connected from
// the outside, the customer is told their message was sent, and nothing reaches
// the channel. So this reader answers the same three states as every other
// integration, and the startup diagnostics report `invalid` by variable NAME.
// Whether the bot is actually an admin of the channel cannot be checked from
// here; the first send is where that shows up, as a logged delivery failure.

export const TELEGRAM_ENV_VARS = {
  botToken: 'TELEGRAM_BOT_TOKEN',
  chatId: 'TELEGRAM_SUPPORT_CHAT_ID',
} as const;

export interface TelegramConfig {
  readonly botToken: string;
  readonly chatId: string;
}

export type TelegramConfigResult =
  | { readonly state: 'configured'; readonly config: TelegramConfig }
  | { readonly state: 'not_configured' }
  | { readonly state: 'invalid'; readonly missing: readonly string[]; readonly reason: string };

/** A BotFather token: the bot's numeric id, a colon, and the secret part. */
const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{30,}$/;

/**
 * A numeric chat id — channels and supergroups are negative, `-100…` — or the
 * `@username` of a public channel.
 */
const CHAT_ID_PATTERN = /^(?:-?\d+|@[A-Za-z][A-Za-z0-9_]{4,31})$/;

function trimmed(value: string | undefined): string | null {
  const result = value?.trim() ?? '';
  return result === '' ? null : result;
}

export function readTelegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfigResult {
  const botToken = trimmed(env[TELEGRAM_ENV_VARS.botToken]);
  const chatId = trimmed(env[TELEGRAM_ENV_VARS.chatId]);

  if (botToken === null && chatId === null) return { state: 'not_configured' };

  if (botToken === null || chatId === null) {
    const missing = [
      ...(botToken === null ? [TELEGRAM_ENV_VARS.botToken] : []),
      ...(chatId === null ? [TELEGRAM_ENV_VARS.chatId] : []),
    ];
    return {
      state: 'invalid',
      missing,
      reason: `Support requests are partially configured; missing: ${missing.join(', ')}`,
    };
  }

  if (!BOT_TOKEN_PATTERN.test(botToken)) {
    return {
      state: 'invalid',
      missing: [TELEGRAM_ENV_VARS.botToken],
      reason: `${TELEGRAM_ENV_VARS.botToken} must be the token BotFather issued, as "123456:ABC…"`,
    };
  }
  if (!CHAT_ID_PATTERN.test(chatId)) {
    return {
      state: 'invalid',
      missing: [TELEGRAM_ENV_VARS.chatId],
      reason:
        `${TELEGRAM_ENV_VARS.chatId} must be a numeric chat id (a channel's starts with -100) ` +
        'or a public channel\'s "@username"',
    };
  }

  return { state: 'configured', config: { botToken, chatId } };
}
