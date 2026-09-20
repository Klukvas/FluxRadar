import { describe, expect, it, vi } from 'vitest';

import { silentLogger } from '../http/logger.ts';
import {
  LoggingSupportChannel,
  TelegramSupportChannel,
  createSupportChannel,
} from './support-channel.ts';
import { formatSupportMessage, type SupportRequest } from './support-message.ts';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ';
const CHAT_ID = '-1001234567890';

const GUEST_REQUEST: SupportRequest = {
  sender: { kind: 'guest', email: 'visitor@example.com' },
  subject: 'Report <b>empty</b>',
  message: 'Scores & issues are missing for <script>alert(1)</script>',
  page: '/reports',
  language: 'uk',
};

function telegramResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('support message', () => {
  it('escapes everything a visitor typed and labels a guest address unverified', () => {
    const text = formatSupportMessage(GUEST_REQUEST);

    expect(text).toContain('<b>Subject:</b> Report &lt;b&gt;empty&lt;/b&gt;');
    expect(text).toContain('Scores &amp; issues are missing for &lt;script&gt;');
    expect(text).not.toContain('<script>');
    expect(text).toContain('visitor@example.com — guest, address not verified');
    expect(text).toContain('<b>Page:</b> /reports');
    expect(text).toContain('<b>Language:</b> uk');
  });

  it('names the account behind a signed-in request', () => {
    const text = formatSupportMessage({
      ...GUEST_REQUEST,
      sender: { kind: 'account', accountId: 'acc_123', email: 'owner@example.com' },
      page: null,
      language: null,
    });

    expect(text).toContain('owner@example.com — signed in, account <code>acc_123</code>');
    expect(text).not.toContain('<b>Page:</b>');
    expect(text).not.toContain('<b>Language:</b>');
  });
});

describe('Telegram support channel', () => {
  it('posts the formatted message to the configured chat in HTML mode', async () => {
    const fetcher = vi.fn(async () => telegramResponse({ ok: true, result: { message_id: 1 } }));
    const channel = new TelegramSupportChannel({
      botToken: TOKEN,
      chatId: CHAT_ID,
      fetcher: fetcher as unknown as typeof fetch,
    });

    await channel.send(GUEST_REQUEST);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      chat_id: CHAT_ID,
      text: formatSupportMessage(GUEST_REQUEST),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  });

  it("rejects with Telegram's reason when the message is refused", async () => {
    const fetcher = vi.fn(async () =>
      telegramResponse(
        { ok: false, error_code: 403, description: 'Forbidden: bot is not a member' },
        403,
      ),
    );
    const channel = new TelegramSupportChannel({
      botToken: TOKEN,
      chatId: CHAT_ID,
      fetcher: fetcher as unknown as typeof fetch,
    });

    await expect(channel.send(GUEST_REQUEST)).rejects.toThrow(
      'Telegram refused the message with HTTP 403: Forbidden: bot is not a member',
    );
  });

  // The token is part of the request URL, so any error that quotes the URL would
  // carry it into the log line the route writes.
  it('never lets the bot token into an error message', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/sendMessage`);
    });
    const channel = new TelegramSupportChannel({
      botToken: TOKEN,
      chatId: CHAT_ID,
      fetcher: fetcher as unknown as typeof fetch,
    });

    const failure = await channel.send(GUEST_REQUEST).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('[bot token]');
    expect((failure as Error).message).not.toContain(TOKEN);
  });
});

describe('support channel selection', () => {
  const telegramEnv = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_SUPPORT_CHAT_ID: CHAT_ID };

  it('uses Telegram in any environment once it is configured', () => {
    expect(
      createSupportChannel(silentLogger, { ...telegramEnv, NODE_ENV: 'production' }),
    ).toBeInstanceOf(TelegramSupportChannel);
    expect(
      createSupportChannel(silentLogger, { ...telegramEnv, NODE_ENV: 'development' }),
    ).toBeInstanceOf(TelegramSupportChannel);
  });

  it('offers no channel in production without Telegram, and the log in development', () => {
    expect(createSupportChannel(silentLogger, { NODE_ENV: 'production' })).toBeNull();
    expect(
      createSupportChannel(silentLogger, { NODE_ENV: 'production', TELEGRAM_BOT_TOKEN: TOKEN }),
    ).toBeNull();
    expect(createSupportChannel(silentLogger, { NODE_ENV: 'development' })).toBeInstanceOf(
      LoggingSupportChannel,
    );
  });
});
