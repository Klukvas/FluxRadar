import express from 'express';
import request from 'supertest';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, seedAccountWithProfile, type TestDb } from '../test-utils/test-db.ts';
import { createSession } from '../auth/sessions.ts';
import { RequestRateLimiter } from '../auth/rate-limit.ts';
import { errorHandler } from '../http/error-handler.ts';
import { silentLogger } from '../http/logger.ts';
import { brandingRouter } from './routes.ts';
import { loadReportBrand } from './load.ts';

const NOW = new Date('2026-10-26T12:00:00Z');
const input = {
  enabled: true,
  displayName: 'Studio A',
  accentColor: '#123456',
  contactLine: 'hello@example.com',
};
function logo(width = 200, height = 50, corrupt = false): string {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([length, Buffer.from(type), data, crc]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk(
      'IDAT',
      corrupt ? Buffer.from('broken') : zlib.deflateSync(Buffer.alloc(height * (1 + width * 4))),
    ),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

describe('account branding routes (database)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await createTestDb();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.cleanup();
  });
  function app() {
    const server = express(),
      limiter = new RequestRateLimiter(() => NOW.getTime());
    server.use(express.json({ limit: '1mb' }));
    server.use(
      brandingRouter({
        prisma: db.prisma,
        now: () => NOW,
        requestRateLimiter: limiter,
        logger: silentLogger,
      }),
    );
    server.use(errorHandler(silentLogger));
    return server;
  }
  async function owner() {
    const account = await seedAccountWithProfile(db.prisma);
    const session = await createSession(db.prisma, account.accountId, NOW);
    return { id: account.accountId, cookie: `fluxradar_session=${session.token}` };
  }
  it.each(['get', 'put', 'delete'] as const)('requires a session for %s', async (method) => {
    expect((await request(app())[method]('/account/branding').send(input)).status).toBe(401);
  });
  it('creates, reads, updates, replaces/removes the logo and deletes idempotently', async () => {
    const server = app(),
      account = await owner();
    const put = (value: object) =>
      request(server).put('/account/branding').set('Cookie', account.cookie).send(value);
    const get = () => request(server).get('/account/branding').set('Cookie', account.cookie);
    expect((await get()).body.data).toBeNull();
    const created = await put({ ...input, logo: logo() });
    expect(created.status).toBe(200);
    expect(created.body.data.logo).toMatchObject({ width: 200, height: 50 });
    expect(created.body.data).not.toHaveProperty('accountId');
    expect(created.body.data).not.toHaveProperty('id');
    const updated = await put({ ...input, displayName: 'New name' });
    expect(updated.body.data.logo.dataUrl).toBe(created.body.data.logo.dataUrl);
    expect((await get()).body.data.displayName).toBe('New name');
    expect((await put({ ...input, logo: logo(100, 100) })).body.data.logo.width).toBe(100);
    expect((await put({ ...input, logo: null })).body.data.logo).toBeNull();
    expect((await loadReportBrand(db.prisma, account.id))?.displayName).toBe(input.displayName);
    await put({ ...input, enabled: false });
    expect(await loadReportBrand(db.prisma, account.id)).toBeNull();
    for (let i = 0; i < 2; i += 1)
      expect(
        (await request(server).delete('/account/branding').set('Cookie', account.cookie)).body.data,
      ).toBeNull();
    expect((await get()).body.data).toBeNull();
  });
  it('isolates every read and write between accounts A and B', async () => {
    const server = app(),
      a = await owner(),
      b = await owner();
    await request(server).put('/account/branding').set('Cookie', a.cookie).send(input);
    expect(
      (await request(server).get('/account/branding').set('Cookie', b.cookie)).body.data,
    ).toBeNull();
    await request(server)
      .put('/account/branding')
      .set('Cookie', b.cookie)
      .send({ ...input, displayName: 'Studio B' });
    await request(server).delete('/account/branding').set('Cookie', b.cookie);
    expect(
      (await request(server).get('/account/branding').set('Cookie', a.cookie)).body.data
        .displayName,
    ).toBe('Studio A');
    expect((await loadReportBrand(db.prisma, a.id))?.displayName).toBe('Studio A');
  });
  it.each([
    [{ ...input, accountId: 'other' }, 400, 'VALIDATION'],
    [{ ...input, displayName: '\u202e' }, 400, 'VALIDATION'],
    [{ ...input, accentColor: '#eeeeee' }, 400, 'VALIDATION'],
    [{ ...input, logo: Buffer.alloc(262145).toString('base64') }, 413, 'LOGO_TOO_LARGE'],
    [{ ...input, logo: Buffer.from('<svg/>').toString('base64') }, 415, 'LOGO_UNSUPPORTED_TYPE'],
    [{ ...input, logo: logo(10, 10) }, 422, 'LOGO_BAD_DIMENSIONS'],
    [{ ...input, logo: logo(200, 50, true) }, 422, 'LOGO_UNREADABLE'],
  ])('returns the field/logo error code %#', async (body, status, code) => {
    const account = await owner();
    const response = await request(app())
      .put('/account/branding')
      .set('Cookie', account.cookie)
      .send(body);
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
    expect(await db.prisma.reportBranding.count()).toBe(0);
  });
  it('wraps save failures without logging body or bytes', async () => {
    const account = await owner(),
      logger = { ...silentLogger, error: vi.fn() };
    vi.spyOn(db.prisma.reportBranding, 'upsert').mockRejectedValue(
      new Error('SECRET BASE64 AND NAME'),
    );
    const server = express();
    server.use(express.json());
    server.use(brandingRouter({ prisma: db.prisma, now: () => NOW, logger }));
    server.use(errorHandler(silentLogger));
    const response = await request(server)
      .put('/account/branding')
      .set('Cookie', account.cookie)
      .send(input);
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('BRANDING_SAVE_FAILED');
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/SECRET|Studio A|hello@example/);
  });
  it('limits the shared PUT/DELETE account bucket on write 21', async () => {
    const server = app(),
      account = await owner();
    for (let i = 0; i < 20; i += 1) {
      const response =
        i % 2 === 0
          ? await request(server).put('/account/branding').set('Cookie', account.cookie).send(input)
          : await request(server).delete('/account/branding').set('Cookie', account.cookie);
      expect(response.status).toBe(200);
    }
    expect(
      (await request(server).put('/account/branding').set('Cookie', account.cookie).send(input))
        .status,
    ).toBe(429);
  });
});
