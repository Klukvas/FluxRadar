import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { defaultProfileScanConfig } from '@fluxradar/contracts';
import { profilesRouter } from './routes.ts';
import { errorHandler } from '../http/error-handler.ts';
import { silentLogger } from '../http/logger.ts';

describe('profile revision HTTP contract', () => {
  it('rejects a stale AI-context edit without overwriting the current profile', async () => {
    const profile = {
      id: 'profile',
      accountId: 'owner',
      name: 'Original',
      domain: 'https://example.com',
      scanConfigVersion: 4,
      scanConfigJson: JSON.stringify(defaultProfileScanConfig),
      createdAt: new Date(),
    };
    const update = vi.fn().mockResolvedValue({ ...profile, offerings: 'Stale edit' });
    const prisma = {
      siteProfile: { findUnique: vi.fn().mockResolvedValue(profile), update },
      session: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ accountId: 'owner', expiresAt: new Date('2099-01-01') }),
      },
    } as unknown as PrismaClient;
    const app = express();
    app.use(
      express.json(),
      profilesRouter({ prisma, now: () => new Date() }),
      errorHandler(silentLogger),
    );
    const response = await request(app)
      .patch('/profiles/profile')
      .set('Cookie', 'fluxradar_session=test-token-00000000000000000000000000000000')
      .send({ expectedProfileConfigVersion: 3, offerings: 'Stale edit' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PROFILE_CONFIG_CHANGED');
    expect(update).not.toHaveBeenCalled();
  });
});
