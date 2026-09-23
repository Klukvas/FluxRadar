// Transactional email (Resend) configuration.
//
// Email is optional: with no RESEND_* variable set the API boots, and every
// email-dependent flow reports `not-configured` rather than pretending a message
// was sent. What must not happen quietly is the state in between — a key without
// a sender, or a sender Resend will reject — because there is no error anywhere
// in FluxRadar when that is true. The API accepts the registration, the browser
// is told an email is on its way, and nothing arrives.
//
// So this reader answers the same three states as every other integration, and
// it is the ONE definition of what "configured" means: `createMailer` builds the
// adapter from it and the startup diagnostics report it, instead of the two
// deciding separately and drifting.
//
// Unlike a half-configured OAuth client this does NOT fail the production boot
// (see integrations/config.ts): a deployment that cannot send email can still
// sell and run scans, so it is logged loudly and left running. What is on the
// operator's side — verifying the sending domain in Resend and publishing its
// DNS records — cannot be checked from here at all: an unverified domain is an
// HTTP error on the first send.

export const RESEND_ENV_VARS = {
  apiKey: 'RESEND_API_KEY',
  from: 'RESEND_FROM_EMAIL',
  replyTo: 'RESEND_REPLY_TO',
} as const;

export interface ResendConfig {
  readonly apiKey: string;
  readonly from: string;
  readonly replyTo?: string;
}

export type ResendConfigResult =
  | { readonly state: 'configured'; readonly config: ResendConfig }
  | { readonly state: 'not_configured' }
  | { readonly state: 'invalid'; readonly missing: readonly string[]; readonly reason: string };

/**
 * A sender Resend accepts: a bare address, or a display name in front of one.
 *
 * Deliberately shape-only. Whether the domain is verified on the Resend account
 * is a fact about the provider, not about this file, and the first send is where
 * that shows up — as an HTTP error the caller already reports.
 */
const SENDER_PATTERN =
  /^(?:[^<>]*<\s*[^\s@<>]+@[^\s@<>.]+\.[^\s@<>]+\s*>|[^\s@<>]+@[^\s@<>.]+\.[^\s@<>]+)$/;

function trimmed(value: string | undefined): string | null {
  const result = value?.trim() ?? '';
  return result === '' ? null : result;
}

export function readResendConfig(env: NodeJS.ProcessEnv = process.env): ResendConfigResult {
  const apiKey = trimmed(env[RESEND_ENV_VARS.apiKey]);
  const from = trimmed(env[RESEND_ENV_VARS.from]);
  const replyTo = trimmed(env[RESEND_ENV_VARS.replyTo]);

  if (apiKey === null && from === null) {
    // RESEND_REPLY_TO on its own configures nothing and sends nothing; it is
    // reported so a half-filled block is not mistaken for an unfilled one.
    return replyTo === null
      ? { state: 'not_configured' }
      : {
          state: 'invalid',
          missing: [RESEND_ENV_VARS.apiKey, RESEND_ENV_VARS.from],
          reason:
            `${RESEND_ENV_VARS.replyTo} is set without ${RESEND_ENV_VARS.apiKey} and ` +
            `${RESEND_ENV_VARS.from}, so no email can be sent at all`,
        };
  }

  const missing = [
    ...(apiKey === null ? [RESEND_ENV_VARS.apiKey] : []),
    ...(from === null ? [RESEND_ENV_VARS.from] : []),
  ];
  if (apiKey === null || from === null) {
    return {
      state: 'invalid',
      missing,
      reason: `Transactional email is partially configured; missing: ${missing.join(', ')}`,
    };
  }

  // A sender Resend refuses turns every verification and password-reset link
  // into a message nobody receives, and the only symptom is a customer saying
  // the email never came.
  if (!SENDER_PATTERN.test(from)) {
    return {
      state: 'invalid',
      missing: [RESEND_ENV_VARS.from],
      reason:
        `${RESEND_ENV_VARS.from} must be an address on a domain verified in Resend, as ` +
        '"name@example.com" or "FluxRadar <name@example.com>"',
    };
  }
  if (replyTo !== null && !SENDER_PATTERN.test(replyTo)) {
    return {
      state: 'invalid',
      missing: [RESEND_ENV_VARS.replyTo],
      reason: `${RESEND_ENV_VARS.replyTo} must be an email address, or be left unset`,
    };
  }

  return {
    state: 'configured',
    config: { apiKey, from, ...(replyTo === null ? {} : { replyTo }) },
  };
}
