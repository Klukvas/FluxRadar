import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGoogleLoginProvider,
  GoogleEmailAuthorityError,
  readGoogleAuthConfig,
} from './google-provider.ts';

const config = {
  clientId: 'test.apps.googleusercontent.com',
  clientSecret: 'test-only',
  redirectUri: 'http://localhost:3310/auth/google/callback',
  frontendOrigin: 'http://localhost:5174',
};
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const now = new Date();
const nonce = 'test-nonce';
const nonceHash = createHash('sha256').update(nonce).digest('hex');
const payload = {
  sub: 'google-subject',
  email: 'owner@gmail.com',
  email_verified: true,
  nonce,
  aud: config.clientId,
  iss: 'https://accounts.google.com',
  iat: Math.floor(now.getTime() / 1000),
  exp: Math.floor(now.getTime() / 1000) + 3600,
};

function token(overrides: Record<string, unknown> = {}, wrongKey = false): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify({ ...payload, ...overrides })).toString('base64url');
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${body}`),
    wrongKey ? generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey : privateKey,
  );
  return `${header}.${body}.${signature.toString('base64url')}`;
}

function providerFor(idToken: string) {
  vi.spyOn(OAuth2Client.prototype, 'getToken').mockImplementation((() =>
    Promise.resolve({
      tokens: { id_token: idToken },
      res: null,
    })) as OAuth2Client['getToken']);
  vi.spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync').mockResolvedValue({
    certs: { 'test-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    format: 'PEM' as Awaited<ReturnType<OAuth2Client['getFederatedSignonCertsAsync']>>['format'],
  });
  return createGoogleLoginProvider(config);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Google ID token verification with real offline signatures', () => {
  it('exchanges the server code with PKCE and accepts a signed authoritative identity', async () => {
    const provider = providerFor(token());
    expect(await provider.exchange('auth-code', 'pkce-verifier', nonceHash, now)).toEqual({
      subject: 'google-subject',
      email: 'owner@gmail.com',
    });
    expect(OAuth2Client.prototype.getToken).toHaveBeenCalledWith({
      code: 'auth-code',
      codeVerifier: 'pkce-verifier',
    });
    const url = new URL(provider.authorizationUrl('state', nonce, 'challenge'));
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(url.searchParams.get('nonce')).toBe(nonce);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
  });

  it.each([
    ['audience', { aud: 'attacker-client' }],
    ['issuer', { iss: 'https://attacker.example' }],
    ['expiry', { exp: Math.floor(now.getTime() / 1000) - 600 }],
    ['nonce', { nonce: 'other' }],
    ['unverified email', { email_verified: false }],
    ['missing subject', { sub: '' }],
    ['authorized party', { azp: 'other-client' }],
  ])('rejects incorrect %s', async (_name, overrides) => {
    await expect(
      providerFor(token(overrides)).exchange('code', 'verifier', nonceHash, now),
    ).rejects.toThrow();
  });

  it('rejects an invalid signature', async () => {
    await expect(
      providerFor(token({}, true)).exchange('code', 'verifier', nonceHash, now),
    ).rejects.toThrow();
  });

  it('refuses non-authoritative third-party email even if email_verified is true', async () => {
    await expect(
      providerFor(token({ email: 'owner@example.com' })).exchange(
        'code',
        'verifier',
        nonceHash,
        now,
      ),
    ).rejects.toBeInstanceOf(GoogleEmailAuthorityError);
  });

  it('accepts signed Workspace authority', async () => {
    expect(
      await providerFor(token({ email: 'owner@example.com', hd: 'example.com' })).exchange(
        'code',
        'verifier',
        nonceHash,
        now,
      ),
    ).toEqual({ subject: 'google-subject', email: 'owner@example.com' });
  });
});

describe('Google configuration', () => {
  it('is disabled when keys are absent and rejects a partial configuration', () => {
    vi.stubEnv('GOOGLE_LOGIN_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_LOGIN_CLIENT_SECRET', '');
    vi.stubEnv('GOOGLE_LOGIN_REDIRECT_URI', '');
    expect(readGoogleAuthConfig(config.frontendOrigin)).toBeNull();
    vi.stubEnv('GOOGLE_LOGIN_CLIENT_ID', config.clientId);
    expect(() => readGoogleAuthConfig(config.frontendOrigin)).toThrow();
  });

  it.each([
    'https://api.example/auth/google/callback?next=evil',
    'https://user:pass@api.example/auth/google/callback',
    'https://api.example/wrong',
    'http://api.example/auth/google/callback',
  ])('rejects unsafe callback %s', (redirect) => {
    vi.stubEnv('GOOGLE_LOGIN_CLIENT_ID', config.clientId);
    vi.stubEnv('GOOGLE_LOGIN_CLIENT_SECRET', config.clientSecret);
    vi.stubEnv('GOOGLE_LOGIN_REDIRECT_URI', redirect);
    expect(() => readGoogleAuthConfig(config.frontendOrigin)).toThrow();
  });

  it('accepts exactly the public production proxy callback', () => {
    vi.stubEnv('GOOGLE_LOGIN_CLIENT_ID', config.clientId);
    vi.stubEnv('GOOGLE_LOGIN_CLIENT_SECRET', config.clientSecret);
    vi.stubEnv('GOOGLE_LOGIN_REDIRECT_URI', 'https://fluxradar.net/api/auth/google/callback');
    expect(readGoogleAuthConfig('https://fluxradar.net')?.redirectUri).toBe(
      'https://fluxradar.net/api/auth/google/callback',
    );
  });

  it('can disable Google without touching stored credentials, even if configuration is partial', () => {
    vi.stubEnv('GOOGLE_LOGIN_ENABLED', 'false');
    vi.stubEnv('GOOGLE_LOGIN_CLIENT_ID', config.clientId);
    vi.stubEnv('GOOGLE_LOGIN_REDIRECT_URI', 'https://example.com/wrong');
    expect(readGoogleAuthConfig(config.frontendOrigin)).toBeNull();
  });

  it.each(['TRUE', '0', 'false '])('rejects invalid disable switch %s', (enabled) => {
    vi.stubEnv('GOOGLE_LOGIN_ENABLED', enabled);
    expect(() => readGoogleAuthConfig(config.frontendOrigin)).toThrow('GOOGLE_LOGIN_ENABLED');
  });

  it('requires HTTPS even on localhost in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('GOOGLE_LOGIN_CLIENT_ID', config.clientId);
    vi.stubEnv('GOOGLE_LOGIN_CLIENT_SECRET', config.clientSecret);
    vi.stubEnv('GOOGLE_LOGIN_REDIRECT_URI', config.redirectUri);
    expect(() => readGoogleAuthConfig(config.frontendOrigin)).toThrow();
  });
});
