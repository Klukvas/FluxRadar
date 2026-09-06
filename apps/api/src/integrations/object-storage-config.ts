// Private object storage (Hetzner Object Storage, S3-compatible) configuration.
//
// Report archiving is optional: with no HETZNER_S3_* variable set the API boots,
// exports are still generated and downloaded, and nothing is archived. What must
// never happen is the middle state — a few of the five variables set — because
// the store silently disappears and a production deploy looks like it archives
// reports while it quietly keeps none of them. That is invalid, and production
// refuses to boot on it, reporting the missing variable NAMES only.

export interface ObjectStorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKey: string;
  readonly secretKey: string;
}

export type ObjectStorageConfigResult =
  | { readonly state: 'configured'; readonly config: ObjectStorageConfig }
  | { readonly state: 'not_configured' }
  | { readonly state: 'invalid'; readonly missing: readonly string[]; readonly reason: string };

export const OBJECT_STORAGE_ENV_VARS = {
  endpoint: 'HETZNER_S3_ENDPOINT',
  region: 'HETZNER_S3_REGION',
  bucket: 'HETZNER_S3_BUCKET',
  accessKey: 'HETZNER_S3_ACCESS_KEY',
  secretKey: 'HETZNER_S3_SECRET_KEY',
} as const;

function trimmed(value: string | undefined): string | null {
  const result = value?.trim() ?? '';
  return result === '' ? null : result;
}

export function readObjectStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStorageConfigResult {
  const endpoint = trimmed(env[OBJECT_STORAGE_ENV_VARS.endpoint]);
  const region = trimmed(env[OBJECT_STORAGE_ENV_VARS.region]);
  const bucket = trimmed(env[OBJECT_STORAGE_ENV_VARS.bucket]);
  const accessKey = trimmed(env[OBJECT_STORAGE_ENV_VARS.accessKey]);
  const secretKey = trimmed(env[OBJECT_STORAGE_ENV_VARS.secretKey]);
  const missing = [
    ...(endpoint === null ? [OBJECT_STORAGE_ENV_VARS.endpoint] : []),
    ...(region === null ? [OBJECT_STORAGE_ENV_VARS.region] : []),
    ...(bucket === null ? [OBJECT_STORAGE_ENV_VARS.bucket] : []),
    ...(accessKey === null ? [OBJECT_STORAGE_ENV_VARS.accessKey] : []),
    ...(secretKey === null ? [OBJECT_STORAGE_ENV_VARS.secretKey] : []),
  ];
  if (missing.length === Object.keys(OBJECT_STORAGE_ENV_VARS).length) {
    return { state: 'not_configured' };
  }
  if (
    endpoint === null ||
    region === null ||
    bucket === null ||
    accessKey === null ||
    secretKey === null
  ) {
    return {
      state: 'invalid',
      missing,
      reason: `Object storage is partially configured; missing: ${missing.join(', ')}`,
    };
  }
  // A bare hostname makes the AWS SDK build a malformed request URL that only
  // fails at the first upload, long after the deploy reported success.
  if (!/^https?:\/\//i.test(endpoint)) {
    return {
      state: 'invalid',
      missing: [OBJECT_STORAGE_ENV_VARS.endpoint],
      reason:
        `${OBJECT_STORAGE_ENV_VARS.endpoint} must include a protocol scheme ` +
        '(e.g. https://nbg1.your-objectstorage.com)',
    };
  }
  return { state: 'configured', config: { endpoint, region, bucket, accessKey, secretKey } };
}
