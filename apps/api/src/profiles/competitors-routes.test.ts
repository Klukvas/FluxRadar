// SiteProfile competitors (T7) — the HTTP contract: create/update accept and
// store them, rejection cases are refused before any write, and a read
// returns the parsed list. Mocked Prisma, the same pattern
// profile-revision.test.ts uses — no database needed for a routing contract.

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { defaultProfileScanConfig } from '@fluxradar/contracts';
import { profilesRouter } from './routes.ts';
import { errorHandler } from '../http/error-handler.ts';
import { silentLogger } from '../http/logger.ts';

const SESSION_COOKIE = 'fluxradar_session=test-token-00000000000000000000000000000000';

function appWith(prisma: Partial<PrismaClient>) {
  const app = express();
  app.use(
    express.json(),
    profilesRouter({ prisma: prisma as PrismaClient, now: () => new Date() }),
    errorHandler(silentLogger),
  );
  return app;
}

function sessionMock() {
  return vi.fn().mockResolvedValue({ accountId: 'owner', expiresAt: new Date('2099-01-01') });
}

describe('SiteProfile competitors (T7)', () => {
  it('stores up to 5 competitor names on create', async () => {
    const create = vi.fn().mockImplementation(({ data }) => ({
      id: 'profile-1',
      accountId: data.accountId,
      name: data.name,
      domain: data.domain,
      industry: null,
      region: null,
      language: null,
      businessDescription: null,
      offerings: null,
      targetLanguages: null,
      targetAudience: null,
      competitorsJson: data.competitorsJson,
      scanConfigJson: data.scanConfigJson,
      scanConfigVersion: 1,
      createdAt: new Date(),
    }));
    const app = appWith({
      siteProfile: { create } as unknown as PrismaClient['siteProfile'],
      session: { findUnique: sessionMock() } as unknown as PrismaClient['session'],
    });

    const response = await request(app)
      .post('/profiles')
      .set('Cookie', SESSION_COOKIE)
      .send({
        name: 'Smile Clinic',
        domain: 'https://smile.example',
        competitors: ['Acme Dental', 'Bright Smile'],
      });

    expect(response.status).toBe(201);
    expect(response.body.data.competitors).toEqual(['Acme Dental', 'Bright Smile']);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          competitorsJson: JSON.stringify(['Acme Dental', 'Bright Smile']),
        }),
      }),
    );
  });

  it('stores no competitorsJson when the field is omitted', async () => {
    const create = vi.fn().mockImplementation(({ data }) => ({
      id: 'profile-1',
      accountId: data.accountId,
      name: data.name,
      domain: data.domain,
      industry: null,
      region: null,
      language: null,
      businessDescription: null,
      offerings: null,
      targetLanguages: null,
      targetAudience: null,
      competitorsJson: data.competitorsJson,
      scanConfigJson: data.scanConfigJson,
      scanConfigVersion: 1,
      createdAt: new Date(),
    }));
    const app = appWith({
      siteProfile: { create } as unknown as PrismaClient['siteProfile'],
      session: { findUnique: sessionMock() } as unknown as PrismaClient['session'],
    });

    const response = await request(app)
      .post('/profiles')
      .set('Cookie', SESSION_COOKIE)
      .send({ name: 'Smile Clinic', domain: 'https://smile.example' });

    expect(response.status).toBe(201);
    expect(response.body.data.competitors).toBeNull();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ competitorsJson: null }) }),
    );
  });

  it('rejects more than 5 competitors before writing anything', async () => {
    const create = vi.fn();
    const app = appWith({
      siteProfile: { create } as unknown as PrismaClient['siteProfile'],
      session: { findUnique: sessionMock() } as unknown as PrismaClient['session'],
    });

    const response = await request(app)
      .post('/profiles')
      .set('Cookie', SESSION_COOKIE)
      .send({
        name: 'Smile Clinic',
        domain: 'https://smile.example',
        competitors: ['A1', 'B1', 'C1', 'D1', 'E1', 'F1'],
      });

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a competitor equal to the profile’s own name on create', async () => {
    const create = vi.fn();
    const app = appWith({
      siteProfile: { create } as unknown as PrismaClient['siteProfile'],
      session: { findUnique: sessionMock() } as unknown as PrismaClient['session'],
    });

    const response = await request(app)
      .post('/profiles')
      .set('Cookie', SESSION_COOKIE)
      .send({
        name: 'Smile Clinic',
        domain: 'https://smile.example',
        competitors: ['Smile Clinic'],
      });

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('updates competitors on patch and bumps the config version', async () => {
    const profile = {
      id: 'profile-1',
      accountId: 'owner',
      name: 'Smile Clinic',
      domain: 'https://smile.example',
      industry: null,
      region: null,
      language: null,
      businessDescription: null,
      offerings: null,
      targetLanguages: null,
      targetAudience: null,
      competitorsJson: null,
      scanConfigVersion: 1,
      scanConfigJson: JSON.stringify(defaultProfileScanConfig),
      createdAt: new Date(),
    };
    const update = vi.fn().mockImplementation(({ data }) => ({ ...profile, ...data }));
    const app = appWith({
      siteProfile: {
        findUnique: vi.fn().mockResolvedValue(profile),
        update,
      } as unknown as PrismaClient['siteProfile'],
      session: { findUnique: sessionMock() } as unknown as PrismaClient['session'],
    });

    const response = await request(app)
      .patch('/profiles/profile-1')
      .set('Cookie', SESSION_COOKIE)
      .send({ competitors: ['Acme Dental'] });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          competitorsJson: JSON.stringify(['Acme Dental']),
          scanConfigVersion: { increment: 1 },
        }),
      }),
    );
  });

  it('clears competitors on patch with an empty list', async () => {
    const profile = {
      id: 'profile-1',
      accountId: 'owner',
      name: 'Smile Clinic',
      domain: 'https://smile.example',
      industry: null,
      region: null,
      language: null,
      businessDescription: null,
      offerings: null,
      targetLanguages: null,
      targetAudience: null,
      competitorsJson: JSON.stringify(['Acme Dental']),
      scanConfigVersion: 1,
      scanConfigJson: JSON.stringify(defaultProfileScanConfig),
      createdAt: new Date(),
    };
    const update = vi.fn().mockImplementation(({ data }) => ({ ...profile, ...data }));
    const app = appWith({
      siteProfile: {
        findUnique: vi.fn().mockResolvedValue(profile),
        update,
      } as unknown as PrismaClient['siteProfile'],
      session: { findUnique: sessionMock() } as unknown as PrismaClient['session'],
    });

    const response = await request(app)
      .patch('/profiles/profile-1')
      .set('Cookie', SESSION_COOKIE)
      .send({ competitors: [] });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ competitorsJson: null }) }),
    );
  });

  it('rejects a patch competitor equal to the profile’s stored domain', async () => {
    const profile = {
      id: 'profile-1',
      accountId: 'owner',
      name: 'Smile Clinic',
      domain: 'https://smile.example',
      industry: null,
      region: null,
      language: null,
      businessDescription: null,
      offerings: null,
      targetLanguages: null,
      targetAudience: null,
      competitorsJson: null,
      scanConfigVersion: 1,
      scanConfigJson: JSON.stringify(defaultProfileScanConfig),
      createdAt: new Date(),
    };
    const update = vi.fn();
    const app = appWith({
      siteProfile: {
        findUnique: vi.fn().mockResolvedValue(profile),
        update,
      } as unknown as PrismaClient['siteProfile'],
      session: { findUnique: sessionMock() } as unknown as PrismaClient['session'],
    });

    const response = await request(app)
      .patch('/profiles/profile-1')
      .set('Cookie', SESSION_COOKIE)
      .send({ competitors: ['https://smile.example'] });

    expect(response.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  // T7-fix F3: `assertCompetitorsAllowed` used to run only when the request
  // touched `competitors` itself, so a rename or a domain change never
  // re-checked the stored list against the value being renamed to.
  it('rejects a PATCH that renames the profile to equal a stored competitor', async () => {
    const profile = {
      id: 'profile-1',
      accountId: 'owner',
      name: 'Smile Clinic',
      domain: 'https://smile.example',
      industry: null,
      region: null,
      language: null,
      businessDescription: null,
      offerings: null,
      targetLanguages: null,
      targetAudience: null,
      competitorsJson: JSON.stringify(['Acme Dental']),
      scanConfigVersion: 1,
      scanConfigJson: JSON.stringify(defaultProfileScanConfig),
      createdAt: new Date(),
    };
    const update = vi.fn();
    const app = appWith({
      siteProfile: {
        findUnique: vi.fn().mockResolvedValue(profile),
        update,
      } as unknown as PrismaClient['siteProfile'],
      session: { findUnique: sessionMock() } as unknown as PrismaClient['session'],
    });

    const response = await request(app)
      .patch('/profiles/profile-1')
      .set('Cookie', SESSION_COOKIE)
      .send({ name: 'Acme Dental' });

    expect(response.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a PATCH that changes the domain to equal a stored competitor', async () => {
    const profile = {
      id: 'profile-1',
      accountId: 'owner',
      name: 'Smile Clinic',
      domain: 'https://smile.example',
      industry: null,
      region: null,
      language: null,
      businessDescription: null,
      offerings: null,
      targetLanguages: null,
      targetAudience: null,
      competitorsJson: JSON.stringify(['acme.example']),
      scanConfigVersion: 1,
      scanConfigJson: JSON.stringify(defaultProfileScanConfig),
      createdAt: new Date(),
    };
    const update = vi.fn();
    const app = appWith({
      siteProfile: {
        findUnique: vi.fn().mockResolvedValue(profile),
        update,
      } as unknown as PrismaClient['siteProfile'],
      checkoutSession: {
        count: vi.fn().mockResolvedValue(0),
      } as unknown as PrismaClient['checkoutSession'],
      session: { findUnique: sessionMock() } as unknown as PrismaClient['session'],
    });

    const response = await request(app)
      .patch('/profiles/profile-1')
      .set('Cookie', SESSION_COOKIE)
      .send({ domain: 'https://acme.example' });

    expect(response.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('allows a PATCH rename that does not collide with any stored competitor', async () => {
    const profile = {
      id: 'profile-1',
      accountId: 'owner',
      name: 'Smile Clinic',
      domain: 'https://smile.example',
      industry: null,
      region: null,
      language: null,
      businessDescription: null,
      offerings: null,
      targetLanguages: null,
      targetAudience: null,
      competitorsJson: JSON.stringify(['Acme Dental']),
      scanConfigVersion: 1,
      scanConfigJson: JSON.stringify(defaultProfileScanConfig),
      createdAt: new Date(),
    };
    const update = vi.fn().mockImplementation(({ data }) => ({ ...profile, ...data }));
    const app = appWith({
      siteProfile: {
        findUnique: vi.fn().mockResolvedValue(profile),
        update,
      } as unknown as PrismaClient['siteProfile'],
      session: { findUnique: sessionMock() } as unknown as PrismaClient['session'],
    });

    const response = await request(app)
      .patch('/profiles/profile-1')
      .set('Cookie', SESSION_COOKIE)
      .send({ name: 'Bright Smile Clinic' });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalled();
  });

  // T7-fix2 N7: re-checked only when name, domain, or competitors are part of
  // the request — a scanConfig-only PATCH must not be blocked by a stored
  // list that predates a later rule tightening, since this request neither
  // reads nor changes it.
  it('allows a scanConfig-only PATCH even when the stored list would fail today', async () => {
    const profile = {
      id: 'profile-1',
      accountId: 'owner',
      name: 'Smile Clinic',
      domain: 'https://smile.example',
      industry: null,
      region: null,
      language: null,
      businessDescription: null,
      offerings: null,
      targetLanguages: null,
      targetAudience: null,
      // A stored list that would be rejected today (repeats the brand), left
      // in place from before that rule existed.
      competitorsJson: JSON.stringify(['Smile Clinic']),
      scanConfigVersion: 1,
      scanConfigJson: JSON.stringify(defaultProfileScanConfig),
      createdAt: new Date(),
    };
    const update = vi.fn().mockImplementation(({ data }) => ({ ...profile, ...data }));
    const app = appWith({
      siteProfile: {
        findUnique: vi.fn().mockResolvedValue(profile),
        update,
      } as unknown as PrismaClient['siteProfile'],
      session: { findUnique: sessionMock() } as unknown as PrismaClient['session'],
    });

    const response = await request(app)
      .patch('/profiles/profile-1')
      .set('Cookie', SESSION_COOKIE)
      .send({ scanConfig: { plan: 'Complete', scope: { includeSubdomains: true } } });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalled();
  });

  it('reads a stored competitors list back from GET', async () => {
    const profile = {
      id: 'profile-1',
      accountId: 'owner',
      name: 'Smile Clinic',
      domain: 'https://smile.example',
      industry: null,
      region: null,
      language: null,
      businessDescription: null,
      offerings: null,
      targetLanguages: null,
      targetAudience: null,
      competitorsJson: JSON.stringify(['Acme Dental', 'Bright Smile']),
      scanConfigVersion: 1,
      scanConfigJson: JSON.stringify(defaultProfileScanConfig),
      createdAt: new Date(),
    };
    const app = appWith({
      siteProfile: {
        findUnique: vi.fn().mockResolvedValue(profile),
      } as unknown as PrismaClient['siteProfile'],
      session: { findUnique: sessionMock() } as unknown as PrismaClient['session'],
    });

    const response = await request(app).get('/profiles/profile-1').set('Cookie', SESSION_COOKIE);

    expect(response.status).toBe(200);
    expect(response.body.data.competitors).toEqual(['Acme Dental', 'Bright Smile']);
  });
});
