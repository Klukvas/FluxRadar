// The scan form's settings, in both directions: what the form sends, and what
// the last check of a site puts back into it.
//
// The new-scan form used to be the only place these two things existed, as nine
// pieces of component state and one inline object literal. That is why the
// settings were forgotten between checks — there was nowhere for them to be
// remembered — and why the Free plan could offer controls it does not honour:
// the form built one payload and the plan was never part of the decision.
//
// Both are decisions, not rendering, so they live here where they can be read
// and tested on their own. The profile's scanConfig is the reusable store;
// `Scan.scopeJson` remains the immutable snapshot of the settings used by one
// completed or in-flight scan.

import type { ApiCheckConfig, ProfileScanConfig, Scan } from './api';
import { apiCheckLines, parseApiCheckLines } from './api-check-lines';
import { PLAN_URL_LIMIT, type Plan } from './plan-modules';

/** The scan settings as the form holds them — numbers and lists as typed text. */
export interface ScanScopeForm {
  readonly includeSubdomains: boolean;
  readonly maxPages: string;
  readonly maxDepth: string;
  readonly includePatterns: string;
  readonly excludePatterns: string;
  /** URLs the owner listed by hand, one per line. */
  readonly seedUrls: string;
  /** Whether pages are read in a browser after their own scripts have run. */
  readonly renderJs: boolean;
  /** Public endpoints to check, one per line: `GET /api/health 200,204`. */
  readonly apiChecks: string;
  readonly queryPolicy: 'include' | 'ignore';
  readonly respectRobots: boolean;
  readonly robotsOverrideConfirmed: boolean;
  readonly userAgent: 'desktop' | 'mobile';
}

/** What a first-time scan of a site starts from. */
export const DEFAULT_SCOPE_FORM: ScanScopeForm = {
  includeSubdomains: false,
  maxPages: '15',
  maxDepth: '5',
  includePatterns: '',
  excludePatterns: '',
  seedUrls: '',
  renderJs: false,
  apiChecks: '',
  queryPolicy: 'ignore',
  respectRobots: true,
  robotsOverrideConfirmed: false,
  userAgent: 'desktop',
};

/**
 * The settings a Free check actually applies, whatever the form holds.
 *
 * The server decides this too (`apps/api/src/scans/free-scan-scope.ts`) and its
 * decision is the one that counts — this is here so the request the browser
 * sends says the same thing the server will store, rather than asking for limits
 * that would be silently replaced.
 */
export const FREE_FIXED_SCOPE = {
  includeSubdomains: false,
  maxPages: 1,
  maxDepth: 0,
  renderJs: false,
  queryPolicy: 'ignore',
  respectRobots: true,
  robotsOverrideConfirmed: false,
} as const;

/** The two settings the form collects as numbers, and can therefore mistype. */
export type ScopeNumberField = 'maxPages' | 'maxDepth';

/**
 * The deepest crawl `scanScopeSchema` accepts, on any plan.
 *
 * Unlike the page count there is no per-tariff depth, so this one number is the
 * whole ceiling; `scan-scope.test.ts` reads the schema and fails if it moves.
 */
export const MAX_CRAWL_DEPTH = 100;

/** What the API will accept for one number field on one plan. */
function bounds(field: ScopeNumberField, plan: Plan): { minimum: number; maximum: number } {
  return field === 'maxPages'
    ? { minimum: 1, maximum: PLAN_URL_LIMIT[plan] }
    : { minimum: 0, maximum: MAX_CRAWL_DEPTH };
}

/**
 * The number fields holding text the API would refuse, so the form can say so.
 *
 * An empty field is not one of them — it means "no limit of my own" and is left
 * out of the request entirely. A value above the plan's ceiling is not one
 * either: that one is clamped (`clampScopeToPlan`), because it is usually the
 * last check's setting rather than a typo. What is left is a number that is not
 * a whole number at or above the minimum, and naming it is the owner's only
 * chance to fix it before a checkout opens on a scope they did not ask for.
 *
 * Free never reports one: its controls are not on screen and its scope is fixed
 * whatever the form holds.
 */
export function invalidScopeFields(form: ScanScopeForm, plan: Plan): readonly ScopeNumberField[] {
  if (plan === 'Free') return [];
  return (['maxPages', 'maxDepth'] as const).filter((field) => {
    const trimmed = form[field].trim();
    if (trimmed === '') return false;
    const parsed = Number(trimmed);
    return !Number.isInteger(parsed) || parsed < bounds(field, plan).minimum;
  });
}

