import { createHash } from 'node:crypto';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { z } from 'zod';

export type GoogleAuthConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly frontendOrigin: string;
};

export type GoogleIdentity = { readonly subject: string; readonly email: string };

export class GoogleEmailAuthorityError extends Error {}

export interface GoogleLoginProvider {
  authorizationUrl(state: string, nonce: string, challenge: string): string;
  exchange(code: string, verifier: string, nonceHash: string, now: Date): Promise<GoogleIdentity>;
}

function safeUrl(value: string, originOnly: boolean): URL {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(process.env.NODE_ENV !== 'production' && local && url.protocol === 'http:')) ||
    (originOnly && url.pathname !== '/')
  )
    throw new Error('Unsafe Google login URL configuration');
  return url;
}

/** Entirely absent settings disable login; partial or unsafe settings fail at app construction. */
export function readGoogleAuthConfig(frontendOrigin: string): GoogleAuthConfig | null {
  const enabled = process.env.GOOGLE_LOGIN_ENABLED;
  if (enabled !== undefined && enabled !== '' && enabled !== 'true' && enabled !== 'false') {
    throw new Error('GOOGLE_LOGIN_ENABLED must be true or false');
  }
  if (enabled === 'false') return null;
  const clientId = process.env.GOOGLE_LOGIN_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.GOOGLE_LOGIN_CLIENT_SECRET?.trim() ?? '';
  const redirectUri = process.env.GOOGLE_LOGIN_REDIRECT_URI?.trim() ?? '';
  if (!clientId && !clientSecret && !redirectUri) return null;
  if (!clientId.endsWith('.apps.googleusercontent.com') || !clientSecret || !redirectUri) {
    throw new Error('Google login requires client ID, client secret and redirect URI');
  }
  const callback = safeUrl(redirectUri, false);
  if (!['/auth/google/callback', '/api/auth/google/callback'].includes(callback.pathname))
    throw new Error('Invalid Google login callback path');
  const frontend = safeUrl(frontendOrigin, true);
  return {
    clientId,
    clientSecret,
    redirectUri: callback.toString(),
    frontendOrigin: frontend.origin,
  };
}

const claimsSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.email().max(254),
  email_verified: z.literal(true),
  nonce: z.string().min(1),
  aud: z.string(),
  azp: z.string().optional(),
  hd: z.string().min(1).max(253).optional(),
  iss: z.enum(['accounts.google.com', 'https://accounts.google.com']),
  exp: z.number(),
  iat: z.number(),
});

export function createGoogleLoginProvider(config: GoogleAuthConfig): GoogleLoginProvider {
  const client = new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    transporterOptions: { timeout: 10_000, retry: false },
  });
  return {
    authorizationUrl: (state, nonce, challenge) =>
      client.generateAuthUrl({
        scope: ['openid', 'email'],
        access_type: 'online',
        prompt: 'select_account',
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: CodeChallengeMethod.S256,
      }),
    exchange: async (code, verifier, nonceHash, now) => {
      const { tokens } = await client.getToken({ code, codeVerifier: verifier });
      if (!tokens.id_token) throw new Error('Missing Google ID token');
      // Google's official verifier checks the signature, issuer, audience and token lifetime.
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: config.clientId,
      });
      const claims = claimsSchema.parse(ticket.getPayload());
      if (
        createHash('sha256').update(claims.nonce).digest('hex') !== nonceHash ||
        claims.aud !== config.clientId ||
        (claims.azp !== undefined && claims.azp !== config.clientId) ||
        claims.exp <= now.getTime() / 1000 ||
        claims.iat > now.getTime() / 1000 + 60
      ) {
        throw new Error('Invalid Google identity claims');
      }
      const email = claims.email.toLowerCase();
      const domain = email.split('@')[1];
      // Google explicitly does not vouch for ongoing ownership of third-party addresses.
      if (
        domain !== 'gmail.com' &&
        (claims.hd === undefined || claims.hd.toLowerCase() !== domain)
      ) {
        throw new GoogleEmailAuthorityError('Google is not authoritative for this email');
      }
      return { subject: claims.sub, email };
    },
  };
}
