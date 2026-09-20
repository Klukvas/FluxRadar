import type { PrismaClient } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { RequestRateLimiter, SUPPORT_REQUEST_LIMIT } from '../auth/rate-limit.ts';
import { SESSION_COOKIE_NAME } from '../auth/sessions.ts';
import { errorHandler } from '../http/error-handler.ts';
import { silentLogger, type ApiLogger } from '../http/logger.ts';
import { supportRouter } from './routes.ts';
import type { SupportChannel } from './support-channel.ts';
import type { SupportRequest } from './support-message.ts';

const NOW = new Date('2026-09-15T12:00:00Z');
const ACCOUNT = { id: 'account-support', email: 'owner@example.com' };
const VALID_BODY = {
  subject: '  Report is empty  ',
  message: 'The Basic report for example.com shows no issues at all.',
};

type RecordingChannel = SupportChannel & { readonly sent: SupportRequest[] };

function recordingChannel(failure?: Error): RecordingChannel {
  const sent: SupportRequest[] = [];
  return {
    kind: 'telegram',
    sent,
    async send(supportRequest) {
      if (failure !== undefined) throw failure;
      sent.push(supportRequest);
    },
  };
}

/** A session lookup that finds ACCOUNT for any cookie, or nothing at all. */
function stubPrisma(hasLiveSession: boolean): PrismaClient {
  return {
    session: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          hasLiveSession
            ? { accountId: ACCOUNT.id, expiresAt: new Date(NOW.getTime() + 60_000) }
            : null,
        ),
    },
    account: { findUnique: vi.fn().mockResolvedValue({ email: ACCOUNT.email }) },
  } as unknown as PrismaClient;
}

function appFor(options: {
  readonly channel: SupportChannel | null;
  readonly hasLiveSession?: boolean;
  readonly logger?: ApiLogger;
}): express.Express {
  const app = express();
  app.use(express.json());
  app.use(
    supportRouter({
      prisma: stubPrisma(options.hasLiveSession ?? false),
      now: () => NOW,
      channel: options.channel,
      requestRateLimiter: new RequestRateLimiter(() => NOW.getTime()),
      logger: options.logger ?? silentLogger,
    }),
  );
  app.use(errorHandler(silentLogger));
  return app;
}

describe('support requests over HTTP', () => {
  it('reports whether a request would reach anyone', async () => {
    const available = await request(appFor({ channel: recordingChannel() })).get('/support/status');
    const unavailable = await request(appFor({ channel: null })).get('/support/status');

    expect(available.body).toEqual({ success: true, data: { available: true }, error: null });
    expect(unavailable.body).toEqual({ success: true, data: { available: false }, error: null });
  });

  it('refuses a request by code when this deployment has no support channel', async () => {
    const response = await request(appFor({ channel: null }))
      .post('/support')
      .send({ ...VALID_BODY, email: 'visitor@example.com' });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SUPPORT_UNAVAILABLE');
  });

  it('asks a guest for the address to reply to', async () => {
    const channel = recordingChannel();

    const response = await request(appFor({ channel })).post('/support').send(VALID_BODY);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('SUPPORT_EMAIL_REQUIRED');
    expect(channel.sent).toHaveLength(0);
  });

  it("delivers a guest's request with the typed address and the page path alone", async () => {
    const channel = recordingChannel();

    const response = await request(appFor({ channel }))
      .post('/support')
      .send({
        ...VALID_BODY,
        email: 'visitor@example.com',
        page: '/reset-password?token=one-time-secret',
        language: 'uk',
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ status: 'sent' });
    expect(channel.sent).toEqual([
      {
        sender: { kind: 'guest', email: 'visitor@example.com' },
        subject: 'Report is empty',
        message: VALID_BODY.message,
        page: '/reset-password',
        language: 'uk',
      },
    ]);
  });

  // Anyone can type any address; a session is what proves one.
  it("uses the signed-in account's own address, whatever the form says", async () => {
    const channel = recordingChannel();

    const response = await request(appFor({ channel, hasLiveSession: true }))
      .post('/support')
      .set('Cookie', `${SESSION_COOKIE_NAME}=session-token`)
      .send({ ...VALID_BODY, email: 'someone-else@example.com' });

    expect(response.status).toBe(200);
    expect(channel.sent[0]?.sender).toEqual({
      kind: 'account',
      accountId: ACCOUNT.id,
      email: ACCOUNT.email,
    });
  });

  it('rejects a subject or message too short to act on', async () => {
    const channel = recordingChannel();

    const response = await request(appFor({ channel }))
      .post('/support')
      .send({ subject: 'hi', message: 'short', email: 'visitor@example.com' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION');
    expect(channel.sent).toHaveLength(0);
  });

  it('answers a failed delivery neutrally and keeps the reason for the log', async () => {
    const errors: Readonly<Record<string, unknown>>[] = [];
    const logger: ApiLogger = {
      ...silentLogger,
      error: (_message, context) => {
        errors.push(context ?? {});
      },
    };
    const channel = recordingChannel(new Error('Telegram refused the message with HTTP 403'));

    const response = await request(appFor({ channel, logger }))
      .post('/support')
      .send({ ...VALID_BODY, email: 'visitor@example.com' });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('SUPPORT_DELIVERY_FAILED');
    expect(JSON.stringify(response.body)).not.toContain('Telegram');
    expect(errors).toEqual([
      {
        channel: 'telegram',
        sender: 'guest',
        error: 'Telegram refused the message with HTTP 403',
      },
    ]);
  });

  it('limits repeated requests from one reply address', async () => {
    const channel = recordingChannel();
    const app = appFor({ channel });

    const statuses: number[] = [];
    for (let attempt = 0; attempt <= SUPPORT_REQUEST_LIMIT; attempt += 1) {
      const response = await request(app)
        .post('/support')
        .send({
          ...VALID_BODY,
          email: attempt % 2 === 0 ? 'Visitor@example.com' : 'visitor@example.com',
        });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, SUPPORT_REQUEST_LIMIT).every((status) => status === 200)).toBe(true);
    expect(statuses[SUPPORT_REQUEST_LIMIT]).toBe(429);
    expect(channel.sent).toHaveLength(SUPPORT_REQUEST_LIMIT);
  });
});
