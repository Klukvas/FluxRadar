// Credential-shaped values for tests, written so that nobody has to wonder
// whether they are real.
//
// A token copied out of a vendor's documentation is indistinguishable from a
// live one at a glance, and this repository is public. The Telegram fixture
// below used to be the example string from the Bot API docs, and it was read as
// the project's own bot token — which is exactly the reading a public repo
// should never require a second opinion on.
//
// Shape still has to be right: `readTelegramConfig` rejects anything that is not
// `<digits>:<30 or more of [A-Za-z0-9_-]>`, so these stay valid-looking while
// saying out loud what they are.

/** Passes `BOT_TOKEN_PATTERN` in `support/telegram-config.ts`, and nothing else. */
export const FAKE_TELEGRAM_BOT_TOKEN = '000000000:NOT-A-REAL-TOKEN-THIS-IS-A-TEST-FIXTURE';
