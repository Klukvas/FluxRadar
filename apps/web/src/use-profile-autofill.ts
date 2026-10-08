// The form that fills itself from the address just typed into it: when the read
// goes out, what it may write, and what each later edit does to it.
//
// The rules it applies are in `profile-autofill.ts`; this is the state around
// them — one request per address, nothing saved, and a record of every value it
// wrote so the next address can take its own back and leave the owner's alone.

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiRequest, ApiRequestError } from './api';
import { copy, type Language } from './i18n';
import {
  autofillOriginFor,
  autofillProblemMessage,
  contextProposalFor,
  untouchedAutoValues,
  useAutofillTimer,
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

export interface ProfileAutofill {
  /** What the status line under the address says about the read. */
  readonly status: AutofillStatus;
  /** True while a read is in flight, whoever asked for it. */
  readonly running: boolean;
  /** True while values from the homepage are standing in the context fields. */
  readonly suggested: boolean;
  /** The still-empty context fields the homepage stated nothing about. */
  readonly missing: readonly ProfileContextLabel[];
  /** The owner pressed Fill for an address that normalizes to this origin. */
  readonly fillFromSite: (origin: string) => Promise<void>;
  /** The address field changed from `previousAddress` to `address`. */
  readonly addressChanged: (address: string, previousAddress: string) => void;
  /** The owner wrote in a field a proposal could have filled. */
  readonly ownerEdited: () => void;
  /** The form was emptied, or a saved profile was opened in it. */
  readonly reset: () => void;
}

export function useProfileAutofill(options: ProfileAutofillOptions): ProfileAutofill {
  const [status, setStatus] = useState<AutofillStatus>({ kind: 'idle' });
  const [running, setRunning] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [missing, setMissing] = useState<readonly ProfileContextLabel[]>([]);
  const timer = useAutofillTimer();
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  /** The address asked about while it is the one in the field, so it is read once. */
  const askedOrigin = useRef<string | null>(null);
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
  }, [timer]);

  const ownerEdited = useCallback(() => {
    retire();
    setRunning(false);
    setStatus((current) => (current.kind === 'checking' ? { kind: 'idle' } : current));
  }, [retire]);

  // Nothing may answer a screen nobody is on: the generation retires the read
  // and the abort stops the request, so no state is set and no notice is spoken.
  useEffect(() => retire, [retire]);

  const languageAtLastRender = useRef(options.language);
  useEffect(() => {
    if (languageAtLastRender.current === options.language) return;
    languageAtLastRender.current = options.language;
    // The answer is written in the locale it was asked in, so a locale switch
    // retires it rather than applying a now-wrong language.
    ownerEdited();
  }, [options.language, ownerEdited]);

  const reset = useCallback(() => {
    retire();
    setRunning(false);
    setStatus({ kind: 'idle' });
    setSuggested(false);
    setMissing([]);
    askedOrigin.current = null;
    proposalOrigin.current = null;
    applied.current = {};
  }, [retire]);

  /** Writes a proposal into the fields it is allowed to touch, and records what it wrote. */
  const apply = (
    suggestions: ProfileSuggestionsResponse,
    trigger: SuggestionTrigger,
    origin: string,
  ): void => {
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
    if (trigger === 'auto') setStatus({ kind: filled || sameSite ? 'filled' : 'nothing' });
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
    const controller = new AbortController();
    request.current = controller;
    const version = generation.current;
    const languageAtSubmit = latest.current.language;
    setRunning(true);
    // Whatever the last automatic read said is about to be answered again, so it
    // goes either way: the automatic read says it is checking, while the button
    // shows its own progress and speaks in a notice, leaving the line empty.
    setStatus(trigger === 'auto' ? { kind: 'checking' } : { kind: 'idle' });
    try {
      const suggestions = await apiRequest<ProfileSuggestionsResponse>('/profiles/suggestions', {
        method: 'POST',
        body: JSON.stringify({ domain: origin, targetLanguage: languageAtSubmit }),
        signal: controller.signal,
      });
      // An edit that moved the form on while the request was in flight wins.
      if (generation.current !== version) return;
      apply(suggestions, trigger, origin);
      if (suggestions.contextLanguage === 'source')
        latest.current.onNotice(copy[languageAtSubmit].workspace.suggestProfileSourceLanguage);
    } catch (caught) {
      if (controller.signal.aborted || generation.current !== version) return;
      const code = caught instanceof ApiRequestError ? caught.code : null;
      if (trigger === 'auto') setStatus({ kind: 'problem', code });
      else latest.current.onNotice(autofillProblemMessage(code, latest.current.language));
    } finally {
      if (generation.current === version) {
        setRunning(false);
        request.current = null;
      }
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
    setStatus({ kind: 'idle' });
    setSuggested(false);
    setMissing([]);
    proposalOrigin.current = null;
    scheduleRead(address, reclaimOurValues(address));
  };

  return {
    status,
    running,
    suggested,
    missing,
    fillFromSite: (origin: string) => read(origin, 'manual'),
    addressChanged,
    ownerEdited,
    reset,
  };
}
