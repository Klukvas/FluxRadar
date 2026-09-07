// Minimal SigV4 client for Hetzner Object Storage (Ceph RGW).
//
// The application already talks to the same bucket through @aws-sdk/client-s3
// (apps/api/src/integrations/s3.ts). The backup path deliberately does NOT: it
// has to run from a cron job on the host, from inside whichever image happens to
// be current, and during an incident when the application may be the thing that
// is broken. A dependency-free client that only needs `node:https` keeps the
// restore path independent of the application's node_modules.
//
// Two conventions are copied from the application client and matter:
//   * path-style addressing (`/<bucket>/<key>`) — Ceph does not do virtual-host
//     buckets, and the AWS default would produce a URL that silently 404s;
//   * no ServerSideEncryption header — Ceph answers NotImplemented (HTTP 501).
//     Backups are encrypted by archive-crypto.cjs before they are uploaded, so
//     the bucket only ever holds ciphertext anyway.
//
// Streaming, not buffering: a dump is uploaded straight from the file with a
// known Content-Length and its payload hash computed in a prior pass, so a large
// database never has to fit in the Node heap.

const { createHash, createHmac } = require('node:crypto');
const { createReadStream, createWriteStream, statSync } = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { pipeline } = require('node:stream/promises');

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

/** RFC 3986 encoding; S3 signing rejects the looser encodeURIComponent set. */
function uriEncode(value, encodeSlash) {
  return [...Buffer.from(value, 'utf8')]
    .map((byte) => {
      const char = String.fromCharCode(byte);
      if (/[A-Za-z0-9\-._~]/.test(char)) return char;
      if (char === '/' && !encodeSlash) return char;
      return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
}

function amzDate(now) {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function signingKey(secretKey, dateStamp, region) {
  const kDate = createHmac('sha256', `AWS4${secretKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(SERVICE).digest();
  return createHmac('sha256', kService).update('aws4_request').digest();
}

/**
 * Endpoints must be HTTPS: a backup is the one payload where a downgrade would
 * hand over every customer record on the wire. The single exception is a
 * loopback host, which is how the test suite runs the real signing and transport
 * code against a stub bucket — it cannot leave the machine, so it cannot leak.
 */
function assertEndpoint(url) {
  if (url.protocol === 'https:') return;
  const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol === 'http:' && isLoopback) return;
  throw new Error(
    `HETZNER_S3_ENDPOINT must be an https:// URL (got "${url.protocol}//${url.hostname}")`,
  );
}

class S3Client {
  constructor(options) {
    this.endpoint = new URL(options.endpoint);
    assertEndpoint(this.endpoint);
    this.region = options.region;
    this.bucket = options.bucket;
    this.accessKey = options.accessKey;
    this.secretKey = options.secretKey;
    this.now = options.now ?? (() => new Date());
    this.transport = this.endpoint.protocol === 'http:' ? http : https;
  }

  /** Signs one request and returns the headers it must be sent with. */
  signedHeaders(method, canonicalPath, query, payloadSha256, extraHeaders, contentLength) {
    const now = this.now();
    const stamp = amzDate(now);
    const dateStamp = stamp.slice(0, 8);
    const headers = {
      host: this.endpoint.host,
      'x-amz-content-sha256': payloadSha256,
      'x-amz-date': stamp,
      ...extraHeaders,
    };
    if (contentLength !== undefined) headers['content-length'] = String(contentLength);
    const canonicalHeaderNames = Object.keys(headers)
      .map((name) => name.toLowerCase())
      .sort();
    const canonicalHeaders = canonicalHeaderNames
      .map((name) => `${name}:${String(headers[name]).trim()}\n`)
      .join('');
    const signedHeaderList = canonicalHeaderNames.join(';');
    const canonicalQuery = [...query.entries()]
      .map(([key, value]) => [uriEncode(key, true), uriEncode(value, true)])
      .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    const canonicalRequest = [
      method,
      canonicalPath,
      canonicalQuery,
      canonicalHeaders,
      signedHeaderList,
      payloadSha256,
    ].join('\n');
    const scope = `${dateStamp}/${this.region}/${SERVICE}/aws4_request`;
    const stringToSign = [
      ALGORITHM,
      stamp,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const signature = createHmac('sha256', signingKey(this.secretKey, dateStamp, this.region))
      .update(stringToSign)
      .digest('hex');
    return {
      headers: {
        ...headers,
        authorization:
          `${ALGORITHM} Credential=${this.accessKey}/${scope}, ` +
          `SignedHeaders=${signedHeaderList}, Signature=${signature}`,
      },
      canonicalQuery,
    };
  }

  request(method, canonicalPath, query, payloadSha256, options = {}) {
    const { headers, canonicalQuery } = this.signedHeaders(
      method,
      canonicalPath,
      query,
      payloadSha256,
      options.headers ?? {},
      options.contentLength,
    );
    const path = canonicalQuery === '' ? canonicalPath : `${canonicalPath}?${canonicalQuery}`;
    return new Promise((resolve, reject) => {
      const request = this.transport.request(
        {
          protocol: this.endpoint.protocol,
          hostname: this.endpoint.hostname,
          port: this.endpoint.port === '' ? undefined : Number(this.endpoint.port),
          method,
          path,
          headers,
        },
        (response) => resolve(response),
      );
      request.on('error', reject);
      if (options.body === undefined) {
        request.end();
        return;
      }
      pipeline(options.body, request).catch(reject);
    });
  }

  keyPath(key) {
    return `/${uriEncode(this.bucket, true)}/${uriEncode(key, false)}`;
  }

  /**
   * Reads the whole response body. Only used for error bodies and for
   * ListObjectsV2, both of which are small; object downloads stream to disk.
   */
  static async collect(response) {
    const chunks = [];
    for await (const chunk of response) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  }

  /**
   * S3 error bodies name the bucket and sometimes the key, but never a
   * credential. The status and the provider's error code are what an operator
   * needs; the body is included because a Ceph-specific code (NotImplemented,
   * for one) is otherwise invisible.
   */
  static async failure(operation, key, response) {
    const body = await S3Client.collect(response);
    const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? 'unknown';
    const error = new Error(
      `S3 ${operation} failed for "${key}": HTTP ${response.statusCode} (${code})`,
    );
    // Carried as fields, not left for a caller to parse back out of the message:
    // "the object is not there" (404) and "the bucket refused me" (403, 5xx, a
    // reset connection) look identical in a `catch` otherwise, and a caller that
    // cannot tell them apart treats a broken bucket as an empty one.
    error.statusCode = response.statusCode;
    error.code = code;
    return error;
  }

  async putFile(key, path, contentType, payloadSha256) {
    const contentLength = statSync(path).size;
    const response = await this.request(
      'PUT',
      this.keyPath(key),
      new URLSearchParams(),
      payloadSha256,
      {
        body: createReadStream(path),
        contentLength,
        headers: { 'content-type': contentType },
      },
    );
    if (response.statusCode !== 200) throw await S3Client.failure('PUT', key, response);
    const etag = (response.headers.etag ?? '').replaceAll('"', '');
    response.resume();
    return { etag, bytes: contentLength };
  }

  async putText(key, body, contentType) {
    const buffer = Buffer.from(body, 'utf8');
    const response = await this.request(
      'PUT',
      this.keyPath(key),
      new URLSearchParams(),
      createHash('sha256').update(buffer).digest('hex'),
      {
        body: (async function* single() {
          yield buffer;
        })(),
        contentLength: buffer.length,
        headers: { 'content-type': contentType },
      },
    );
    if (response.statusCode !== 200) throw await S3Client.failure('PUT', key, response);
    const etag = (response.headers.etag ?? '').replaceAll('"', '');
    response.resume();
    return { etag, bytes: buffer.length };
  }

  async headObject(key) {
    const response = await this.request(
      'HEAD',
      this.keyPath(key),
      new URLSearchParams(),
      EMPTY_SHA256,
    );
    response.resume();
    if (response.statusCode === 404) return null;
    if (response.statusCode !== 200) throw await S3Client.failure('HEAD', key, response);
    return {
      bytes: Number(response.headers['content-length'] ?? 0),
      etag: (response.headers.etag ?? '').replaceAll('"', ''),
    };
  }

  async getFile(key, path) {
    const response = await this.request(
      'GET',
      this.keyPath(key),
      new URLSearchParams(),
      EMPTY_SHA256,
    );
    if (response.statusCode !== 200) throw await S3Client.failure('GET', key, response);
    await pipeline(response, createWriteStream(path, { mode: 0o600 }));
    return { bytes: statSync(path).size };
  }

  async getText(key) {
    const response = await this.request(
      'GET',
      this.keyPath(key),
      new URLSearchParams(),
      EMPTY_SHA256,
    );
    if (response.statusCode !== 200) throw await S3Client.failure('GET', key, response);
    return S3Client.collect(response);
  }

  async deleteObject(key) {
    const response = await this.request(
      'DELETE',
      this.keyPath(key),
      new URLSearchParams(),
      EMPTY_SHA256,
    );
    response.resume();
    // A delete that finds nothing is a success in S3 and stays one here: the
    // retention plan is allowed to name an object a previous run removed.
    if (response.statusCode !== 204 && response.statusCode !== 200 && response.statusCode !== 404) {
      throw await S3Client.failure('DELETE', key, response);
    }
  }

  /** Every key under `prefix`, following continuation tokens to the end. */
  async listObjects(prefix) {
    const objects = [];
    let token;
    // A server that keeps returning the same continuation token would otherwise
    // spin here forever, and this listing is what the retention sweep reads.
    const seenTokens = new Set();
    do {
      const query = new URLSearchParams({ 'list-type': '2', prefix });
      if (token !== undefined) query.set('continuation-token', token);
      const response = await this.request(
        'GET',
        `/${uriEncode(this.bucket, true)}`,
        query,
        EMPTY_SHA256,
      );
      if (response.statusCode !== 200) throw await S3Client.failure('LIST', prefix, response);
      const body = await S3Client.collect(response);
      for (const match of body.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const entry = match[1];
        const key = /<Key>([\s\S]*?)<\/Key>/.exec(entry)?.[1];
        if (key === undefined) continue;
        objects.push({
          key: decodeXmlText(key),
          bytes: Number(/<Size>(\d+)<\/Size>/.exec(entry)?.[1] ?? 0),
          lastModified: /<LastModified>([^<]+)<\/LastModified>/.exec(entry)?.[1] ?? null,
        });
      }
      const truncated = /<IsTruncated>([^<]+)<\/IsTruncated>/.exec(body)?.[1] === 'true';
      token = truncated
        ? (/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(body)?.[1] ??
          undefined)
        : undefined;
      if (truncated && token === undefined) {
        throw new Error('S3 LIST reported more results but returned no continuation token');
      }
      if (token !== undefined) {
        if (seenTokens.has(token)) {
          throw new Error('S3 LIST repeated a continuation token; the listing cannot be trusted');
        }
        seenTokens.add(token);
      }
    } while (token !== undefined);
    return objects;
  }
}

function decodeXmlText(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

module.exports = { S3Client, EMPTY_SHA256, uriEncode };
