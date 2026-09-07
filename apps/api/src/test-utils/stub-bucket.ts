import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// A stub Hetzner Object Storage bucket.
//
// It lives under test-utils/ because tsconfig.build.json excludes that directory:
// a helper that starts an HTTP server has no business being compiled into the
// production image, however inert it is there.
//
// DEPLOY-004 and DEPLOY-005 run the REAL backup client against this: the same
// SigV4 signing, the same path-style URLs, the same streaming upload, the same
// ListObjectsV2 pagination. What it does not do is talk to Hetzner — a test that
// needed live credentials would be skipped in CI, which is the same as not
// existing.
//
// It is strict where Ceph is strict, because those are the mistakes that would
// only ever surface in production:
//   * every request must be signed (an unsigned one is answered 403);
//   * `x-amz-content-sha256` must be the real hash of the body it received, so a
//     client that streams a file and signs a different digest is caught here;
//   * addressing is path-style only, exactly as Hetzner requires.

export interface StoredObject {
  readonly body: Buffer;
  readonly contentType: string;
}

export interface StubBucket {
  readonly url: string;
  readonly bucket: string;
  readonly objects: Map<string, StoredObject>;
  /** ListObjectsV2 page size; small values exercise continuation tokens. */
  maxKeys: number;
  /**
   * Key -> status the bucket answers with instead of serving the object.
   *
   * Ceph answers a readable bucket and an unreadable one with the same shape and
   * different numbers: 404 for an object that is not there, 403 for credentials
   * that may not read it, 5xx for a bad day. A client that cannot tell those
   * apart reports a broken bucket as an empty one, so the tests need to be able
   * to produce each of them for one specific key.
   */
  readonly failures: Map<string, number>;
  readonly requests: { method: string; path: string; signed: boolean }[];
  close: () => Promise<void>;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function errorBody(code: string, message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`;
}

const FAILURE_CODES: Record<number, string> = {
  403: 'AccessDenied',
  500: 'InternalError',
  503: 'SlowDown',
};

export async function startStubBucket(bucket = 'fluxradar-backups'): Promise<StubBucket> {
  const objects = new Map<string, StoredObject>();
  const failures = new Map<string, number>();
  const requests: { method: string; path: string; signed: boolean }[] = [];
  const state = { maxKeys: 1000 };

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(request.url ?? '/', 'http://stub.invalid');
      const authorization = request.headers.authorization ?? '';
      const signed = authorization.startsWith('AWS4-HMAC-SHA256 Credential=');
      requests.push({ method: request.method ?? '', path: url.pathname, signed });

      // Bodies are written as Buffers, never as strings: an encrypted archive is
      // binary, and a stub that re-encoded it as UTF-8 would corrupt exactly the
      // bytes these tests exist to prove survive the round trip.
      const send = (
        status: number,
        payload: Buffer | string = '',
        headers: Record<string, string> = {},
      ): void => {
        const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
        response.writeHead(status, { 'content-length': String(buffer.length), ...headers });
        if (status === 204 || request.method === 'HEAD') {
          response.end();
          return;
        }
        response.end(buffer);
      };

      if (!signed) {
        send(403, errorBody('AccessDenied', 'request was not signed'));
        return;
      }
      const payloadHash = request.headers['x-amz-content-sha256'];
      if (typeof payloadHash !== 'string') {
        send(400, errorBody('MissingContentSHA256', 'x-amz-content-sha256 is required'));
        return;
      }
      if (
        request.method === 'PUT' &&
        createHash('sha256').update(body).digest('hex') !== payloadHash
      ) {
        send(
          400,
          errorBody('XAmzContentSHA256Mismatch', 'the signed payload hash is not the body'),
        );
        return;
      }

      const [, pathBucket, ...keyParts] = url.pathname.split('/');
      if (pathBucket !== bucket) {
        send(404, errorBody('NoSuchBucket', 'path-style addressing is required'));
        return;
      }
      const key = decodeURIComponent(keyParts.join('/'));

      if (request.method === 'GET' && key === '' && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') ?? '';
        const after = url.searchParams.get('continuation-token');
        const all = [...objects.keys()].filter((name) => name.startsWith(prefix)).sort();
        const start = after === null ? 0 : all.indexOf(after) + 1;
        const page = all.slice(start, start + state.maxKeys);
        const truncated = start + page.length < all.length;
        const contents = page
          .map(
            (name) =>
              `<Contents><Key>${xmlEscape(name)}</Key><Size>${objects.get(name)?.body.length ?? 0}</Size>` +
              `<LastModified>2026-09-06T00:00:00.000Z</LastModified></Contents>`,
          )
          .join('');
        send(
          200,
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>${truncated}</IsTruncated>` +
            `${contents}` +
            (truncated
              ? `<NextContinuationToken>${xmlEscape(page[page.length - 1] ?? '')}</NextContinuationToken>`
              : '') +
            `</ListBucketResult>`,
          { 'content-type': 'application/xml' },
        );
        return;
      }

      if (key === '') {
        send(400, errorBody('InvalidRequest', 'no object key'));
        return;
      }

      const injected = failures.get(key);
      if (injected !== undefined) {
        send(injected, errorBody(FAILURE_CODES[injected] ?? 'InternalError', 'injected failure'));
        return;
      }

      switch (request.method) {
        case 'PUT': {
          objects.set(key, {
            body,
            contentType: String(request.headers['content-type'] ?? 'application/octet-stream'),
          });
          send(200, '', { etag: `"${createHash('md5').update(body).digest('hex')}"` });
          return;
        }
        case 'GET':
        case 'HEAD': {
          const stored = objects.get(key);
          if (stored === undefined) {
            send(404, errorBody('NoSuchKey', 'the specified key does not exist'));
            return;
          }
          send(200, stored.body, {
            'content-type': stored.contentType,
            etag: `"${createHash('md5').update(stored.body).digest('hex')}"`,
          });
          return;
        }
        case 'DELETE': {
          objects.delete(key);
          send(204);
          return;
        }
        default:
          send(405, errorBody('MethodNotAllowed', 'unsupported method'));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    bucket,
    objects,
    failures,
    requests,
    get maxKeys() {
      return state.maxKeys;
    },
    set maxKeys(value: number) {
      state.maxKeys = value;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
