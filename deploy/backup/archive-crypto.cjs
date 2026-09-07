// Backup archive encryption.
//
// A PostgreSQL dump of FluxRadar is the single most sensitive artifact this
// deployment produces: password hashes, session rows, buyer records and every
// scan a customer paid for. It leaves the server for Hetzner Object Storage, so
// it is encrypted BEFORE it is written anywhere but the work directory, with a
// key that lives only in the production environment file — never in the bucket,
// never in the repository, never in a workflow log.
//
// AES-256-GCM, streaming, one authentication tag over the whole archive:
//
//   magic "FRBK1\n" | version(1) | iv(12) | ciphertext(...) | tag(16)
//
// GCM is authenticated: a truncated upload, a flipped byte or a re-encrypted
// object fails to decrypt instead of producing a dump that restores into
// plausible-looking corruption. The tag is at the end because it is only known
// once the last byte is encrypted; decryption seeks to it first, which is why
// this module works on files rather than on pipes.
//
// CommonJS on purpose: these scripts are executed by a bare `node <file>`, both
// on the host and inside an image whose package.json declares `"type": "module"`.

const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('node:crypto');
const { createReadStream, createWriteStream, statSync } = require('node:fs');
const { pipeline } = require('node:stream/promises');

const MAGIC = Buffer.from('FRBK1\n', 'ascii');
const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = MAGIC.length + 1 + IV_LENGTH;
const KEY_LENGTH = 32;

/** The variable that carries the key; named in errors, never printed. */
const KEY_ENV_VAR = 'FLUXRADAR_BACKUP_ENCRYPTION_KEY';

/**
 * Parses the 32-byte key from its base64 form.
 *
 * Every failure here is reported by variable NAME and by what is wrong with the
 * shape (length, encoding) — never by echoing the value, which would put the key
 * that protects every backup into a cron mail or a workflow log.
 */
function parseKey(value) {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') {
    throw new Error(`${KEY_ENV_VAR} is not set; refusing to write an unencrypted backup`);
  }
  let decoded;
  try {
    decoded = Buffer.from(trimmed, 'base64');
  } catch {
    throw new Error(`${KEY_ENV_VAR} is not valid base64`);
  }
  // Buffer.from is lenient: it ignores what it cannot decode instead of
  // throwing, so a truncated or mistyped key would silently become a shorter
  // one. The length check is what actually rejects it.
  if (decoded.length !== KEY_LENGTH) {
    throw new Error(
      `${KEY_ENV_VAR} must be ${KEY_LENGTH} base64-encoded bytes (got ${decoded.length}); ` +
        "generate one with: node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  return decoded;
}

/** Reads the key from the environment, so no caller has to touch the raw value. */
function readKeyFromEnv(env = process.env) {
  return parseKey(env[KEY_ENV_VAR]);
}

/** sha256 and md5 of a file, in one pass; md5 is what an S3 ETag is compared to. */
async function digestFile(path) {
  const sha256 = createHash('sha256');
  const md5 = createHash('md5');
  for await (const chunk of createReadStream(path)) {
    sha256.update(chunk);
    md5.update(chunk);
  }
  return {
    sha256: sha256.digest('hex'),
    md5: md5.digest('hex'),
    bytes: statSync(path).size,
  };
}

/** Encrypts `sourcePath` into `targetPath`; returns what was written. */
async function encryptFile(sourcePath, targetPath, key) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const target = createWriteStream(targetPath, { mode: 0o600 });
  target.write(Buffer.concat([MAGIC, Buffer.from([VERSION]), iv]));
  await pipeline(createReadStream(sourcePath), cipher, target, { end: false });
  const tag = cipher.getAuthTag();
  await new Promise((resolve, reject) => {
    target.end(tag, (error) => (error ? reject(error) : resolve()));
  });
  return { bytes: statSync(targetPath).size };
}

function readExactly(path, start, end) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    createReadStream(path, { start, end })
      .on('data', (chunk) => chunks.push(chunk))
      .on('error', reject)
      .on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Decrypts `sourcePath` into `targetPath`.
 *
 * Fails — loudly, before anything is restored — on a wrong key, a truncated
 * archive, a foreign file or a single flipped byte, because the GCM tag covers
 * the whole ciphertext and `decipher.final()` verifies it.
 */
async function decryptFile(sourcePath, targetPath, key) {
  const size = statSync(sourcePath).size;
  if (size < HEADER_LENGTH + TAG_LENGTH) {
    throw new Error('backup archive is truncated: it is smaller than its own header and tag');
  }
  const header = await readExactly(sourcePath, 0, HEADER_LENGTH - 1);
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('backup archive is not a FluxRadar encrypted archive (bad magic)');
  }
  const version = header[MAGIC.length];
  if (version !== VERSION) {
    throw new Error(`unsupported backup archive version ${version}; this tool writes v${VERSION}`);
  }
  const iv = header.subarray(MAGIC.length + 1);
  const tag = await readExactly(sourcePath, size - TAG_LENGTH, size - 1);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  await pipeline(
    createReadStream(sourcePath, { start: HEADER_LENGTH, end: size - TAG_LENGTH - 1 }),
    decipher,
    createWriteStream(targetPath, { mode: 0o600 }),
  );
  return { bytes: statSync(targetPath).size };
}

module.exports = {
  KEY_ENV_VAR,
  KEY_LENGTH,
  decryptFile,
  digestFile,
  encryptFile,
  parseKey,
  readKeyFromEnv,
};
