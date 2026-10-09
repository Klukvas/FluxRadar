// The form that fills itself from the address just typed into it: when the read
// goes out, what it may write, and what each later edit does to it.
//
// The rules it applies are in `profile-autofill.ts`; this is the state around
// them — one request per address, nothing saved, and a record of every value it
// wrote so the next address can take its own back and leave the owner's alone.
//
// Two of those pieces of state exist for the form around it rather than for the
// read itself. `pending` is true from the moment a read is *owed* — the whole
// debounce, not just the request — because the form has to hold everything the
// read is about to rewrite, including the save button, until it settles. And
// the read is bounded so that hold always ends: a request that outlives
// `AUTOFILL_TIMEOUT_MS` is dropped and said to have failed, which is a
// different thing from the owner calling it off. And `restore` puts the reading
// state back after a reload, resuming a read whose request died with the page;
// what the form keeps across that reload is in `profile-draft-storage.ts`.

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiRequest, ApiRequestError } from './api';
import { copy, type Language } from './i18n';
import {
  autofillOriginFor,
  autofillProblemMessage,
  contextProposalFor,
  untouchedAutoValues,
  useAutofillTimer,
  AUTOFILL_TIMEOUT_MS,
  PROFILE_CONTEXT_LABELS,
  type AutoAppliedValues,
  type AutofillFieldKey,
  type AutofillStatus,
  type ProfileContextLabel,
  type ProfileSuggestionsResponse,
} from './profile-autofill';
import { normalizeSiteAddress, siteNameFromAddress } from './site-address-input';

/** Whether a read of the site was asked for by the owner or by the form itself. */
type SuggestionTrigger = 'manual' | 'auto';

export interface ProfileAutofillFields {
  readonly name: string;
  /** The name derived from the address, for as long as the owner has not taken it over. */
  readonly suggestedName: string;
  readonly context: Readonly<Record<ProfileContextLabel, string>>;
}

export interface ProfileAutofillOptions {
  readonly language: Language;
  /** True while a saved profile is open: its stored details are not a draft to overwrite. */
  readonly editing: boolean;
  readonly fields: ProfileAutofillFields;
  readonly setName: (value: string) => void;
  readonly setSuggestedName: (value: string) => void;
  readonly setContextField: (label: ProfileContextLabel, value: string) => void;
  readonly onNotice: (message: string) => void;
}

/** The reading state of a form that was restored from a draft after a reload. */
export interface RestoredAutofill {
  /** What the read had written into the fields before the page went away. */
  readonly applied: AutoAppliedValues;
  /** The origin already answered, so the restored form does not ask again. */
  readonly askedOrigin: string | null;
  /** The origin a read was still running for; it starts again from here. */
  readonly pendingOrigin: string | null;
}

export interface ProfileAutofill {
  /** What the status line under the address says about the read. */
  readonly status: AutofillStatus;
  /** True while a read is in flight, whoever asked for it. */
  readonly running: boolean;
  /**
   * True from the moment a read is owed until it has settled — including the
   * debounce, before any request exists.
   *
   * `running` is about a request; this is about the form. Everything a read is
   * about to rewrite is held while this is true — saving, the name, the context
   * fields, and the row actions that would replace the form under it — because
   * a read nobody pressed a button for must not race the owner's own answers.
   */
  readonly pending: boolean;
  /** True while values from the homepage are standing in the context fields. */
  readonly suggested: boolean;
  /** The still-empty context fields the homepage stated nothing about. */
  readonly missing: readonly ProfileContextLabel[];
  /**
   * How many reads have finished with an answer, plus a restored draft that
   * came back with one.
   *
   * Counted rather than flagged so the form can react to *this* read having
   * settled, and counted for an answer that stated nothing as well: the fields
   * it could not fill are the ones the owner now has to, and they are no use
   * folded away.
   */
  readonly completions: number;
  /** What this form wrote and with what, so a draft can outlive the page. */
  readonly applied: AutoAppliedValues;
  /** The origin a read is scheduled or running for, so a reload can resume it. */
  readonly pendingOrigin: string | null;
  /** The origin already answered, so a restored form does not ask twice. */
  readonly askedOrigin: string | null;
  /** The owner pressed Fill for an address that normalizes to this origin. */
  readonly fillFromSite: (origin: string) => Promise<void>;
  /** The address field changed from `previousAddress` to `address`. */
  readonly addressChanged: (address: string, previousAddress: string) => void;
  /**
   * The owner wrote in a field a proposal could have filled.
   *
   * Ignored while a read is owed: those fields are held for exactly that
   * window, so a write arriving anyway is a stale or programmatic one, and
   * letting it release the form is how the lock gets bypassed.
   */
  readonly ownerEdited: () => void;
  /** The form was emptied, or a saved profile was opened in it. */
  readonly reset: () => void;
  /** Picks a restored draft's reading state back up, resuming a read it owed. */
  readonly restore: (restored: RestoredAutofill) => void;
}

