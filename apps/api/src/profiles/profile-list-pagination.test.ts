import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { MAX_PAGE_SIZE } from '../http/pagination.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';

const PASSWORD = 'sufficiently-long-password';

describe('profile list pagination', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  async function seedProfiles(count: number) {
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    await agent.post('/auth/register').send({ email: 'lister@example.com', password: PASSWORD });
    for (let index = 0; index < count; index += 1) {
      const created = await agent
        .post('/profiles')
        .send({ name: `Site ${index}`, domain: `https://site-${index}.example.com` });
      expect(created.status).toBe(201);
    }
    return agent;
  }

  // A client written before paging existed sends no parameters and must keep
  // seeing every profile it used to see.
  it('returns the whole list to a caller that asks for no page', async () => {
    const agent = await seedProfiles(60);

    const response = await agent.get('/profiles');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(60);
    expect(response.body.meta).toEqual({
      total: 60,
      page: 1,
      limit: MAX_PAGE_SIZE,
      hasNext: false,
    });
  });

  it('pages when asked, in a stable order', async () => {
    const agent = await seedProfiles(5);

    const first = await agent.get('/profiles?limit=2&offset=0');
    const second = await agent.get('/profiles?limit=2&offset=2');
    expect(first.body.meta).toEqual({ total: 5, page: 1, limit: 2, hasNext: true });
    expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
    expect(first.body.data.map((p: { domain: string }) => p.domain)).toEqual([
      'https://site-0.example.com',
      'https://site-1.example.com',
    ]);
  });

  it('rejects a malformed page the same way every list does', async () => {
    const agent = await seedProfiles(1);

    expect((await agent.get('/profiles?limit=0')).status).toBe(400);
    expect((await agent.get('/profiles?page=1&offset=0')).status).toBe(400);
  });
});
