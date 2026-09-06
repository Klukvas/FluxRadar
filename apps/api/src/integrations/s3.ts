import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { readObjectStorageConfig } from './object-storage-config.ts';

export type ReportFormat = 'json' | 'csv';

export interface PrivateObjectStore {
  putText(key: string, body: string, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
}

function safeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return value;
}

export function reportObjectKey(accountId: string, scanId: string, format: ReportFormat): string {
  return `accounts/${safeSegment(accountId, 'accountId')}/scans/${safeSegment(scanId, 'scanId')}/report.${format}`;
}

/**
 * Validates that an endpoint string includes a protocol scheme.
 * Hetzner Object Storage endpoints must be full URLs, e.g.
 * "https://nbg1.your-objectstorage.com". Passing a bare hostname causes the
 * AWS SDK to construct a malformed request URL and silently fail.
 */
function assertEndpointUrl(endpoint: string): void {
  if (!/^https?:\/\//i.test(endpoint)) {
    throw new Error(
      `HETZNER_S3_ENDPOINT must include a protocol scheme (e.g. https://nbg1.your-objectstorage.com), got: "${endpoint}"`,
    );
  }
}

export class HetznerObjectStore implements PrivateObjectStore {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(
    options: {
      readonly endpoint: string;
      readonly region: string;
      readonly bucket: string;
      readonly accessKey: string;
      readonly secretKey: string;
    },
    client?: S3Client,
  ) {
    assertEndpointUrl(options.endpoint);
    this.bucket = options.bucket;
    this.client =
      client ??
      new S3Client({
        endpoint: options.endpoint,
        region: options.region,
        // Path-style addressing is required for Hetzner / Ceph S3-compatible
        // storage; the bucket name must appear in the path, not the host.
        forcePathStyle: true,
        credentials: { accessKeyId: options.accessKey, secretAccessKey: options.secretKey },
      });
  }

  async putText(key: string, body: string, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'private, no-store',
        // NOTE: ServerSideEncryption / SSE-S3 ("AES256") is an AWS-specific
        // feature that Hetzner Object Storage (Ceph RGW) does NOT support.
        // Sending this header causes Ceph to return NotImplemented (HTTP 501),
        // which propagates as the user-visible "report storage is temporarily
        // unavailable" 503. Hetzner encrypts all data at rest at the
        // infrastructure level, so this header is both redundant and harmful.
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function createConfiguredObjectStore(): HetznerObjectStore | null {
  // Test runs must never send report data to a real bucket, even when a
  // developer has credentials in a local .env file.
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') return null;
  const result = readObjectStorageConfig();
  // A partially configured store never reaches here in production: the boot
  // fails on it (integrations/config.ts). Elsewhere it stays off, and the
  // startup diagnostics name the variables that are missing.
  return result.state === 'configured' ? new HetznerObjectStore(result.config) : null;
}