export function useProfileAutofill(options: ProfileAutofillOptions): ProfileAutofill {
  const [status, setStatus] = useState<AutofillStatus>({ kind: 'idle' });
  const [running, setRunning] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [missing, setMissing] = useState<readonly ProfileContextLabel[]>([]);
  const [completions, setCompletions] = useState(0);
  /**
   * The one piece of reading state the form outside this hook renders from, so
   * it is state rather than a ref: the busy lock, the spinner and the disabled
   * save button all have to re-render the moment a read is owed.
   *
   * Mirrored in a ref because the callbacks below have to read it as it is
   * *now*, not as it was when they were made.
   */
  const [pending, setPending] = useState(false);
  const pendingNow = useRef(false);
  const markPending = useCallback((next: boolean) => {
    pendingNow.current = next;
    setPending(next);
  }, []);
  const timer = useAutofillTimer();
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  /** The address asked about while it is the one in the field, so it is read once. */
  const askedOrigin = useRef<string | null>(null);
  /** The address a read is owed for — on the timer or in flight — or null. */
  const pendingOrigin = useRef<string | null>(null);
  /** The address the notices above the context fields are about. */
  const proposalOrigin = useRef<string | null>(null);
  /** What this form wrote into the name and context fields, and with what. */
  const applied = useRef<AutoAppliedValues>({});
  // A debounced read lands long after it was scheduled: it has to see the form
  // and the locale as they are when it answers, not as they were when it started.
  const latest = useRef(options);
  latest.current = options;

  /** Retires the read in flight and the one on the timer: neither may land now. */
  const retire = useCallback(() => {
    timer.cancel();
    generation.current += 1;
    request.current?.abort();
    request.current = null;
    pendingOrigin.current = null;
  }, [timer]);

  /** Gives up the read entirely and frees the form, saying nothing about it. */
  const abandon = useCallback(() => {
    retire();
    setRunning(false);
    markPending(false);
    setStatus((current) => (current.kind === 'checking' ? { kind: 'idle' } : current));
  }, [retire, markPending]);

  const ownerEdited = useCallback(() => {
    // Writing in one of these fields while a read is owed is not something the
    // form offers: it holds them until the read settles. Anything that gets
    // through is stale, and must not call off the read or free the form.
    if (pendingNow.current) return;
    abandon();
  }, [abandon]);

  // Nothing may answer a screen nobody is on: the generation retires the read
  // and the abort stops the request, so no state is set and no notice is spoken.
  useEffect(() => retire, [retire]);

  const languageAtLastRender = useRef(options.language);
  useEffect(() => {
    if (languageAtLastRender.current === options.language) return;
    languageAtLastRender.current = options.language;
    // The answer is written in the locale it was asked in, so a locale switch
    // retires it rather than applying a now-wrong language. Abandoned directly
    // rather than through `ownerEdited`: nobody wrote in a field, and the read
    // has to go even though the form is holding them.
    abandon();
  }, [options.language, abandon]);

  const reset = useCallback(() => {
    retire();
    setRunning(false);
    markPending(false);
    setStatus({ kind: 'idle' });
    setSuggested(false);
    setMissing([]);
    askedOrigin.current = null;
    proposalOrigin.current = null;
    applied.current = {};
  }, [retire, markPending]);

  /** Writes a proposal into the fields it is allowed to touch, and records what it wrote. */
  const apply = (suggestions: ProfileSuggestionsResponse, origin: string): void => {
    const { fields, setName, setSuggestedName, setContextField } = latest.current;
    const ours = untouchedAutoValues(applied.current, fields);
    const written: Partial<Record<AutofillFieldKey, string>> = { ...ours };
    const nameIsReplaceable =
      fields.name.trim() === '' || fields.name === fields.suggestedName || ours.name !== undefined;
    const proposedName = nameIsReplaceable ? suggestions.name : undefined;
    if (proposedName !== undefined) {
      setName(proposedName);
      setSuggestedName('');
      written.name = proposedName;
    }
    const proposal = contextProposalFor(suggestions, fields.context);
    proposal.fill.forEach((field) => {
      setContextField(field.label, field.value);
      written[field.label] = field.value;
    });
    applied.current = written;
    const filled = proposedName !== undefined || proposal.fill.length > 0;
    // Pressing Fill after the form already filled itself from this same address
    // finds nothing left to write — and the values in the fields are still the
    // homepage's, so the note above them stays rather than blinking out.
    const sameSite = proposalOrigin.current === origin;
    if (filled) proposalOrigin.current = origin;
    setSuggested((previous) => filled || (sameSite && previous));
    setMissing(proposal.missing);
    // Said for a read the owner pressed for as well as for one they did not:
    // the line under the address is where this form reports on itself, and a
    // button press that leaves it saying "checking" is a form still working.
    setStatus({ kind: filled || sameSite ? 'filled' : 'nothing' });
  };

  /**
   * Says why the read did not land, where the one who asked for it is looking.
   *
   * A timeout and a refusal read the same to the owner — nothing was filled in,
   * try again or describe the site yourself — so a timeout is passed as a null
   * code and gets the one neutral sentence.
   */
  const reportProblem = (
    trigger: SuggestionTrigger,
    code: string | null,
    language: Language,
  ): void => {
    if (trigger === 'auto') {
      setStatus({ kind: 'problem', code });
      return;
    }
    // The button speaks in a notice; the line it was showing progress in has
    // nothing left to say and must not go on claiming a read is happening.
    setStatus({ kind: 'idle' });
    latest.current.onNotice(autofillProblemMessage(code, language));
  };

  /**
   * Reads one public homepage and offers what it states.
   *
   * The server checks the site will let us read it before it reads anything, so a
   * refusal arrives as a code naming what the site did. Where the resulting
   * sentence goes depends on who asked: the owner who pressed the button is told
   * in a notice, while an automatic read answers in its own status line.
   */
  const read = async (origin: string, trigger: SuggestionTrigger): Promise<void> => {
    retire();
    askedOrigin.current = origin;
    pendingOrigin.current = origin;
    const controller = new AbortController();
    request.current = controller;
    const version = generation.current;
    const languageAtSubmit = latest.current.language;
    setRunning(true);
    markPending(true);
    // Said for the button press as well as for the read nobody asked for: the
    // form is holding its fields either way, and a form that locks itself with
    // nothing written under the address is a broken form.
    setStatus({ kind: 'checking' });
    /**
     * Frees the form after this read, whichever way it ended.
     *
     * Settled, whichever way it went: nothing is owed for this address any
     * more. A refusal or a timeout must release the hold as surely as an
     * answer does, or the owner is stuck on a site that will never let us in.
     */
    const release = (): void => {
      if (generation.current !== version) return;
      setRunning(false);
      markPending(false);
      pendingOrigin.current = null;
      request.current = null;
    };
    // The form is held while the read is owed, so a request that never answers
    // would hold it for good. Running out of time is kept apart from the aborts
    // the owner causes — a retired read says nothing, a timeout is a failure
    // and is spoken out loud — and it is finished here rather than left to the
    // code after the request: a request that never answers never reaches it.
    let expired = false;
    const expiry = setTimeout(() => {
      expired = true;
      controller.abort();
      if (generation.current !== version) return;
      reportProblem(trigger, null, languageAtSubmit);
      release();
    }, AUTOFILL_TIMEOUT_MS);
    try {
      const suggestions = await apiRequest<ProfileSuggestionsResponse>('/profiles/suggestions', {
        method: 'POST',
        body: JSON.stringify({ domain: origin, targetLanguage: languageAtSubmit }),
        signal: controller.signal,
      });
      // An edit that moved the form on while the request was in flight wins.
      if (generation.current !== version) return;
      // An answer that arrives after we stopped waiting for it is not applied:
      // the owner has already been told the read failed, and has had the form
      // back for as long as it took this to show up.
      if (expired) return;
      apply(suggestions, origin);
      setCompletions((previous) => previous + 1);
      if (suggestions.contextLanguage === 'source')
        latest.current.onNotice(copy[languageAtSubmit].workspace.suggestProfileSourceLanguage);
    } catch (caught) {
      if (generation.current !== version) return;
      // Checked before the signal, not after it: the timeout aborts the request
      // itself, and reading that abort as a cancellation is how a site that
      // never answers ends up saying nothing at all. The timeout has already
      // spoken, so there is nothing left to say here.
      if (expired) return;
      if (controller.signal.aborted) return;
      reportProblem(
        trigger,
        caught instanceof ApiRequestError ? caught.code : null,
        languageAtSubmit,
      );
    } finally {
      clearTimeout(expiry);
      if (!expired) release();
    }
  };

  /**
   * Asks the site about itself once the typing stops.
   *
   * Every reason not to send the request lives in `autofillOriginFor`, and the
   * fields it decides from are passed in rather than read from the last render:
   * the values this edit just cleared are not in state yet.
   */
  const scheduleRead = (address: string, fields: ProfileAutofillFields): void => {
    const origin = autofillOriginFor({
      address,
      editing: latest.current.editing,
      lastAttemptedOrigin: askedOrigin.current,
      nameIsOwners: fields.name.trim() !== '' && fields.name !== fields.suggestedName,
      emptyContextFields: Object.values(fields.context).filter((value) => value.trim() === '')
        .length,
    });
    if (origin === null) return;
    // Owed from here, not from when the request goes out: the debounce is 800ms
    // of a form that is about to fill itself in, and a profile saved inside
    // that window is saved without the context the next moment would add.
    //
    // The line says so from here too. A form that quietly locks its save
    // button for most of a second, with nothing written under the address, is
    // a broken form; "checking this site" is the truth from the moment the
    // decision to check it is made.
    pendingOrigin.current = origin;
    markPending(true);
    setStatus({ kind: 'checking' });
    timer.schedule(() => void read(origin, 'auto'));
  };

  /**
   * Takes back the values this form wrote, now that they describe another site.
   *
   * Only the ones still standing untouched: a field the owner wrote or corrected
   * is their answer and survives the move. Returns the form as it will be once
   * React applies these, because the next decision is made before that happens.
   */
  const reclaimOurValues = (address: string): ProfileAutofillFields => {
    const { fields, setName, setSuggestedName, setContextField } = latest.current;
    const ours = untouchedAutoValues(applied.current, fields);
    applied.current = {};
    const context = { ...fields.context };
    PROFILE_CONTEXT_LABELS.forEach((label) => {
      if (ours[label] === undefined) return;
      setContextField(label, '');
      context[label] = '';
    });
    const nameIsOwners =
      ours.name === undefined && fields.name !== '' && fields.name !== fields.suggestedName;
    if (nameIsOwners) return { ...fields, context };
    // A name that came from the address, or from the homepage at it, follows the
    // address to the new one.
    const derived = siteNameFromAddress(address) ?? '';
    setName(derived);
    setSuggestedName(derived);
    return { name: derived, suggestedName: derived, context };
  };

  /**
   * Points the automatic read at the address as it now stands.
   *
   * An edit that leaves the origin alone — a path typed after it, the same
   * address pasted over itself — keeps the read already running and whatever it
   * already answered: both are about this very site. Any other address is a
   * different site, so the read in flight is retired and what it would have
   * filled in is taken back before the new one is scheduled.
   *
   * Leaving the site also forgets the address asked about. Everything that read
   * filled in has just been taken back, so coming back to it — from another
   * site, or from a half-deleted address on the way there — has to be allowed to
   * fill the form again, or the owner is left with a form this feature emptied
   * and will not refill.
   */
  const addressChanged = (address: string, previousAddress: string): void => {
    const next = normalizeSiteAddress(address);
    const previous = normalizeSiteAddress(previousAddress);
    if (next.ok && previous.ok && next.origin === previous.origin) return;
    retire();
    askedOrigin.current = null;
    setRunning(false);
    markPending(false);
    setStatus({ kind: 'idle' });
    setSuggested(false);
    setMissing([]);
    proposalOrigin.current = null;
    scheduleRead(address, reclaimOurValues(address));
  };

  /**
   * Picks up a form restored from a draft after a reload.
   *
   * Three things come back: what the earlier read had written, so moving to
   * another address still takes back its values and leaves the owner's alone;
   * the address already answered, so a restored form does not ask about it
   * again; and the address a read was still running for, which is started over
   * — a request cannot survive a page, but the owner's wait for it can.
   *
   * The one thing deliberately not restored is the list of fields the homepage
   * said nothing about: it is a note about a proposal, and a proposal that was
   * accepted into the fields is better reviewed than re-narrated.
   */
  const restore = (restored: RestoredAutofill): void => {
    applied.current = { ...restored.applied };
    askedOrigin.current = restored.askedOrigin;
    const hasOurValues = Object.keys(restored.applied).length > 0;
    if (hasOurValues) {
      // The values standing in the fields came from the homepage at that
      // address, so the note above them is true again.
      proposalOrigin.current = restored.askedOrigin;
      setSuggested(true);
      // A read that finished before the reload counts as finished here too, so
      // the form it filled comes back with that answer in view.
      setCompletions((previous) => previous + 1);
    }
    if (restored.pendingOrigin !== null) void read(restored.pendingOrigin, 'auto');
  };

  return {
    status,
    running,
    pending,
    suggested,
    missing,
    completions,
    // Read from refs at render time on purpose: both change only alongside the
    // state that caused this render — a scheduled read, an answered one, a
    // field this form wrote — so there is nothing extra to keep in step.
    applied: applied.current,
    pendingOrigin: pendingOrigin.current,
    askedOrigin: askedOrigin.current,
    fillFromSite: (origin: string) => read(origin, 'manual'),
    addressChanged,
    ownerEdited,
    reset,
    restore,
  };
}
