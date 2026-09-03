// Crawler resource limits per D-028 (per page/URL) and D-030 (per host).
export const CRAWL_LIMITS = {
  maxHtmlBytes: 5 * 1024 * 1024,
  maxUrlBytes: 2048,
  maxRedirects: 5,
  pageTimeoutMs: 10_000,
  perHostRps: 5,
  perHostConcurrency: 4,
} as const;

// Hard caps per single AI request (§5). Exceeding input is truncated deterministically
// with a '[TRUNCATED]' marker; output hitting the cap gets finish_reason='length'.
export const AI_REQUEST_CAPS = {
  maxInputTokens: 8000,
  maxOutputTokens: 2000,
  maxReasoningUnits: 4000,
  maxSearchUnits: 8,
  maxCitationUnits: 32,
} as const;

// §16 data dictionary: evidence_excerpt is capped in Unicode characters, not bytes.
export const EVIDENCE_EXCERPT_MAX_CHARS = 2048;

// CONTENT-003 boundary: a page with fewer visible text characters is empty/low-value.
export const CONTENT_LOW_VALUE_MIN_VISIBLE_CHARS = 200;
