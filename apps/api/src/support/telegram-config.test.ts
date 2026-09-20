import { describe, expect, it } from 'vitest';

import { readTelegramConfig } from './telegram-config.ts';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ';

describe('Telegram support configuration', () => {
  it('is not configured when neither variable holds a value', () => {
    expect(readTelegramConfig({})).toEqual({ state: 'not_configured' });
    expect(readTelegramConfig({ TELEGRAM_BOT_TOKEN: ' ', TELEGRAM_SUPPORT_CHAT_ID: '' })).toEqual({
      state: 'not_configured',
    });
  });

  it('accepts a private channel id and a public channel username', () => {
    expect(
      readTelegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_SUPPORT_CHAT_ID: '-1001234567890' }),
    ).toEqual({ state: 'configured', config: { botToken: TOKEN, chatId: '-1001234567890' } });
    expect(
      readTelegramConfig({
        TELEGRAM_BOT_TOKEN: TOKEN,
        TELEGRAM_SUPPORT_CHAT_ID: '@fluxradar_help',
      }),
    ).toMatchObject({ state: 'configured' });
  });

  // Half of the pair looks connected and delivers nothing.
  it('names the missing half of the pair', () => {
    expect(readTelegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN })).toMatchObject({
      state: 'invalid',
      missing: ['TELEGRAM_SUPPORT_CHAT_ID'],
    });
    expect(readTelegramConfig({ TELEGRAM_SUPPORT_CHAT_ID: '-1001234567890' })).toMatchObject({
      state: 'invalid',
      missing: ['TELEGRAM_BOT_TOKEN'],
    });
  });

  it('refuses values Telegram could not use, without repeating them', () => {
    const badToken = readTelegramConfig({
      TELEGRAM_BOT_TOKEN: 'not-a-bot-token',
      TELEGRAM_SUPPORT_CHAT_ID: '-1001234567890',
    });
    expect(badToken).toMatchObject({ state: 'invalid', missing: ['TELEGRAM_BOT_TOKEN'] });
    expect(JSON.stringify(badToken)).not.toContain('not-a-bot-token');

    const badChat = readTelegramConfig({
      TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_SUPPORT_CHAT_ID: 'https://t.me/fluxradar',
    });
    expect(badChat).toMatchObject({ state: 'invalid', missing: ['TELEGRAM_SUPPORT_CHAT_ID'] });
    expect(JSON.stringify(badChat)).not.toContain(TOKEN);
  });
});
