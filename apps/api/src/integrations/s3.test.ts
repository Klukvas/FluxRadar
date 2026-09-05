import { describe, expect, it, vi } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';

import { HetznerObjectStore, reportObjectKey } from './s3.ts';

describe('Hetzner report object keys', () => {
  it('keeps artifacts tenant-scoped and format-specific', () => {
    expect(reportObjectKey('account_1', 'scan_2', 'json')).toBe(
      'accounts/account_1/scans/scan_2/report.json',
    );
    expect(reportObjectKey('account_1', 'scan_2', 'csv')).toBe(
      'accounts/account_1/scans/scan_2/report.csv',
    );
  });

  it('rejects path traversal characters in identifiers', () => {
    expect(() => reportObjectKey('../account', 'scan', 'json')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Root-cause regression: SSE-AES256 must NOT be sent to Hetzner Object Store
// ---------------------------------------------------------------------------
describe('HetznerObjectStore – PutObjectCommand shape', () => {
  it('does NOT include ServerSideEncryption in the put command (Hetzner Ceph returns NotImplemented for SSE-S3)', async () => {
    // Capture the exact command that is passed to S3Client.send so we can
    // assert the offending header is absent.
    const capturedInputs: unknown[] = [];
    const mockClient = {
      send: vi.fn().mockImplementation((cmd: unknown) => {
        capturedInputs.push(cmd);
        return Promise.resolve({});
      }),
    } as unknown as S3Client;

    const store = new HetznerObjectStore(
      {
        endpoint: 'https://nbg1.your-objectstorage.com',
        region: 'nbg1',
        bucket: 'test-bucket',
        accessKey: 'AK',
        secretKey: 'SK',
      },
      mockClient,
    );

    await store.putText('some/key', 'hello', 'text/plain');

    expect(capturedInputs).toHaveLength(1);
    const cmd = capturedInputs[0] as PutObjectCommand;
    expect(cmd).toBeInstanceOf(PutObjectCommand);

    // The ServerSideEncryption field must not be set at all.  If it were
    // 'AES256', Hetzner/Ceph responds with NotImplemented and the export
    // endpoint returns 503 to the user.
    expect(cmd.input.ServerSideEncryption).toBeUndefined();

    // Sanity-check that the expected fields are still present.
    expect(cmd.input.Bucket).toBe('test-bucket');
    expect(cmd.input.Key).toBe('some/key');
    expect(cmd.input.CacheControl).toBe('private, no-store');
  });

  it('rejects an endpoint that lacks a protocol scheme', () => {
    expect(() =>
      new HetznerObjectStore({
        endpoint: 'nbg1.your-objectstorage.com', // missing https://
        region: 'nbg1',
        bucket: 'bucket',
        accessKey: 'AK',
        secretKey: 'SK',
      }),
    ).toThrow('HETZNER_S3_ENDPOINT must include a protocol scheme');
  });
});
