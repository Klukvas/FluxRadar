// Whether this deployment may substitute a fake mailbox for the real one.
//
// `MockMailer` answers `sent` to everything and delivers nothing. That is
// exactly right in a test and exactly wrong anywhere a person is waiting for a
// verification link, because the two are indistinguishable from the outside: the
// API reports success, the browser says "check your inbox", the operator's logs
// say the message went out, and nothing arrives.
//
// It used to be chosen by `NODE_ENV !== 'production'`, which reads as "only
// outside production" but really means "everywhere the variable is not literally
// the string production" — a staging deploy, a container that never set it, a
// typo. Every one of those became a deployment that silently swallowed its own
// email while reporting success.
//
// So the fake mailbox is now opt-in and defaults to off, on the same pattern as
// the MockPaddle surface (billing/mock-checkout.ts): the automated test run gets
// it because NODE_ENV=test says so, a developer gets it by asking for it by
// name, and everything else gets the configured provider or an honest
// `not-configured`.

const MOCK_EMAIL_ENV = 'FLUXRADAR_ENABLE_MOCK_EMAIL';

export { MOCK_EMAIL_ENV };

/**
 * True only for an explicit `FLUXRADAR_ENABLE_MOCK_EMAIL=true`. Anything else —
 * unset, empty, "1", "yes" — is off.
 *
 * It reads the flag and nothing else, deliberately: where the flag is ALLOWED to
 * have an effect is a separate decision, taken by `usesMockMailbox` below (which
 * requires `development`) and by `validateRuntimeConfig`, which refuses to boot a
 * production deployment that set it (integrations/config.ts). A flag that
 * silently ignored itself in production could not be refused at boot.
 */
export function isMockEmailOptIn(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[MOCK_EMAIL_ENV] ?? '').trim().toLowerCase() === 'true';
}

/**
 * Which mailbox this environment gets.
 *
 * `test` is the automated suite: deterministic and offline by definition, and a
 * real send there would be a bug of its own. `development` may ask for the fake
 * mailbox explicitly. Every other value — `staging`, `production`, and the empty
 * string a container forgot to set — is a place where people read what we send,
 * so it never gets a fake one: it gets the configured provider, or nothing.
 */
export function usesMockMailbox(env: NodeJS.ProcessEnv = process.env): boolean {
  const nodeEnv = (env.NODE_ENV ?? '').trim();
  if (nodeEnv === 'test') return true;
  return nodeEnv === 'development' && isMockEmailOptIn(env);
}
