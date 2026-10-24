// What an error report may carry out of this process.
//
// A log line is written for an operator who can already read the database;
// an error report goes to a third party. Every event leaves through Sentry's
// `beforeSend`, and that hook runs it through `scrubEvent` below — the one
// place the difference is enforced, for logged errors and uncaught exceptions
// alike.
//
// What is removed, wherever it appears in a message, an exception value or the
// attached context: email addresses, URL credentials, query strings and
// fragments (verification, reset and OAuth links carry their tokens there, and
// PageSpeed requests carry the API key as `key=`), credential-shaped strings,
// the arguments Prisma prints at a failed call site, the database's echo of a
// conflicting value, and the slice of a request body JSON.parse quotes when it
// refuses one. What is kept: paths, scan/profile/account ids (internal cuids,
// not personal data) and error names — the parts an operator needs.

import type { ErrorEvent, Exception } from '@sentry/node';

const REDACTED = '[redacted]';

/** Long enough for any message this API writes; short enough that no report body rides along. */
export const MAX_REPORTED_TEXT_LENGTH = 2_000;
/** All the rules ever read: a bound on what one pathological string can cost them. */
const MAX_SCANNED_TEXT_LENGTH = 8_000;
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;

const PRISMA_CALL_SITE = 'Invalid `prisma.';
/** The last blank line: what follows it is Prisma's reason, which names fields, never values. */
const LAST_PARAGRAPH_BREAK = /\n[ \t]*\n(?![\s\S]*\n[ \t]*\n)/;

// The rule list below is kept in step, rule for rule, with the browser's
// apps/web/src/error-monitoring-scrub.ts: a message reads the same in both
// projects. Every quantifier that can meet a long run is bounded, so no rule
// costs more than linear time on what `bounded` lets through.

/** A key's prefix or suffix (`resetToken`, `x_api_key`), bounded so a long run is cheap to reject. */
const KEY_AFFIX = '[\\w-]{0,40}?';
/** Key names whose value is a credential however it is written: `k=v`, `k: v`, `"k":"v"`. */
// A key-named secret (`private_key`, `encryptionKey`) counts; a bare `key` does
// not, so `objectKey` in a storage error stays readable.
const CREDENTIAL_KEY = `${KEY_AFFIX}(?:password|passwd|passphrase|secret|token|api[_-]?key|(?:private|encryption|access|secret|signing)[_-]?key|authorization)`;
/** A value: double- or single-quoted, escapes honoured, or bare. */
const VALUE = `(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|[^\\s"',;&#]+)`;
const JSON_VALUE = `(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|[^,}\\s]+)`;
/** Already redacted, or an auth scheme the Bearer/Basic rule below handles with its value. */
const NOT_YET_REDACTED = '(?!\\[redacted\\]|(?:Bearer|Basic|Token)\\b)';

/**
 * Applied in this order. URL credentials go before emails, so `user:pass@host`
 * is not half-read as an address, and the auth schemes keep their own rule so
 * `Authorization: Bearer …` keeps the word that says what was withheld.
 */
