import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DOMAIN_VERIFICATION_FILE_PATH,
  DOMAIN_VERIFICATION_LIMITS,
  domainVerificationTokenRecord,
} from '@fluxradar/contracts';
import { startFixtureSite, type FixtureSite } from '@fluxradar/crawler';

import { silentLogger } from '../http/logger.ts';
import { createApp } from '../index.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import { startDomainVerification, verifyDomainOwnership } from './domain-verification.ts';

// The optional ownership proof.
//
// Two things are being defended. First that it works — a published TXT record,
// file or meta tag is found, and an absent one is reported rather than assumed.
// Second, and more important, that it is genuinely optional: an account with no
// proof runs exactly the audits it ran before, and nothing here touches a plan
// or a price.

const PASSWORD = 'sufficiently-long-password';

let db: TestDb;
let fixture: FixtureSite;

/** The token the two proof servers below are currently publishing. */
let publishedToken = '';
let tokenOrigin = '';
let redirectingOrigin = '';
let tokenServer: Server;
let redirectServer: Server;

beforeAll(async () => {
  fixture = await startFixtureSite();
  // One host serves the proof; the other only points at it. Pointing is not
  // proving, and that is exactly what the redirect tests below assert.
  tokenServer = createServer((req, res) => {
    if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname === DOMAIN_VERIFICATION_FILE_PATH) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(publishedToken);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => tokenServer.listen(0, '127.0.0.1', resolve));
  tokenOrigin = `http://127.0.0.1:${(tokenServer.address() as AddressInfo).port}`;

  redirectServer = createServer((req, res) => {
    res.writeHead(302, { location: `${tokenOrigin}${req.url ?? '/'}` });
    res.end();
  });
  await new Promise<void>((resolve) => redirectServer.listen(0, '127.0.0.1', resolve));
  redirectingOrigin = `http://127.0.0.1:${(redirectServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await fixture.close();
  await new Promise<void>((resolve, reject) =>
    tokenServer.close((error) => (error ? reject(error) : resolve())),
  );
  await new Promise<void>((resolve, reject) =>
    redirectServer.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.cleanup();
});

function app(txtRecords: readonly string[] = []) {
  return createApp({
    prisma: db.prisma,
    autoProcess: false,
    logger: silentLogger,
    domainVerification: {
      resolveTxtRecords: () => Promise.resolve(txtRecords),
      dangerouslyAllowLoopback: true,
    },
  });
}

async function signedIn(instance: ReturnType<typeof app>, email: string) {
  const agent = request.agent(instance);
  const registered = await agent.post('/auth/register').send({ email, password: PASSWORD });
  expect(registered.status).toBe(201);
  return agent;
}

async function profileFor(agent: ReturnType<typeof request.agent>, domain: string) {
  const created = await agent.post('/profiles').send({ name: 'Site', domain });
  expect(created.status).toBe(201);
  return created.body.data.id as string;
}

describe('starting a proof', () => {
  it('issues a token with instructions and an expiry', async () => {
    const agent = await signedIn(app(), 'owner@example.com');
    const profileId = await profileFor(agent, 'https://owned.example');

    const started = await agent
      .post(`/profiles/${profileId}/verification`)
      .send({ method: 'dns-txt' });

    expect(started.status).toBe(201);
    expect(started.body.data.status).toBe('pending');
    expect(started.body.data.token).toMatch(
      new RegExp(`^[0-9a-f]{${DOMAIN_VERIFICATION_LIMITS.tokenBytes * 2}}$`),
    );
    expect(started.body.data.record).toBe(
      domainVerificationTokenRecord(started.body.data.token as string),
    );
    expect(new Date(started.body.data.tokenExpiresAt as string).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it('replaces the previous token when a new one is issued', async () => {
    const agent = await signedIn(app(), 'rotate@example.com');
    const profileId = await profileFor(agent, 'https://rotate.example');
    const first = await agent.post(`/profiles/${profileId}/verification`).send({ method: 'meta' });

    const second = await agent
      .post(`/profiles/${profileId}/verification`)
      .send({ method: 'dns-txt' });

    expect(second.body.data.token).not.toBe(first.body.data.token);
    expect(second.body.data.method).toBe('dns-txt');
    await expect(db.prisma.domainVerification.count()).resolves.toBe(1);
  });

  it('refuses a method it does not implement', async () => {
    const agent = await signedIn(app(), 'bad-method@example.com');
    const profileId = await profileFor(agent, 'https://bad-method.example');

    const started = await agent
      .post(`/profiles/${profileId}/verification`)
      .send({ method: 'google-search-console' });

    expect(started.status).toBe(400);
  });
});

describe('running the proof', () => {
  it('confirms a published DNS TXT record', async () => {
    const started = await (async () => {
      const agent = await signedIn(app(), 'dns@example.com');
      const profileId = await profileFor(agent, 'https://dns.example');
      const issued = await agent
        .post(`/profiles/${profileId}/verification`)
        .send({ method: 'dns-txt' });
      return { agent, profileId, token: issued.body.data.token as string };
    })();
    // A second app instance, wired with the record the owner has now published.
    const publishedAgent = request.agent(
      app(['unrelated=1', domainVerificationTokenRecord(started.token)]),
    );
    await publishedAgent.post('/auth/login').send({ email: 'dns@example.com', password: PASSWORD });

    const verified = await publishedAgent.post(
      `/profiles/${started.profileId}/verification/verify`,
    );

    expect(verified.status).toBe(200);
    expect(verified.body.data.status).toBe('verified');
    expect(verified.body.data.verifiedAt).not.toBeNull();
  });

  it('reports a missing record instead of assuming control', async () => {
    const agent = await signedIn(app(['something-else=1']), 'missing@example.com');
    const profileId = await profileFor(agent, 'https://missing.example');
    await agent.post(`/profiles/${profileId}/verification`).send({ method: 'dns-txt' });

    const verified = await agent.post(`/profiles/${profileId}/verification/verify`);

    expect(verified.status).toBe(200);
    expect(verified.body.data.status).toBe('failed');
    expect(verified.body.data.lastFailureReason).toBe('TxtRecordNotFound');
    expect(verified.body.data.verifiedAt).toBeNull();
  });

  it('refuses to check before a proof has been started', async () => {
    const agent = await signedIn(app(), 'not-started@example.com');
    const profileId = await profileFor(agent, 'https://not-started.example');

    const verified = await agent.post(`/profiles/${profileId}/verification/verify`);

    expect(verified.status).toBe(404);
  });

  it('refuses a token that has expired rather than reading anything', async () => {
    const agent = await signedIn(app(), 'expired@example.com');
    const profileId = await profileFor(agent, 'https://expired.example');
    await agent.post(`/profiles/${profileId}/verification`).send({ method: 'dns-txt' });
    await db.prisma.domainVerification.updateMany({
      where: { siteProfileId: profileId },
      data: { tokenExpiresAt: new Date(Date.now() - 1000) },
    });

    const verified = await agent.post(`/profiles/${profileId}/verification/verify`);

    expect(verified.status).toBe(409);
    expect(verified.body.error.code).toBe('VERIFICATION_TOKEN_EXPIRED');
  });

  // The token names an address. Moving the profile elsewhere does not carry it.
  it('fails a proof whose profile has since moved to another domain', async () => {
    const agent = await signedIn(app([]), 'moved@example.com');
    const profileId = await profileFor(agent, 'https://moved.example');
    await agent.post(`/profiles/${profileId}/verification`).send({ method: 'dns-txt' });
    await db.prisma.siteProfile.update({
      where: { id: profileId },
      data: { domain: 'https://elsewhere.example' },
    });

    const verified = await agent.post(`/profiles/${profileId}/verification/verify`);

    expect(verified.body.data.lastFailureReason).toBe('DomainChangedSinceTokenIssued');
  });
});

/**
 * A TXT lookup the test can hold open.
 *
 * The race only exists inside the window between the lookup starting and its
 * answer arriving, so the test has to be able to stand in that window rather
 * than hope the scheduler puts it there.
 */
function heldLookup(records: readonly string[]) {
  let markStarted = (): void => undefined;
  let release = (): void => undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    started,
    release: (): void => release(),
    resolveTxtRecords: async (): Promise<readonly string[]> => {
      markStarted();
      await held;
      return records;
    },
  };
}

describe('a token rotated while a check is running', () => {
  // The dangerous shape: a check of the OLD token finishing after a new one was
  // issued. Writing its result by row id would mark the new token verified on
  // the strength of a record the owner has already retired.
  it('does not let an old token’s success verify the token that replaced it', async () => {
    const account = await db.prisma.account.create({
      data: { email: 'rotating@example.com', passwordHash: 'test-hash' },
    });
    const profile = await db.prisma.siteProfile.create({
      data: { accountId: account.id, name: 'Site', domain: 'https://rotating.example' },
    });
    const now = new Date();
    const issued = await startDomainVerification(db.prisma, profile, 'dns-txt', now);
    const lookup = heldLookup([domainVerificationTokenRecord(issued.token)]);

    // The check of the first token is held open while the owner rotates it.
    const checking = verifyDomainOwnership(db.prisma, profile, issued, now, {
      resolveTxtRecords: lookup.resolveTxtRecords,
    });
    await lookup.started;
    const replacement = await startDomainVerification(db.prisma, profile, 'dns-txt', now);
    lookup.release();
    await checking;

    const stored = await db.prisma.domainVerification.findUniqueOrThrow({
      where: { siteProfileId: profile.id },
    });
    expect(stored.token).toBe(replacement.token);
    expect(stored.token).not.toBe(issued.token);
    expect(stored.status).toBe('pending');
    expect(stored.verifiedAt).toBeNull();
  });

  it('does not let an old token’s failure mark the new token failed', async () => {
    const account = await db.prisma.account.create({
      data: { email: 'rotating-fail@example.com', passwordHash: 'test-hash' },
    });
    const profile = await db.prisma.siteProfile.create({
      data: { accountId: account.id, name: 'Site', domain: 'https://rotating-fail.example' },
    });
    const now = new Date();
    const issued = await startDomainVerification(db.prisma, profile, 'dns-txt', now);
    const lookup = heldLookup(['nothing-of-ours=1']);

    const checking = verifyDomainOwnership(db.prisma, profile, issued, now, {
      resolveTxtRecords: lookup.resolveTxtRecords,
    });
    await lookup.started;
    await startDomainVerification(db.prisma, profile, 'dns-txt', now);
    lookup.release();
    await checking;

    const stored = await db.prisma.domainVerification.findUniqueOrThrow({
      where: { siteProfileId: profile.id },
    });
    expect(stored.status).toBe('pending');
    expect(stored.lastFailureReason).toBeNull();
    expect(stored.attempts).toBe(0);
  });
});

describe('where the proof is allowed to come from', () => {
  // Control of a domain has to be demonstrated BY that domain. A redirect to
  // somewhere else would hand the decision to whoever runs the other host.
  it('refuses a token served after a redirect to another host', async () => {
    const account = await db.prisma.account.create({
      data: { email: 'redirected@example.com', passwordHash: 'test-hash' },
    });
    const profile = await db.prisma.siteProfile.create({
      data: { accountId: account.id, name: 'Site', domain: redirectingOrigin },
    });
    const now = new Date();
    const issued = await startDomainVerification(db.prisma, profile, 'file', now);
    publishedToken = domainVerificationTokenRecord(issued.token);

    const checked = await verifyDomainOwnership(db.prisma, profile, issued, now, {
      dangerouslyAllowLoopback: true,
    });

    expect(checked.status).toBe('failed');
    expect(checked.lastFailureReason).toBe('ProofServedByAnotherHost');
  });

  it('accepts the same token when the domain serves it itself', async () => {
    const account = await db.prisma.account.create({
      data: { email: 'direct@example.com', passwordHash: 'test-hash' },
    });
    const profile = await db.prisma.siteProfile.create({
      data: { accountId: account.id, name: 'Site', domain: tokenOrigin },
    });
    const now = new Date();
    const issued = await startDomainVerification(db.prisma, profile, 'file', now);
    publishedToken = domainVerificationTokenRecord(issued.token);

    const checked = await verifyDomainOwnership(db.prisma, profile, issued, now, {
      dangerouslyAllowLoopback: true,
    });

    expect(checked.status).toBe('verified');
  });
});

describe('the tenant boundary', () => {
  it('hides another account’s proof behind the same 404 as its profile', async () => {
    const owner = await signedIn(app(), 'first@example.com');
    const profileId = await profileFor(owner, 'https://first.example');
    await owner.post(`/profiles/${profileId}/verification`).send({ method: 'dns-txt' });

    const stranger = await signedIn(app(), 'second@example.com');
    const read = await stranger.get(`/profiles/${profileId}/verification`);
    const verify = await stranger.post(`/profiles/${profileId}/verification/verify`);
    const start = await stranger
      .post(`/profiles/${profileId}/verification`)
      .send({ method: 'dns-txt' });

    expect([read.status, verify.status, start.status]).toEqual([404, 404, 404]);
  });

  it('requires a session at all', async () => {
    const owner = await signedIn(app(), 'session@example.com');
    const profileId = await profileFor(owner, 'https://session.example');

    const anonymous = await request(app()).get(`/profiles/${profileId}/verification`);

    expect(anonymous.status).toBe(401);
  });
});

describe('what a proof does NOT change', () => {
  it('reports no proof as null rather than as a problem', async () => {
    const agent = await signedIn(app(), 'none@example.com');
    const profileId = await profileFor(agent, 'https://none.example');

    const read = await agent.get(`/profiles/${profileId}/verification`);

    expect(read.status).toBe(200);
    expect(read.body.data).toBeNull();
  });

  // The whole point of "optional": an unverified site is audited as before.
  it('lets an account with no proof run its free check exactly as before', async () => {
    const agent = await signedIn(app(), 'unverified@example.com');
    const profileId = await profileFor(agent, 'https://unverified.example');

    const created = await agent.post(`/profiles/${profileId}/free-check`).send({});

    expect(created.status).toBe(201);
    expect(created.body.data.plan).toBe('Free');
  });
});
