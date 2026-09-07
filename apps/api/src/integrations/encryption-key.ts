// The key that encrypts every user integration token at rest.
//
// One reader, so the runtime, the boot check and the tests cannot disagree about
// what a usable key is. It follows the same three-state shape as the other
// integration readers, except that this one is never `not_configured` in
// production: an absent key does not turn a feature off, it makes every stored
// Google/Bing token undecryptable.
//
// Two rules, and the second one is the reason this file exists:
//
//   1. In production the key must be stated. There is no fallback. A deployment
//      that silently derived it from another secret would tie the lifetime of
//      every stored OAuth token to that secret — rotating the other one would
//      lock every connected account out of its own integration, with no error
//      anywhere, because AES-GCM simply fails to authenticate.
//
//   2. In production it must not BE that other secret. `SESSION_SECRET` is the
//      value the development fallback uses, so copying it into
//      INTEGRATION_ENCRYPTION_KEY satisfies rule 1 while reintroducing exactly
//      the coupling rule 1 forbids — and it is the most natural thing to do when
//      filling in an env file from the example. The two secrets protect
//      different things and have to rotate independently.
//
// Development and tests keep the explicit `SESSION_SECRET` fallback so a fresh
// checkout is usable with no extra setup. That path is chosen by NODE_ENV being
// exactly "development" or "test" — an unset NODE_ENV gets no fallback, because
// an unset NODE_ENV in a container is a production process that lost its label.

export const INTEGRATION_ENCRYPTION_KEY_VAR = 'INTEGRATION_ENCRYPTION_KEY';
export const SESSION_SECRET_VAR = 'SESSION_SECRET';

export type IntegrationEncryptionKeyResult =
  | { readonly state: 'configured'; readonly secret: string }
  | { readonly state: 'invalid'; readonly missing: readonly string[]; readonly reason: string };

function trimmed(value: string | undefined): string | null {
  const result = value?.trim() ?? '';
  return result === '' ? null : result;
}

/** True only for the two environments that are allowed the SESSION_SECRET fallback. */
function allowsDevelopmentFallback(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
}

/**
 * The secret to derive the integration key from, or why there is none.
 *
 * `reason` is written for an operator reading a failed boot: it names variables
 * and states what to do about them, and it never contains a value.
 */
export function readIntegrationEncryptionKey(
  env: NodeJS.ProcessEnv = process.env,
): IntegrationEncryptionKeyResult {
  const dedicated = trimmed(env[INTEGRATION_ENCRYPTION_KEY_VAR]);
  const sessionSecret = trimmed(env[SESSION_SECRET_VAR]);

  if (dedicated === null) {
    if (allowsDevelopmentFallback(env) && sessionSecret !== null) {
      return { state: 'configured', secret: sessionSecret };
    }
    return {
      state: 'invalid',
      missing: [INTEGRATION_ENCRYPTION_KEY_VAR],
      reason:
        `${INTEGRATION_ENCRYPTION_KEY_VAR} is required and has no production fallback; ` +
        "generate one with `node -e \"console.log(require('node:crypto')" +
        ".randomBytes(32).toString('base64'))\"`",
    };
  }

  if (!allowsDevelopmentFallback(env) && sessionSecret !== null && dedicated === sessionSecret) {
    return {
      state: 'invalid',
      missing: [INTEGRATION_ENCRYPTION_KEY_VAR],
      reason:
        `${INTEGRATION_ENCRYPTION_KEY_VAR} must not be the same value as ` +
        `${SESSION_SECRET_VAR}: the two protect different things and must rotate ` +
        'independently, and reusing one makes every stored integration token ' +
        `undecryptable the day ${SESSION_SECRET_VAR} changes`,
    };
  }

  return { state: 'configured', secret: dedicated };
}
