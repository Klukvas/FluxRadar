import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { readIntegrationConfig } from './config.ts';

export type ReportFormat = 'json' | 'csv';

export interface PrivateObjectStore {
  putText(key: string, body: string, contentType: string): Promise<void>;
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
    this.bucket = options.bucket;
    this.client =
      client ??
      new S3Client({
        endpoint: options.endpoint,
        region: options.region,
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
        ServerSideEncryption: 'AES256',
      }),
    );
  }
}

export function createConfiguredObjectStore(): HetznerObjectStore | null {
  const config = readIntegrationConfig().hetznerS3;
  return config === null ? null : new HetznerObjectStore(config);
}
