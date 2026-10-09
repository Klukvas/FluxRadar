// The half-written site profile the browser keeps across a reload.
//
// The add-a-site form is the one place in this app where a reload destroys real
// work: the address, a display name, six context fields — and, since the form
// reads the site on its own, possibly a request still in flight that was about
// to fill most of them in. An owner who refreshes, follows a link and comes
// back, or whose tab is restored after a crash, used to find an empty form and
// no sign that anything had been happening.
//
// Three deliberate choices, all of them about keeping this small:
//
//   1. **sessionStorage, not localStorage.** A draft is work in progress in
//      *this tab*, not a preference. It survives F5 and a restored tab, and it
//      is gone when the tab is — nothing to clear, nothing to leak into the
//      next visit, no second tab fighting over the same slot.
//   2. **Bound to the account.** The record carries the id of the account that
//      wrote it, and a read for any other account declines it. A shared
//      browser must never show one owner the site another was describing.
//   3. **Validated, never repaired.** Everything read back is untrusted input:
//      a field of the wrong type, an over-long value, an origin that is not an
//      http(s) origin, or a record past its lifetime drops the whole draft.
//      A half-trusted draft written into a form is worse than an empty form.

import {
  PROFILE_CONTEXT_LABELS,
  type AutoAppliedValues,
  type AutofillFieldKey,
  type ProfileContextLabel,
} from './profile-autofill';

const DRAFT_STORAGE_KEY = 'fluxradar.profileDraft';

/**
 * How long a draft is worth restoring.
 *
 * Long enough to cover a reload, a detour to the policy page and a restored
 * tab; short enough that a form the owner abandoned this morning is not
 * reopened over their shoulder this afternoon.
 */
export const PROFILE_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * The longest value any single field may carry into storage.
 *
 * Comfortably above every cap the profile API enforces (the longest is the
 * 800-character description), so a draft the owner could actually save always
 * round-trips, while a field that is suddenly megabytes long is refused rather
 * than written.
 */
export const PROFILE_DRAFT_MAX_FIELD = 2_000;

export interface ProfileDraft {
  /** Carried so another account signing in here never adopts this draft. */
  readonly accountId: string;
  readonly address: string;
  readonly name: string;
  /** The name derived from the address, while the owner has not taken it over. */
  readonly suggestedName: string;
  readonly context: Readonly<Record<ProfileContextLabel, string>>;
  readonly competitors: string;
  /** What the automatic read wrote, so a later address can tell its own from the owner's. */
  readonly applied: AutoAppliedValues;
  /** The origin a read was still running for, so the restored form resumes it. */
  readonly pendingOrigin: string | null;
  /** The origin already answered, so a restored form does not ask about it again. */
  readonly askedOrigin: string | null;
  readonly savedAt: number;
}

const AUTOFILL_FIELD_KEYS: readonly AutofillFieldKey[] = ['name', ...PROFILE_CONTEXT_LABELS];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStorableText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= PROFILE_DRAFT_MAX_FIELD;
}

/**
 * An origin is resumed by sending a request to it, so only an absolute http(s)
 * origin counts. Anything else in that slot would turn "continue what you were
 * doing" into a fetch at an address the owner never typed.
 */
function isStorableOrigin(value: unknown): value is string | null {
  if (value === null) return true;
  if (!isStorableText(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
  } catch {
    return false;
  }
}

function storableContext(value: unknown): Readonly<Record<ProfileContextLabel, string>> | null {
  if (!isRecord(value)) return null;
  const entries = PROFILE_CONTEXT_LABELS.map((label) => [label, value[label] ?? ''] as const);
  if (entries.some(([, text]) => !isStorableText(text))) return null;
  return Object.fromEntries(entries) as Record<ProfileContextLabel, string>;
}

/** The recorded provenance, keeping only the fields an automatic read can write. */
function storableApplied(value: unknown): AutoAppliedValues | null {
  if (!isRecord(value)) return null;
  const written = AUTOFILL_FIELD_KEYS.flatMap((key) =>
    value[key] === undefined ? [] : [[key, value[key]] as const],
  );
  if (written.some(([, text]) => !isStorableText(text))) return null;
  // An unknown key means a record this version did not write; the fields it
  // does know are still read, and the stray one is simply not carried over.
  return Object.fromEntries(written) as AutoAppliedValues;
}

/** Storage access throws in some privacy modes; an unusable store is "nothing". */
function readStoredValue(): string | null {
  try {
    return window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearProfileDraft(): void {
  try {
    window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Nothing to recover from: the caller has already dropped its own state.
  }
}

/**
 * Keeps this draft, replacing whatever was there.
 *
 * A draft that cannot be written is not an error anyone can act on — the form
 * in front of the owner still works, it just will not survive a reload — so a
 * blocked or full store is silent, and the stale record is removed first so a
 * reload cannot restore an older version of the form than the one on screen.
 */
export function storeProfileDraft(draft: ProfileDraft): void {
  try {
    window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Private mode, a full quota, or a draft larger than the slot allows.
  }
}

/**
 * The draft this account may continue, or null.
 *
 * `now` is a parameter so the lifetime can be tested without moving the clock,
 * and so one reading of it decides the whole record.
 */
export function readProfileDraft(accountId: string, now: number = Date.now()): ProfileDraft | null {
  const raw = readStoredValue();
  if (raw === null) return null;
  try {
    const stored: unknown = JSON.parse(raw);
    if (!isRecord(stored)) {
      clearProfileDraft();
      return null;
    }
    const { savedAt } = stored;
    if (
      typeof savedAt !== 'number' ||
      !Number.isSafeInteger(savedAt) ||
      savedAt <= 0 ||
      savedAt > now ||
      now - savedAt > PROFILE_DRAFT_TTL_MS
    ) {
      clearProfileDraft();
      return null;
    }
    const context = storableContext(stored.context);
    const applied = storableApplied(stored.applied);
    if (
      stored.accountId !== accountId ||
      context === null ||
      applied === null ||
      !isStorableText(stored.address) ||
      !isStorableText(stored.name) ||
      !isStorableText(stored.suggestedName) ||
      !isStorableText(stored.competitors) ||
      !isStorableOrigin(stored.pendingOrigin) ||
      !isStorableOrigin(stored.askedOrigin)
    ) {
      // Someone else's or unreadable, like the expired record above: the slot
      // holds nothing this form may use, so it is emptied rather than left to
      // be rejected again on every later visit.
      clearProfileDraft();
      return null;
    }
    return {
      accountId,
      address: stored.address,
      name: stored.name,
      suggestedName: stored.suggestedName,
      context,
      competitors: stored.competitors,
      applied,
      pendingOrigin: stored.pendingOrigin,
      askedOrigin: stored.askedOrigin,
      savedAt,
    };
  } catch {
    clearProfileDraft();
    return null;
  }
}

/** True when a draft holds nothing worth restoring, so it is not worth writing either. */
export function isEmptyProfileDraft(
  draft: Pick<ProfileDraft, 'address' | 'name' | 'context' | 'competitors' | 'pendingOrigin'>,
): boolean {
  return (
    draft.pendingOrigin === null &&
    [draft.address, draft.name, draft.competitors, ...Object.values(draft.context)].every(
      (value) => value.trim() === '',
    )
  );
}
