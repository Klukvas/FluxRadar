// Static demo previews of the two account emails, rendered through the real
// production template functions (never hand-copied) so this HTML cannot drift
// from what auth/routes.ts actually sends. Run: node email-previews/generate.ts
//
// Links use the reserved .invalid TLD with a fake token — never a real account
// or a reachable address.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderVerificationEmail } from '../src/email/verification-email.ts';
import { renderPasswordResetEmail } from '../src/email/password-reset-email.ts';

const PREVIEW_DIR = fileURLToPath(new URL('.', import.meta.url));

const verification = renderVerificationEmail(
  'https://app.fluxradar.invalid/?verify_email=preview-fake-token-do-not-use',
);
const passwordReset = renderPasswordResetEmail(
  'https://app.fluxradar.invalid/?reset_token=preview-fake-token-do-not-use',
);

writeFileSync(`${PREVIEW_DIR}verification.html`, verification.html);
writeFileSync(`${PREVIEW_DIR}password-reset.html`, passwordReset.html);

console.log('Wrote verification.html and password-reset.html');
