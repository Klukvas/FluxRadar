// What the sign-in, registration and password-reset forms check before they
// send anything.
//
// The API validates the same fields and answers a bad request with a 400 whose
// message is a summary written for developers ("email: Invalid email address;
// password: Too small: expected string to have >=1 characters"). The form used
// to put that sentence in front of the visitor as it was. Checking here first
// means the common mistakes (an empty field, a typo in the address, a short
// new password) get a plain sentence in the reader's language, and the
// server's wording is never shown.
//
// The limits mirror registerInputSchema / loginInputSchema in
// packages/contracts/src/api.ts. The web app does not depend on that package,
// so they are restated here; the server stays the authority.

export const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72;
const EMAIL_MAX_LENGTH = 254;

// Deliberately loose: one @, something on each side, a dot in the domain and
// no spaces. Anything stricter belongs to the server, which has the final say.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AuthFormKind = 'login' | 'register' | 'forgot' | 'reset';

export type AuthFieldProblem =
  'emailMissing' | 'emailInvalid' | 'passwordMissing' | 'passwordTooShort' | 'passwordTooLong';

function emailProblem(email: string): AuthFieldProblem | null {
  const trimmed = email.trim();
  if (trimmed.length === 0) return 'emailMissing';
  if (trimmed.length > EMAIL_MAX_LENGTH || !EMAIL_SHAPE.test(trimmed)) return 'emailInvalid';
  return null;
}

function passwordProblem(password: string, isNewPassword: boolean): AuthFieldProblem | null {
  if (password.length === 0) return 'passwordMissing';
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return 'passwordTooLong';
  if (isNewPassword && password.length < PASSWORD_MIN_LENGTH) return 'passwordTooShort';
  return null;
}

/** The first problem with what was typed, or null when the form may be sent. */
export function authFormProblem(input: {
  readonly kind: AuthFormKind;
  readonly email: string;
  readonly password: string;
}): AuthFieldProblem | null {
  const checksEmail = input.kind !== 'reset';
  const checksPassword = input.kind !== 'forgot';
  const email = checksEmail ? emailProblem(input.email) : null;
  if (email !== null) return email;
  return checksPassword ? passwordProblem(input.password, input.kind !== 'login') : null;
}
