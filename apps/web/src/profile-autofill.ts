// The rules behind "the form fills itself from the site you just pasted".
//
// Three separate things live here, and all three exist because an automatic
// read is not a button press: nobody asked for it, so it has to be careful.
//
//   1. *When* to read (`autofillOriginFor`). Only a complete site address, once
//      while that address stands, never while a saved profile is open for editing, and
//      never when there is nothing left for the answer to fill. Each read is an
//      outbound request to a stranger's server, so "no" is the default.
//   2. *What* the answer may touch (`contextProposalFor`). A field the owner
//      wrote in is theirs; a field the homepage said nothing about is named so a
//      half-filled form does not read as a broken autofill.
//   3. *What to say* when the site refused (`autofillProblemMessage`). The API
//      answers with a code for each verdict of the reachability preflight, and
//      the advice for each one is already written for the pre-purchase panel —
//      so it is reused rather than reworded.
//
//   4. *Whose* a value in the form is (`untouchedAutoValues`). An answer about
//      one site must not stay behind as the owner moves to another, and an
//      answer the owner has edited must not be taken away from them.
//
// The debounce timer that drives (1) is here too, because a timer that outlives
// its form is how a typed address becomes a request against an unmounted screen.
// The state machine that uses all of this is `use-profile-autofill.ts`.

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { copy, fillCopy, type Language } from './i18n';
import { normalizeSiteAddress } from './site-address-input';
import {
  PROFILE_TARGET_LANGUAGE_NAMES,
  formatTargetLanguages,
  parseTargetLanguages,
} from './target-languages';

/**
 * How long the typing has to stop before the site is asked.
 *
 * Long enough that a pasted address is one request and a hand-typed one is not
 * thirty, short enough that the fields fill while the owner is still looking at
 * the form rather than after they have moved on.
 */
export const AUTOFILL_DEBOUNCE_MS = 800;

/**
 * How long a read may run before the form stops waiting for it.
 *
 * The form is held while a read is owed, so a request that never answers would
 * hold it for the rest of the session. The ceiling sits just past what the
 * server allows itself — a preflight, an 8s homepage fetch and a 30s model call
 * — and running out of it is a failure the owner is told about, not a silent
 * release.
 */
export const AUTOFILL_TIMEOUT_MS = 45_000;

/**
 * The context fields a public homepage may propose, named by their own label.
 *
 * The form tells the owner which of these the page said nothing about, so a
 * proposal that filled three fields of six does not read as a broken autofill.
 */
export const PROFILE_CONTEXT_LABELS = [
  'businessType',
  'businessDescription',
  'offerings',
  'operatingRegion',
  'targetLanguages',
  'targetAudience',
] as const;

export type ProfileContextLabel = (typeof PROFILE_CONTEXT_LABELS)[number];

export interface ProfileSuggestionsResponse {
  readonly name?: string;
  readonly businessDescription?: string;
  readonly offerings?: string;
  readonly industry?: string;
  readonly region?: string;
  readonly targetAudience?: string;
  readonly targetLanguages?: string;
  readonly contextLanguage?: 'target' | 'source';
}

/**
 * What the form says about the read it started on its own.
 *
 * A refusal is kept as the API's code rather than as a finished sentence, so the
 * line is written in the locale the reader is in now and not in the one they
 * were in when their site answered.
 */
export type AutofillStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'filled' }
  | { readonly kind: 'nothing' }
  | { readonly kind: 'problem'; readonly code: string | null };

export interface AutofillFormState {
  /** The address exactly as it stands in the field. */
  readonly address: string;
  /** True while a saved profile is open: its stored details are not a draft. */
  readonly editing: boolean;
  /** The address the form asked about while it stands in the field, or null. */
  readonly lastAttemptedOrigin: string | null;
  /** True when the display name is the owner's own, not one derived from the address. */
  readonly nameIsOwners: boolean;
  /** How many of the context fields are still empty. */
  readonly emptyContextFields: number;
}

/**
 * The origin this form should read now, or null to leave the site alone.
 *
 * Deliberately a pure decision: the caller owns the timer and the request, so
 * every reason not to send one can be tested without a clock or a fetch.
 */
export function autofillOriginFor(form: AutofillFormState): string | null {
  if (form.editing) return null;
  const normalized = normalizeSiteAddress(form.address);
  if (!normalized.ok) return null;
  // Already asked about this very address, so there is nothing new to learn.
  // Only the address currently in the field is remembered: leaving a site takes
  // back everything its answer filled in, so coming back to it is a new read.
  // That is deliberately per transition rather than a history — it stops the
  // keystroke storm, and the account and per-IP limits on the endpoint stop the
  // rest.
  if (normalized.origin === form.lastAttemptedOrigin) return null;
  // Nothing the answer could fill: the name is the owner's and every context
  // field already has something in it.
  if (form.nameIsOwners && form.emptyContextFields === 0) return null;
  return normalized.origin;
}

export interface ProfileContextProposal {
  /** The fields to fill, with the value the homepage stated for each. */
  readonly fill: readonly { readonly label: ProfileContextLabel; readonly value: string }[];
  /** The still-empty fields the homepage stated nothing about. */
  readonly missing: readonly ProfileContextLabel[];
}

/**
 * Which context fields a proposal may fill, and which it could not answer.
 *
 * A field the owner already wrote in is left alone whether the page stated one
 * or not, and is not reported as missing: they answered it themselves.
 */
