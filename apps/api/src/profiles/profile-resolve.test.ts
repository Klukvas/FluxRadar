import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { createTestDb, type TestDb, TEST_WEBHOOK_SECRET } from '../test-utils/test-db.ts';
import { resolveOwnProfile } from './resolve.ts';
import { siteProfileNameFor } from './site-profile-name.ts';

// Starting a scan from a raw URL, from the server's side.
//
// The endpoint under test is the only step between "someone typed an address"
// and "a scan exists", so it has to be exactly three things at once: it must
// create a profile when there is none, reuse the one there is without touching
// it, and never let two requests for the same address produce two profiles or an
// error the owner should not see. Each of those has its own way of going wrong,
// so each has its own test.

const PASSWORD = 'sufficiently-long-password';

describe('POST /profiles/resolve', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  function app() {
    return createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });
  }

  async function signedIn(email: string) {
    const agent = request.agent(app());
    const registered = await agent.post('/auth/register').send({ email, password: PASSWORD });
    expect(registered.status).toBe(201);
    return agent;
  }

  it('creates the profile for an address when the account has none', async () => {
    const agent = await signedIn('first-scan@example.com');

    const response = await agent
      .post('/profiles/resolve')
      .send({ domain: 'https://www.mysite.com' });

    expect(response.status).toBe(201);
    expect(response.body.data.created).toBe(true);
    expect(response.body.data.profile.domain).toBe('https://www.mysite.com');
    // Owners call their site by its domain; "www." is not part of what they call it.
    expect(response.body.data.profile.name).toBe('mysite.com');
    await expect(db.prisma.siteProfile.count()).resolves.toBe(1);
  });

  it('persists the reusable scan configuration on the profile', async () => {
    const agent = await signedIn('profile-config@example.com');
    const created = await agent.post('/profiles').send({
      name: 'Configured site',
      domain: 'https://configured.example.com',
      scanConfig: {
        plan: 'Complete',
        scope: {
          includeSubdomains: true,
          maxPages: 120,
          maxDepth: 6,
          queryPolicy: 'include',
          respectRobots: true,
          userAgent: 'mobile',
        },
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.scanConfig.scope.maxPages).toBe(120);
    expect(created.body.data.scanConfigVersion).toBe(1);

    const updated = await agent.patch(`/profiles/${created.body.data.id}`).send({
      scanConfig: {
        plan: 'Complete',
        scope: {
          includeSubdomains: false,
          maxPages: 15,
          maxDepth: 5,
          queryPolicy: 'ignore',
          respectRobots: true,
          userAgent: 'desktop',
        },
      },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.scanConfig).toEqual({
      plan: 'Complete',
      scope: {
        includeSubdomains: false,
        maxPages: 15,
        maxDepth: 5,
        queryPolicy: 'ignore',
        respectRobots: true,
        robotsOverrideConfirmed: false,
        userAgent: 'desktop',
      },
    });
    expect(updated.body.data.scanConfigVersion).toBe(2);
  });

  // The name is a suggestion made once. A profile the owner renamed is the same
  // profile the next scan of that address belongs to, and renaming it back would
  // undo a decision they made on purpose.
  it('reuses an existing profile and never overwrites the name on it', async () => {
    const agent = await signedIn('renamer@example.com');
    const created = await agent
      .post('/profiles')
      .send({ name: 'Marketing site', domain: 'https://mysite.com' });
    expect(created.status).toBe(201);

    const response = await agent.post('/profiles/resolve').send({ domain: 'https://mysite.com' });

    expect(response.status).toBe(200);
    expect(response.body.data.created).toBe(false);
    expect(response.body.data.profile.id).toBe(created.body.data.id);
    expect(response.body.data.profile.name).toBe('Marketing site');
    await expect(db.prisma.siteProfile.count()).resolves.toBe(1);
  });

  // The stored domain is a normalized origin, so the lookup has to be made on
  // the same normalization or a second spelling of one site becomes a second
  // profile — which is exactly what the (account, domain) constraint exists to
  // prevent, and what would split the site's scan history in two.
  it('matches a differently spelled address to the profile that already exists', async () => {
    const agent = await signedIn('speller@example.com');
    const first = await agent.post('/profiles/resolve').send({ domain: 'https://mysite.com' });
    expect(first.status).toBe(201);

    const second = await agent
      .post('/profiles/resolve')
      .send({ domain: 'https://MySite.com:443/' });

    expect(second.status).toBe(200);
    expect(second.body.data.created).toBe(false);
    expect(second.body.data.profile.id).toBe(first.body.data.profile.id);
    await expect(db.prisma.siteProfile.count()).resolves.toBe(1);
  });

  it('answers two simultaneous requests for one address with one profile', async () => {
    const agent = await signedIn('double-click@example.com');

    const [first, second] = await Promise.all([
      agent.post('/profiles/resolve').send({ domain: 'https://mysite.com' }),
      agent.post('/profiles/resolve').send({ domain: 'https://mysite.com' }),
    ]);

    expect([first.status, second.status].every((status) => status < 400)).toBe(true);
    expect(first.body.data.profile.id).toBe(second.body.data.profile.id);
    await expect(db.prisma.siteProfile.count()).resolves.toBe(1);
  });

  it('keeps two accounts checking the same site on their own profiles', async () => {
    const first = await signedIn('one@example.com');
    const second = await signedIn('two@example.com');

    const mine = await first.post('/profiles/resolve').send({ domain: 'https://shared.example' });
    const theirs = await second
      .post('/profiles/resolve')
      .send({ domain: 'https://shared.example' });

    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(201);
    expect(theirs.body.data.profile.id).not.toBe(mine.body.data.profile.id);
    await expect(db.prisma.siteProfile.count()).resolves.toBe(2);
    // The second account's list holds its own profile and nothing else.
    const listed = await second.get('/profiles');
    expect(listed.body.data.map((profile: { id: string }) => profile.id)).toEqual([
      theirs.body.data.profile.id,
    ]);
  });

  it.each([
    ['a bare domain', 'mysite.com'],
    ['an insecure scheme', 'http://mysite.com'],
    ['a path', 'https://mysite.com/pricing'],
    ['embedded credentials', 'https://user:pass@mysite.com'],
    ['nothing at all', ''],
  ])('refuses %s', async (_label, domain) => {
    const agent = await signedIn(`invalid-${_label.replace(/\W/g, '')}@example.com`);

    const response = await agent.post('/profiles/resolve').send({ domain });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION');
    await expect(db.prisma.siteProfile.count()).resolves.toBe(0);
  });

  it('requires a session', async () => {
    const response = await request(app())
      .post('/profiles/resolve')
      .send({ domain: 'https://mysite.com' });

    expect(response.status).toBe(401);
    await expect(db.prisma.siteProfile.count()).resolves.toBe(0);
  });
});

// The race above depends on how two requests happen to interleave, so it can
// pass without ever reaching the branch it is about. This one forces that
// branch: the read misses exactly as it would for the request that lost, and
// the create then hits the unique constraint the winner has already satisfied.
describe('resolveOwnProfile under a lost create race', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('returns the profile the winning request created', async () => {
    const account = await db.prisma.account.create({
      data: { email: 'racer@example.com', passwordHash: 'test-hash' },
    });
    const winner = await db.prisma.siteProfile.create({
      data: { accountId: account.id, name: 'Winner', domain: 'https://mysite.com' },
    });
    let reads = 0;
    const losingClient = {
      siteProfile: {
        findUnique: (args: Parameters<PrismaClient['siteProfile']['findUnique']>[0]) =>
          reads++ === 0 ? Promise.resolve(null) : db.prisma.siteProfile.findUnique(args),
        create: (args: Parameters<PrismaClient['siteProfile']['create']>[0]) =>
          db.prisma.siteProfile.create(args),
      },
    } as unknown as PrismaClient;

    const resolved = await resolveOwnProfile(losingClient, account.id, 'https://mysite.com');

    expect(resolved.created).toBe(false);
    expect(resolved.profile.id).toBe(winner.id);
    expect(resolved.profile.name).toBe('Winner');
    await expect(db.prisma.siteProfile.count()).resolves.toBe(1);
  });
});

describe('siteProfileNameFor', () => {
  it.each([
    ['https://mysite.com', 'mysite.com'],
    ['https://www.mysite.com', 'mysite.com'],
    ['https://shop.mysite.co.uk', 'shop.mysite.co.uk'],
    // Stripping "www." here would leave "com", which is not a site name.
    ['https://www.com', 'www.com'],
    ['https://mysite.com:8443', 'mysite.com'],
  ])('names %s "%s"', (origin, expected) => {
    expect(siteProfileNameFor(origin)).toBe(expected);
  });

  // Never throws on stored data: an unparseable domain names itself rather than
  // taking down the scan that was about to run against it.
  it('falls back to the stored value when it is not a URL', () => {
    expect(siteProfileNameFor('not a url')).toBe('not a url');
  });
});