const TEXT_RULES: readonly (readonly [RegExp, string])[] = [
  // V8 quotes the start of the text it could not parse — a request body —
  // sometimes with "..." after the closing quote.
  [/"[\s\S]*"(?:\.\.\.)? is not valid JSON/g, '[input withheld] is not valid JSON'],
  // PostgreSQL's detail for a unique violation repeats the value that collided.
  [/Key \(([^)]*)\)=\([^)]*\)/g, `Key ($1)=(${REDACTED})`],
  // JSON-shaped pairs, double- or single-quoted (util.inspect writes the latter).
  [
    new RegExp(`"(${CREDENTIAL_KEY}[\\w-]{0,40})"\\s*:\\s*${JSON_VALUE}`, 'gi'),
    `"$1":"${REDACTED}"`,
  ],
  [
    new RegExp(`'(${CREDENTIAL_KEY}[\\w-]{0,40})'\\s*:\\s*${JSON_VALUE}`, 'gi'),
    `'$1':'${REDACTED}'`,
  ],
  [/\b([a-z][a-z0-9+.-]{0,30}:\/\/)(?:[^\s/?#@]*@)?([^\s?#]*)(?:\?[^\s#]*)?(?:#\S*)?/gi, '$1$2'],
  [/(^|[\s"'(=])(\/[^\s?#"'=]*)[?#][^\s"']*/g, '$1$2'],
  [
    new RegExp(
      `\\b(${KEY_AFFIX}(?:api[_-]?key|key|token|code|state|password|passwd|passphrase|secret|signature|sig|authorization|e-?mail|session|sid|cookie))(\\s*=\\s*)${NOT_YET_REDACTED}${VALUE}`,
      'gi',
    ),
    `$1$2${REDACTED}`,
  ],
  [
    new RegExp(`\\b(${CREDENTIAL_KEY})(\\s*:\\s*)${NOT_YET_REDACTED}${VALUE}`, 'gi'),
    `$1$2${REDACTED}`,
  ],
  // Only the password-like words take a bare space as the separator: "password
  // hunter2". A sentence that merely mentions one loses a word, which is the
  // cheaper mistake.
  [
    new RegExp(`\\b(password|passwd|passphrase|secret)(\\s+)${NOT_YET_REDACTED}${VALUE}`, 'gi'),
    `$1$2${REDACTED}`,
  ],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}[^\s"',;]*/gi, `$1 ${REDACTED}`],
  // Credential shapes this API holds: Anthropic/OpenAI, Google API keys and
  // OAuth tokens, Resend, Creem, Perplexity, Telegram bot tokens, JWTs, and
  // the bcrypt hashes passwords are stored as.
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, REDACTED],
  [/\bya29\.[0-9A-Za-z_-]+/g, REDACTED],
  [/\b1\/\/[0-9A-Za-z_-]{20,}/g, REDACTED],
  [/\bre_[0-9A-Za-z_]{16,}/g, REDACTED],
  [/\bcreem_[0-9A-Za-z_]{8,}/g, REDACTED],
  [/\bpplx-[0-9A-Za-z]{16,}/g, REDACTED],
  [/\b\d{6,12}:[0-9A-Za-z_-]{30,}/g, REDACTED],
  [/\beyJ[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+/g, REDACTED],
  [/\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}/g, REDACTED],
  // Any script, and URL-encoded too (`anna%40example.com`).
  [
    /[\p{L}\p{N}._%+-]{1,64}(?:@|%40)[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){0,8}\.\p{L}{2,63}/gu,
    '[email]',
  ],
];

/** Any other opaque run long enough to be a key: letters AND digits, 32+ characters. */
const OPAQUE_RUN = /[A-Za-z0-9_+=-]{32,}/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Context keys whose value is never sent, whatever it looks like. */
const SENSITIVE_KEY =
  /password|passwd|passphrase|secret|token|authorization|cookie|session|^sid$|api[-_]?key|credential|^e-?mail$/i;

/** Contexts the SDK fills itself; `trace` holds ids Sentry has to be able to read back. */
const SDK_OWNED_CONTEXTS: ReadonlySet<string> = new Set(['trace']);

/** A copy without `keys`; the original is left as it was. */
function omit<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  const dropped: ReadonlySet<PropertyKey> = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !dropped.has(key))) as Omit<
    T,
    K
  >;
}

function withoutPrismaCallSite(text: string): string {
  const start = text.indexOf(PRISMA_CALL_SITE);
  if (start === -1) return text;
  const tail = text.slice(start);
  const lastBreak = tail.search(LAST_PARAGRAPH_BREAK);
  const reason = lastBreak === -1 ? '' : tail.slice(lastBreak).trim();
  const before = text.slice(0, start).trimEnd();
  const withheld = `Prisma call failed (call site withheld)${reason === '' ? '' : `: ${reason}`}`;
  return before === '' ? withheld : `${before} ${withheld}`;
}