/**
 * The form with its number fields brought inside the selected plan's limits.
 *
 * A site last checked on Complete opens the form on Complete-sized limits, so
 * switching that same scan down to Basic would ask for more pages than Basic
 * sells — which the API refuses with a 400 written for a developer. The plan is
 * what the owner just chose, so the numbers move to it, on screen, before the
 * request rather than after it.
 *
 * Free is left alone: its controls are hidden and its scope is fixed, so
 * rewriting the fields to the one-page check would throw away settings the owner
 * would find missing on switching back. Returns the same form when nothing is
 * out of range, so a caller may set it back into state unconditionally.
 */
export function clampScopeToPlan(form: ScanScopeForm, plan: Plan): ScanScopeForm {
  if (plan === 'Free') return form;
  const maxPages = clampedText(form.maxPages, 'maxPages', plan);
  const maxDepth = clampedText(form.maxDepth, 'maxDepth', plan);
  if (maxPages === form.maxPages && maxDepth === form.maxDepth) return form;
  return { ...form, maxPages, maxDepth };
}

/** The scope payload of a scan request, as the API's `scanScopeSchema` reads it. */
export interface ScanScopePayload {
  readonly includeSubdomains: boolean;
  readonly maxPages?: number;
  readonly maxDepth?: number;
  readonly urlPatterns?: readonly string[];
  readonly excludePatterns?: readonly string[];
  readonly seedUrls?: readonly string[];
  readonly renderJs: boolean;
  readonly apiChecks?: readonly ApiCheckConfig[];
  readonly queryPolicy: 'include' | 'ignore';
  readonly respectRobots: boolean;
  readonly robotsOverrideConfirmed: boolean;
  readonly userAgent: 'desktop' | 'mobile';
}

/**
 * The scope to send for one plan.
 *
 * Free is the fixed homepage check, so its payload is the fixed scope plus the
 * one setting it does honour — the crawler's user agent, which applies to a
 * single page exactly as it applies to a thousand. A paid plan sends everything
 * the owner set.
 */
export function scanScopeFrom(form: ScanScopeForm, plan: Plan): ScanScopePayload {
  if (plan === 'Free') {
    return { ...FREE_FIXED_SCOPE, userAgent: form.userAgent };
  }
  const urlPatterns = patternList(form.includePatterns);
  const excludePatterns = patternList(form.excludePatterns);
  const seedUrls = lineList(form.seedUrls);
  const apiChecks = parseApiCheckLines(form.apiChecks).valid;
  const maxPages = scopeNumber(form.maxPages, 'maxPages', plan);
  const maxDepth = scopeNumber(form.maxDepth, 'maxDepth', plan);
  return {
    includeSubdomains: form.includeSubdomains,
    // A cleared number field is "no limit of my own", not zero pages: sending
    // the 0 that `Number('')` produces would be rejected by the API as invalid
    // and read to the owner as a broken form. Only an empty field earns that
    // omission — see `scopeNumber`.
    ...(maxPages === null ? {} : { maxPages }),
    ...(maxDepth === null ? {} : { maxDepth }),
    ...(urlPatterns.length > 0 ? { urlPatterns } : {}),
    ...(excludePatterns.length > 0 ? { excludePatterns } : {}),
    ...(seedUrls.length > 0 ? { seedUrls } : {}),
    ...(apiChecks.length > 0 ? { apiChecks } : {}),
    renderJs: form.renderJs,
    queryPolicy: form.queryPolicy,
    respectRobots: form.respectRobots,
    robotsOverrideConfirmed: form.robotsOverrideConfirmed,
    userAgent: form.userAgent,
  };
}

/**
 * The form as a legacy scan left it. New profiles use their saved scanConfig;
 * this fallback keeps older API fixtures and profiles usable during rollout.
 *
 * A Free scan contributes only its user agent. Everything else in a Free scope
 * was written by the server at the value the fixed homepage check enforces, so
 * carrying it forward would tell the owner they had once chosen a one-page
 * crawl with no depth — a preference they never expressed. A paid scan carries
 * everything as a compatibility fallback; the profile configuration is now the
 * source of truth for new and edited profiles.
 */
