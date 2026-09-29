// SiteProfile.competitorsJson (T7), end to end against a real Postgres
// database: create, patch and read all go through the actual column and its
// migration, not a mocked Prisma client.

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';

const PASSWORD = 'sufficiently-long-password';

describe('SiteProfile competitors, against a real database (T7)', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  async function signIn(email: string) {
    const app = createApp({ prisma: db.prisma, autoProcess: false, logger: silentLogger });
    const agent = request.agent(app);
    const registered = await agent.post('/auth/register').send({ email, password: PASSWORD });
    expect(registered.status).toBe(201);
    return agent;
  }

  it('stores competitors through the real column and reads them back', async () => {
    const agent = await signIn('geo-competitors@example.com');
    const created = await agent.post('/profiles').send({
      name: 'Smile Clinic',
      domain: 'https://smile.example',
      competitors: ['Acme Dental', 'Bright Smile'],
    });
    expect(created.status).toBe(201);
    expect(created.body.data.competitors).toEqual(['Acme Dental', 'Bright Smile']);

    const row = await db.prisma.siteProfile.findUnique({
      where: { id: created.body.data.id as string },
    });
    expect(row?.competitorsJson).toBe(JSON.stringify(['Acme Dental', 'Bright Smile']));

    const read = await agent.get(`/profiles/${created.body.data.id as string}`);
    expect(read.body.data.competitors).toEqual(['Acme Dental', 'Bright Smile']);
  });

  it('creates a profile with a null competitorsJson column when none are given', async () => {
    const agent = await signIn('geo-no-competitors@example.com');
    const created = await agent
      .post('/profiles')
      .send({ name: 'Smile Clinic', domain: 'https://smile.example' });
    expect(created.status).toBe(201);

    const row = await db.prisma.siteProfile.findUnique({
      where: { id: created.body.data.id as string },
    });
    expect(row?.competitorsJson).toBeNull();
  });

  it('updates competitors on patch and bumps the config version once', async () => {
    const agent = await signIn('geo-patch-competitors@example.com');
    const created = await agent
      .post('/profiles')
      .send({ name: 'Smile Clinic', domain: 'https://smile.example' });
    const profileId = created.body.data.id as string;

    const patched = await agent.patch(`/profiles/${profileId}`).send({
      competitors: ['Acme Dental'],
      expectedProfileConfigVersion: created.body.data.scanConfigVersion as number,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.competitors).toEqual(['Acme Dental']);
    expect(patched.body.data.scanConfigVersion).toBe(
      (created.body.data.scanConfigVersion as number) + 1,
    );
  });

  it('rejects a competitor equal to the profile’s own domain on create', async () => {
    const agent = await signIn('geo-own-domain@example.com');
    const created = await agent.post('/profiles').send({
      name: 'Smile Clinic',
      domain: 'https://smile.example',
      competitors: ['https://smile.example'],
    });
    expect(created.status).toBe(400);

    const rows = await db.prisma.siteProfile.count();
    expect(rows).toBe(0);
  });
});