export function contextProposalFor(
  suggestions: ProfileSuggestionsResponse,
  current: Readonly<Record<ProfileContextLabel, string>>,
): ProfileContextProposal {
  const stated: Readonly<Record<ProfileContextLabel, string | undefined>> = {
    businessType: suggestions.industry,
    businessDescription: suggestions.businessDescription,
    offerings: suggestions.offerings,
    operatingRegion: suggestions.region,
    targetLanguages: supportedTargetLanguages(suggestions.targetLanguages),
    targetAudience: suggestions.targetAudience,
  };
  const untouched = PROFILE_CONTEXT_LABELS.filter((label) => current[label].trim() === '');
  return {
    fill: untouched.flatMap((label) => {
      const value = stated[label];
      return value === undefined ? [] : [{ label, value }];
    }),
    missing: untouched.filter((label) => stated[label] === undefined),
  };
}

/** The fields an automatic read may write into: the name and the six context ones. */
export type AutofillFieldKey = 'name' | ProfileContextLabel;

/** What a read wrote, by field, so a later address can tell its own from the owner's. */
export type AutoAppliedValues = Readonly<Partial<Record<AutofillFieldKey, string>>>;

/** The name and context fields as they stand, in the shape provenance is checked against. */
export interface AutofillFieldValues {
  readonly name: string;
  readonly context: Readonly<Record<ProfileContextLabel, string>>;
}

/**
 * The values a read wrote that are still standing exactly as it left them.
 *
 * A field whose text has since changed is the owner's answer now, whoever put
 * the first draft there — so moving to another address may blank the rest and
 * must leave that one alone.
 */
export function untouchedAutoValues(
  applied: AutoAppliedValues,
  fields: AutofillFieldValues,
): AutoAppliedValues {
  const standing = (key: AutofillFieldKey): string =>
    key === 'name' ? fields.name : fields.context[key];
  const keys = Object.keys(applied) as readonly AutofillFieldKey[];
  return Object.fromEntries(
    keys.filter((key) => applied[key] === standing(key)).map((key) => [key, applied[key]]),
  ) as AutoAppliedValues;
}

/**
 * The languages of the proposal this product can actually audit in.
 *
 * A homepage that publishes in Japanese states a language the picker has no
 * entry for, and a value the picker cannot show is worse than an empty field —
 * so an unsupported list reads as "the page stated nothing".
 */
function supportedTargetLanguages(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const supported = parseTargetLanguages(value).filter((language) =>
    PROFILE_TARGET_LANGUAGE_NAMES.includes(language),
  );
  return supported.length === 0 ? undefined : formatTargetLanguages(supported);
}

/**
 * The refusal codes the suggestions endpoint answers with, and the state whose
 * advice each one maps to.
 *
 * Kept as literals on both sides of the wire, the way this app already reads
 * `DOMAIN_EXISTS`; the server half is `apps/api/src/profiles/suggestion-preflight.ts`.
 */
const REFUSAL_ADVICE = {
  SITE_ACCESS_DENIED: 'accessDenied',
  SITE_BLOCKED_BY_ROBOTS: 'blockedByRobots',
  SITE_UNREACHABLE: 'unreachable',
  SITE_BAD_RESPONSE: 'badResponse',
} as const;

/**
 * What to tell the owner when the read did not happen.
 *
 * A site that refused our crawler gets the sentence that fixes it — the same
 * one the pre-purchase panel shows, because the same refusal would also stop the
 * audit they are about to buy. Anything else (a 500, an unparsable page, a
 * dropped connection) stays the one neutral sentence: it says nothing about our
 * network and leaves saving the profile by hand available.
 */
export function autofillProblemMessage(code: string | null, language: Language): string {
  const t = copy[language];
  const advice = code === null ? undefined : REFUSAL_ADVICE[code as keyof typeof REFUSAL_ADVICE];
  if (advice === undefined) return t.workspace.suggestProfileUnavailable;
  return fillCopy(t.workspace.autofillBlocked, { reason: t.reachability.states[advice].body });
}

/** The one sentence the status line holds in each phase, or nothing to say. */
export function autofillStatusMessage(status: AutofillStatus, language: Language): string | null {
  const w = copy[language].workspace;
  switch (status.kind) {
    case 'idle':
      return null;
    case 'checking':
      return w.autofillChecking;
    case 'filled':
      return w.autofillFilled;
    case 'nothing':
      return w.autofillNothing;
    case 'problem':
      return autofillProblemMessage(status.code, language);
  }
}

export interface AutofillTimer {
  /** Replaces any pending read with this one, `AUTOFILL_DEBOUNCE_MS` from now. */
  readonly schedule: (run: () => void) => void;
  readonly cancel: () => void;
}

/**
 * The debounce behind the automatic read, cleared when the form goes away.
 *
 * A pending timer that survives unmount would fetch for a screen nobody is on
 * and set state on a component React has already dropped.
 */
export function useAutofillTimer(delayMs: number = AUTOFILL_DEBOUNCE_MS): AutofillTimer {
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (pending.current === null) return;
    clearTimeout(pending.current);
    pending.current = null;
  }, []);
  const schedule = useCallback(
    (run: () => void) => {
      cancel();
      pending.current = setTimeout(() => {
        pending.current = null;
        run();
      }, delayMs);
    },
    [cancel, delayMs],
  );
  useEffect(() => cancel, [cancel]);
  // One object for the life of the form: callers keep it in effect dependencies,
  // where a fresh object every render would re-run their cleanup.
  return useMemo(() => ({ schedule, cancel }), [schedule, cancel]);
}