export function scopeFormFromScan(scan: Scan): ScanScopeForm {
  const scope = scan.scope;
  if (scan.plan === 'Free') {
    return { ...DEFAULT_SCOPE_FORM, userAgent: scope?.userAgent ?? DEFAULT_SCOPE_FORM.userAgent };
  }
  return {
    includeSubdomains: scope?.includeSubdomains ?? DEFAULT_SCOPE_FORM.includeSubdomains,
    maxPages: numberText(scope?.maxPages, DEFAULT_SCOPE_FORM.maxPages),
    maxDepth: numberText(scope?.maxDepth, DEFAULT_SCOPE_FORM.maxDepth),
    includePatterns: (scope?.urlPatterns ?? []).join(', '),
    excludePatterns: (scope?.excludePatterns ?? []).join(', '),
    seedUrls: (scope?.seedUrls ?? []).join('\n'),
    renderJs: scope?.renderJs ?? DEFAULT_SCOPE_FORM.renderJs,
    apiChecks: apiCheckLines(scope?.apiChecks ?? []),
    queryPolicy: scope?.queryPolicy ?? DEFAULT_SCOPE_FORM.queryPolicy,
    respectRobots: scope?.respectRobots ?? DEFAULT_SCOPE_FORM.respectRobots,
    // Legacy scan history is only a fallback during rollout. A robots override
    // is not carried from that snapshot; the reusable profile config handles
    // explicit saved settings separately.
    robotsOverrideConfirmed: false,
    userAgent: scope?.userAgent ?? DEFAULT_SCOPE_FORM.userAgent,
  };
}

/** Converts the reusable configuration stored on a profile into form values. */
export function scopeFormFromProfileConfig(config: ProfileScanConfig): ScanScopeForm {
  const scope = config.scope;
  if (config.plan === 'Free') {
    return { ...DEFAULT_SCOPE_FORM, userAgent: scope.userAgent };
  }
  return {
    includeSubdomains: scope.includeSubdomains,
    maxPages: numberText(scope.maxPages, ''),
    maxDepth: numberText(scope.maxDepth, ''),
    includePatterns: (scope.urlPatterns ?? []).join(', '),
    excludePatterns: (scope.excludePatterns ?? []).join(', '),
    seedUrls: (scope.seedUrls ?? []).join('\n'),
    renderJs: scope.renderJs ?? DEFAULT_SCOPE_FORM.renderJs,
    apiChecks: apiCheckLines(scope.apiChecks ?? []),
    queryPolicy: scope.queryPolicy,
    respectRobots: scope.respectRobots,
    robotsOverrideConfirmed: scope.robotsOverrideConfirmed,
    userAgent: scope.userAgent,
  };
}

/** Converts the current form into the complete reusable profile configuration. */
export function profileScanConfigFromForm(form: ScanScopeForm, plan: Plan): ProfileScanConfig {
  return { plan, scope: scanScopeFrom(form, plan) };
}

/**
 * A stable comparison key for the editable part of a saved profile.
 *
 * "Stable" has to mean more than `JSON.stringify`: the key order of a config
 * the API parsed and the key order of one this form just built are not the same
 * thing, and a setting added after a profile was saved is absent from it
 * entirely. Either difference would make an untouched form read as unsaved and
 * offer to save what is already there, so the key is canonical — object keys
 * sorted, the settings with defaults filled in. Array order is preserved,
 * because for seeds and API checks it is the owner's own ordering.
 */
export function profileScanConfigFingerprint(config: ProfileScanConfig): string {
  return JSON.stringify(
    canonicalValue({
      plan: config.plan,
      scope: { ...config.scope, renderJs: config.scope.renderJs ?? false },
    }),
  );
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]),
  );
}

/** A line-separated list as the API wants it: trimmed, without empty entries. */
function lineList(value: string): readonly string[] {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** A comma-separated list as the API wants it: trimmed, without empty entries. */
function patternList(value: string): readonly string[] {
  return value
    .split(',')
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== '');
}

/**
 * A typed number field as the API will take it, or null when the field is empty.
 *
 * Nothing here widens a scan. An unreadable value used to be dropped from the
 * payload, and a dropped limit reads to the server as "no limit of my own" — so
 * a mistyped page count silently became the whole plan allowance, up to 50,000
 * pages on Complete. It now falls to the field's minimum instead: the narrowest
 * scan there is, never a wider one than was asked for. The form refuses those
 * values before the request (`invalidScopeFields`); this is the floor under it,
 * so no caller can widen a scan by validating in the wrong order.
 */
function scopeNumber(text: string, field: ScopeNumberField, plan: Plan): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const { minimum, maximum } = bounds(field, plan);
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < minimum) return minimum;
  return Math.min(parsed, maximum);
}

/** The same value as `scopeNumber` gives, back as the text the field shows. */
function clampedText(text: string, field: ScopeNumberField, plan: Plan): string {
  const trimmed = text.trim();
  if (trimmed === '') return text;
  const parsed = Number(trimmed);
  const { maximum } = bounds(field, plan);
  // A value that is not a number at all is the form's to report, not this
  // function's to overwrite: replacing it would hide the typo being pointed at.
  if (!Number.isInteger(parsed) || parsed <= maximum) return text;
  return String(maximum);
}

function numberText(value: number | undefined, fallback: string): string {
  return value === undefined ? fallback : String(value);
}
