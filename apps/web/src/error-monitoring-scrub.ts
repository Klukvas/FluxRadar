// What a browser error report may carry, as pure functions.
//
// Email-verification, password-reset and OAuth return links put one-time
// tokens in the query string, so no URL leaves with its query or fragment: not
// the page address, not a navigation, not a request the app made, not a URL
// quoted inside an error message. Credentials written as `key=value`,
// `key: value` or a JSON pair, Bearer/Basic values, JWTs and email addresses
// (in any script, URL-encoded too), provider key shapes and long opaque runs
// are redacted wherever they appear — the same rules, in the same list shape,
// as the API's report-scrub.ts, with the same input bound — in messages,
// exception values, `extra` and contexts alike. Of the breadcrumbs only
// navigations and the app's own fetch/xhr calls are kept; console output and
// clicks can carry anything a visitor typed or saw. Only the User-Agent header
// is kept — it is what tells a report's browser and OS.

import type { Breadcrumb, ErrorEvent, Exception, RequestEventData } from '@sentry/react';

const REDACTED = '[redacted]';
/**
 * What one string may cost: the rules read at most MAX_SCANNED_TEXT_LENGTH
 * characters, on the main thread inside `beforeSend`, and at most
 * MAX_REPORTED_TEXT_LENGTH leave. The SDK's own `maxValueLength` is set to
 * the first (error-monitoring-sentry.ts).
 */
export const MAX_SCANNED_TEXT_LENGTH = 8_000;
export const MAX_REPORTED_TEXT_LENGTH = 2_000;
const KEPT_BREADCRUMB_CATEGORIES: ReadonlySet<string> = new Set(['navigation', 'fetch', 'xhr']);
const KEPT_REQUEST_HEADER = 'User-Agent';

// The rule list below is kept in step, rule for rule, with the API's
// apps/api/src/observability/report-scrub.ts: a message reads the same in both
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
  // V8 quotes the start of the text it could not parse, sometimes with "..."
  // after the closing quote.
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
  // Credential shapes the API holds — Anthropic/OpenAI, Google API keys and
  // OAuth tokens, Resend, Creem, Perplexity, Telegram bot tokens, JWTs, bcrypt
  // hashes — in case one is ever quoted back to the browser.
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

/** An absolute or relative URL without its query string and fragment. */
export function withoutQueryAndHash(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

function withoutOpaqueRuns(text: string): string {
  return text.replace(OPAQUE_RUN, (run) =>
    /\d/.test(run) && /[A-Za-z]/.test(run) && !UUID.test(run) ? REDACTED : run,
  );
}

/** Cut at a word boundary, so no half of a secret is left at the edge for the rules to miss. */
function bounded(text: string): string {
  return text.length <= MAX_SCANNED_TEXT_LENGTH
    ? text
    : text.slice(0, MAX_SCANNED_TEXT_LENGTH).replace(/\S*$/, '');
}

function truncated(text: string): string {
  return text.length <= MAX_REPORTED_TEXT_LENGTH
    ? text
    : `${text.slice(0, MAX_REPORTED_TEXT_LENGTH)}… [truncated]`;
}

/** Free text as it may leave the browser: bounded, scrubbed, truncated, as in the API. */
export function scrubText(text: string): string {
  const ruled = TEXT_RULES.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    bounded(text),
  );
  return truncated(withoutOpaqueRuns(ruled));
}

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
/** Keys whose value is never sent, whatever it looks like — the API's list. */
const SENSITIVE_KEY =
  /password|passwd|passphrase|secret|token|authorization|cookie|session|^sid$|api[-_]?key|credential|^e-?mail$/i;
/** `trace` holds ids Sentry reads back; every other context is scrubbed like `extra`. */
const SDK_OWNED_CONTEXTS: ReadonlySet<string> = new Set(['trace']);

/**
 * Any value of `extra` or a context, rebuilt rather than edited — the API's
 * scrubValue. The SDK puts a non-Error that was thrown or rejected — by this
 * site, a third-party script or an extension — into `extra.__serialized__`
 * as it was, so it is read like a log context: strings scrubbed, sensitive
 * keys dropped, depth and length bounded.
 */
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

function scrubContexts(contexts: NonNullable<ErrorEvent['contexts']>): ErrorEvent['contexts'] {
  return Object.fromEntries(
    Object.entries(contexts).map(([name, context]) => [
      name,
      SDK_OWNED_CONTEXTS.has(name) || context === undefined ? context : scrubRecord(context),
    ]),
  ) as ErrorEvent['contexts'];
}

function scrubbedUrlField(data: Breadcrumb['data'], field: string): Breadcrumb['data'] {
  const value = data?.[field];
  return typeof value === 'string' ? { [field]: withoutQueryAndHash(value) } : {};
}

/** A breadcrumb as it may be kept, or null for every kind this site does not keep. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === undefined || !KEPT_BREADCRUMB_CATEGORIES.has(breadcrumb.category)) {
    return null;
  }
  const data = breadcrumb.data;
  return {
    ...breadcrumb,
    ...(breadcrumb.message === undefined ? {} : { message: scrubText(breadcrumb.message) }),
    ...(data === undefined
      ? {}
      : {
          data: {
            ...data,
            ...scrubbedUrlField(data, 'url'),
            ...scrubbedUrlField(data, 'from'),
            ...scrubbedUrlField(data, 'to'),
          },
        }),
  };
}

function scrubRequest(request: RequestEventData): RequestEventData {
  const userAgent = request.headers?.[KEPT_REQUEST_HEADER];
  return {
    ...(request.url === undefined ? {} : { url: withoutQueryAndHash(request.url) }),
    ...(userAgent === undefined ? {} : { headers: { [KEPT_REQUEST_HEADER]: userAgent } }),
  };
}

function scrubException(exception: Exception): Exception {
  const frames = exception.stacktrace?.frames;
  return {
    ...exception,
    ...(exception.value === undefined ? {} : { value: scrubText(exception.value) }),
    ...(frames === undefined
      ? {}
      : {
          stacktrace: {
            ...exception.stacktrace,
            frames: frames.map((frame) =>
              frame.filename === undefined
                ? frame
                : { ...frame, filename: withoutQueryAndHash(frame.filename) },
            ),
          },
        }),
  };
}

/** The event as it may be sent; the one it was built from is left as it was. */
export function scrubBrowserEvent(event: ErrorEvent): ErrorEvent {
  const kept = Object.fromEntries(
    Object.entries(event).filter(([key]) => key !== 'user'),
  ) as ErrorEvent;
  return {
    ...kept,
    ...(event.message === undefined ? {} : { message: scrubText(event.message) }),
    ...(event.request === undefined ? {} : { request: scrubRequest(event.request) }),
    ...(event.exception?.values === undefined
      ? {}
      : { exception: { values: event.exception.values.map(scrubException) } }),
    ...(event.extra === undefined ? {} : { extra: scrubRecord(event.extra) }),
    ...(event.contexts === undefined ? {} : { contexts: scrubContexts(event.contexts) }),
    ...(event.breadcrumbs === undefined
      ? {}
      : {
          breadcrumbs: event.breadcrumbs.flatMap((breadcrumb) => {
            const scrubbed = scrubBreadcrumb(breadcrumb);
            return scrubbed === null ? [] : [scrubbed];
          }),
        }),
  };
}