function withoutOpaqueRuns(text: string): string {
  return text.replace(OPAQUE_RUN, (run) =>
    /\d/.test(run) && /[A-Za-z]/.test(run) && !UUID.test(run) ? REDACTED : run,
  );
}

function truncated(text: string): string {
  return text.length <= MAX_REPORTED_TEXT_LENGTH
    ? text
    : `${text.slice(0, MAX_REPORTED_TEXT_LENGTH)}… [truncated]`;
}

/** Cut at a word boundary, so no half of a secret is left at the edge for the rules to miss. */
function bounded(text: string): string {
  return text.length <= MAX_SCANNED_TEXT_LENGTH
    ? text
    : text.slice(0, MAX_SCANNED_TEXT_LENGTH).replace(/\S*$/, '');
}

/** One string as it may leave the process. */
export function scrubText(text: string): string {
  const ruled = TEXT_RULES.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    withoutPrismaCallSite(bounded(text)),
  );
  return truncated(withoutOpaqueRuns(ruled));
}

/** Any context value, rebuilt rather than edited: strings scrubbed, sensitive keys dropped. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === undefined) return undefined;
  if (depth >= MAX_DEPTH) return '[too deep]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return scrubText(`${value.name}: ${value.message}`);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => scrubValue(item, depth + 1));
  }
  if (typeof value === 'object') return scrubRecord(value as Record<string, unknown>, depth + 1);
  return scrubText(String(value));
}

export function scrubRecord(
  record: Readonly<Record<string, unknown>>,
  depth = 0,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : scrubValue(value, depth),
    ]),
  );
}

function scrubException(exception: Exception): Exception {
  const frames = exception.stacktrace?.frames;
  return {
    ...exception,
    ...(exception.value === undefined ? {} : { value: scrubText(exception.value) }),
    ...(frames === undefined
      ? {}
      : {
          // Frames keep file, line and source context — this repository's code,
          // not anyone's data — and lose local variables, which could be anything.
          stacktrace: {
            ...exception.stacktrace,
            frames: frames.map((frame) => omit(frame, ['vars'])),
          },
        }),
  };
}

function scrubContexts(contexts: NonNullable<ErrorEvent['contexts']>): ErrorEvent['contexts'] {
  return Object.fromEntries(
    Object.entries(contexts).map(([name, context]) => [
      name,
      SDK_OWNED_CONTEXTS.has(name) || context === undefined ? context : scrubRecord(context),
    ]),
  ) as ErrorEvent['contexts'];
}

/**
 * The event as it may be sent. Breadcrumbs, request data and user data are
 * dropped outright: nothing in this API adds them on purpose, so anything
 * there arrived by accident.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const rest = omit(event, ['breadcrumbs', 'request', 'user']);
  return {
    ...rest,
    ...(rest.message === undefined ? {} : { message: scrubText(rest.message) }),
    ...(rest.logentry === undefined
      ? {}
      : {
          logentry: {
            ...(rest.logentry.message === undefined
              ? {}
              : { message: scrubText(rest.logentry.message) }),
            ...(rest.logentry.params === undefined
              ? {}
              : { params: rest.logentry.params.map((param) => scrubValue(param)) }),
          },
        }),
    ...(rest.exception?.values === undefined
      ? {}
      : { exception: { values: rest.exception.values.map(scrubException) } }),
    ...(rest.extra === undefined ? {} : { extra: scrubRecord(rest.extra) }),
    ...(rest.contexts === undefined ? {} : { contexts: scrubContexts(rest.contexts) }),
    ...(rest.tags === undefined
      ? {}
      : {
          tags: Object.fromEntries(
            Object.entries(rest.tags).map(([key, value]) => [
              key,
              typeof value === 'string' ? scrubText(value) : value,
            ]),
          ),
        }),
  };
}
