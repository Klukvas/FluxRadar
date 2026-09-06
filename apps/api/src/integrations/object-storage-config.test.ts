import { describe, expect, it } from 'vitest';

import { OBJECT_STORAGE_ENV_VARS, readObjectStorageConfig } from './object-storage-config.ts';

const COMPLETE_ENV = {
  [OBJECT_STORAGE_ENV_VARS.endpoint]: 'https://nbg1.your-objectstorage.com',
  [OBJECT_STORAGE_ENV_VARS.region]: 'nbg1',
  [OBJECT_STORAGE_ENV_VARS.bucket]: 'fluxradar-reports',
  [OBJECT_STORAGE_ENV_VARS.accessKey]: 'access-key',
  [OBJECT_STORAGE_ENV_VARS.secretKey]: 'secret-key',
} satisfies NodeJS.ProcessEnv;

describe('object storage configuration', () => {
  it('is simply off when no variable is set', () => {
    expect(readObjectStorageConfig({ NODE_ENV: 'production' }).state).toBe('not_configured');
  });

  it('treats an empty value as unset', () => {
    const env = Object.fromEntries(
      Object.values(OBJECT_STORAGE_ENV_VARS).map((name) => [name, '   ']),
    );

    expect(readObjectStorageConfig(env).state).toBe('not_configured');
  });

  it('is configured when the whole set is present', () => {
    const result = readObjectStorageConfig({ ...COMPLETE_ENV });

    expect(result.state).toBe('configured');
    if (result.state !== 'configured') return;
    expect(result.config.bucket).toBe('fluxradar-reports');
  });

  // Silently disabling the store is what this replaces: exports kept working,
  // nothing was archived, and the deploy looked healthy.
  it.each(Object.values(OBJECT_STORAGE_ENV_VARS))(
    'reports a partial configuration missing %s',
    (missingVar) => {
      const env = { ...COMPLETE_ENV, [missingVar]: '' };

      const result = readObjectStorageConfig(env);

      expect(result.state).toBe('invalid');
      if (result.state !== 'invalid') return;
      expect(result.missing).toEqual([missingVar]);
      expect(result.reason).toContain(missingVar);
    },
  );

  it('names every missing variable at once', () => {
    const result = readObjectStorageConfig({
      [OBJECT_STORAGE_ENV_VARS.bucket]: 'fluxradar-reports',
    });

    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect([...result.missing].sort()).toEqual(
      [
        OBJECT_STORAGE_ENV_VARS.accessKey,
        OBJECT_STORAGE_ENV_VARS.endpoint,
        OBJECT_STORAGE_ENV_VARS.region,
        OBJECT_STORAGE_ENV_VARS.secretKey,
      ].sort(),
    );
  });

  it('refuses an endpoint without a protocol scheme', () => {
    const result = readObjectStorageConfig({
      ...COMPLETE_ENV,
      [OBJECT_STORAGE_ENV_VARS.endpoint]: 'nbg1.your-objectstorage.com',
    });

    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.missing).toEqual([OBJECT_STORAGE_ENV_VARS.endpoint]);
  });

  it('never puts a credential value in the reason', () => {
    const result = readObjectStorageConfig({
      ...COMPLETE_ENV,
      [OBJECT_STORAGE_ENV_VARS.secretKey]: '',
      [OBJECT_STORAGE_ENV_VARS.accessKey]: 'super-secret-value',
    });

    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.reason).not.toContain('super-secret-value');
  });
});
