// The workspace desktop: the owner's saved sites, the form that adds one, and
// the one thing to do next.
//
// Four things about the add-a-site form are about it reading the site on its
// own, which is a thing nobody pressed a button for and so has to be visible:
// the line under the address says what is happening and marks it as working,
// everything the read is about to rewrite is held while it is owed (the
// debounce included, or a profile gets saved a keystroke before the form fills
// itself in), the context section unfolds itself once a read has settled so the
// answer is reviewed rather than saved unseen, and the whole half-written form
// survives a reload — including a read that was still running when the page
// went away. What is kept, and for how long, is `profile-draft-storage.ts`.
//
// The hold covers the name, the context fields and the row and next-step
// actions that would replace the form under it, so there is one way out of it
// and it is deliberate: Cancel, which is offered for as long as the hold lasts.
// The address itself stays writable — editing it is not a race with the read
// but the end of it, since another site retires the read and asks about the new
// one.
//
// Three things changed here. The add-profile form was always open — eight
// fields under every list, however many sites it already held — so it now
// folds behind "+ Add a site" once there is a site, with the six AI-context
// fields folded again inside it. A site row carried four labelled buttons; it
// now keeps New scan and folds Reports, Edit and — below a divider — Delete
// into one "⋯" menu. And the right column's terminal repeated the price list
// in four hard-coded English lines; it now names the owner's next step, worked
// out from their own last scan.

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { ActionMenu } from './ActionMenu';
import { apiRequest, type Scan, type SiteProfile } from './api';
import {
  competitorsError,
  parseCompetitorsInput,
  type CompetitorsInputError,
} from './competitors-input';
import { Button, EmptyState, Field, Panel, TextAreaField, Window } from './components';
import { desktopCopy } from './desktop-copy';
import { GoogleConnectionReminder } from './GoogleConnectionReminder';
import { copy, fillCopy, type Language } from './i18n';
import { NextStep, nextStepFor } from './NextStep';
import { autofillStatusMessage, type ProfileContextLabel } from './profile-autofill';
import {
  clearProfileDraft,
  isEmptyProfileDraft,
  readProfileDraft,
  storeProfileDraft,
} from './profile-draft-storage';
import { ProfileDeletion } from './ProfileDeletion';
import { normalizeSiteAddress } from './site-address-input';
import { useProfileAutofill } from './use-profile-autofill';
import { DomainOwnershipPanel } from './DomainOwnership';
import { SiteNextSteps } from './SiteNextSteps';
import { SiteStatusPanel } from './SiteStatus';
import { TargetLanguagesField } from './TargetLanguagesField';
import './styles/desktop.css';

export interface DesktopScreenProps {
  readonly profiles: readonly SiteProfile[];
  /** A public-page address handed off after sign-in, awaiting owner confirmation. */
  readonly initialDomain?: string | null;
  /**
   * Whose half-written profile the browser may restore here, or null while the
   * session is still being read. A draft belongs to one account: a shared
   * browser must never hand one owner the site another was describing.
   */
  readonly accountId?: string | null;
  /** Opens the screen that holds the data connections and their properties. */
  readonly onOpenIntegrations: () => void;
  readonly onRefresh: () => Promise<void>;
  /** Called once a profile is gone, so screens still holding it can let it go. */
  readonly onProfileDeleted: (profile: SiteProfile) => void;
  readonly onSelectProfile: (profile: SiteProfile) => void;
  readonly onNewScan: (profile: SiteProfile, plan?: 'Free' | 'WebsiteAudit' | 'Complete') => void;
  readonly onOpenScan: (scanId: string) => void;
  /** Retries the one unfinished section of a Partial scan. */
  readonly onRetryScan: (scanId: string) => Promise<void>;
  readonly onError: (value: string) => void;
  readonly onNotice: (value: string) => void;
  readonly onOnboarding: () => void;
  /** While the setup tour runs, the form it points at must be on screen. */
  readonly tourActive?: boolean;
  readonly language: Language;
}

/** The competitors field's live validation message, in the reader's words (T7). */
function competitorsErrorMessage(error: CompetitorsInputError, language: Language): string {
  const w = copy[language].workspace;
  switch (error.kind) {
    case 'too-many':
      return w.competitorsErrorTooMany;
    case 'too-short':
      return w.competitorsErrorTooShort;
    case 'too-long':
      return w.competitorsErrorTooLong;
    case 'duplicate':
      return fillCopy(w.competitorsErrorDuplicate, { name: error.name });
    case 'own-brand':
      return fillCopy(w.competitorsErrorOwnBrand, { name: error.name });
  }
}

// Re-exported where it has always been imported from.
export { nextStepFor } from './NextStep';

export function DesktopScreen(props: DesktopScreenProps) {
  const t = copy[props.language];
  const d = desktopCopy[props.language];
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [businessDescription, setBusinessDescription] = useState('');
  const [offerings, setOfferings] = useState('');
  const [region, setRegion] = useState('');
  const [targetLanguages, setTargetLanguages] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [competitorsInput, setCompetitorsInput] = useState('');
  const [editingProfile, setEditingProfile] = useState<SiteProfile | null>(null);
  /** The one row whose delete confirmation is open; opening another closes it. */
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  // The last name this form filled in from the address. Anything else in the
  // name field was typed by the owner and is never overwritten.
  const [suggestedName, setSuggestedName] = useState('');
  const [domain, setDomain] = useState('');
  const [domainError, setDomainError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** What the six context fields hold now, by the label the proposal uses. */
  const contextValues: Readonly<Record<ProfileContextLabel, string>> = {
    businessType: industry,
    businessDescription,
    offerings,
    operatingRegion: region,
    targetLanguages,
    targetAudience,
  };
  const contextSetters: Readonly<Record<ProfileContextLabel, (next: string) => void>> = {
    businessType: setIndustry,
    businessDescription: setBusinessDescription,
    offerings: setOfferings,
    operatingRegion: setRegion,
    targetLanguages: setTargetLanguages,
    targetAudience: setTargetAudience,
  };
  const autofill = useProfileAutofill({
    language: props.language,
    editing: editingProfile !== null,
    fields: { name, suggestedName, context: contextValues },
    setName,
    setSuggestedName,
    setContextField: (label, value) => contextSetters[label](value),
    onNotice: props.onNotice,
  });

  const [formRequested, setFormRequested] = useState(false);
  const appliedInitialDomain = useRef<string | null>(null);
  useEffect(() => {
    if (props.initialDomain === null || props.initialDomain === undefined) return;
    if (appliedInitialDomain.current === props.initialDomain) return;
    appliedInitialDomain.current = props.initialDomain;
    setDomain(props.initialDomain);
    setFormRequested(true);
    // An address carried through sign-in was typed by this owner too, just on
    // the page before this one, so the form reads it the same way.
    autofill.addressChanged(props.initialDomain, '');
  }, [props.initialDomain]);

  /**
   * Whether the browser's draft has had its turn at this form.
   *
   * State rather than a ref because the effect that *writes* the draft must not
   * run before the one that reads it: both would run in the same commit, and
   * the writer would see the empty form of the render before the restore and
   * overwrite the very draft it is about to restore.
   */
  const [draftSettled, setDraftSettled] = useState(false);
  useEffect(() => {
    if (draftSettled) return;
    const accountId = props.accountId ?? null;
    // Still reading the session: nothing can be restored or written yet, and
    // the slot must not be touched on behalf of an account we cannot name.
    if (accountId === null) return;
    setDraftSettled(true);
    // An address carried in from the page before this one is a fresher
    // instruction than a draft, so it wins; the draft is simply replaced by
    // whatever the form holds from here on.
    if (props.initialDomain !== null && props.initialDomain !== undefined) return;
    const draft = readProfileDraft(accountId);
    if (draft === null) return;
    setFormRequested(true);
    setDomain(draft.address);
    setName(draft.name);
    setSuggestedName(draft.suggestedName);
    setIndustry(draft.context.businessType);
    setBusinessDescription(draft.context.businessDescription);
    setOfferings(draft.context.offerings);
    setRegion(draft.context.operatingRegion);
    setTargetLanguages(draft.context.targetLanguages);
    setTargetAudience(draft.context.targetAudience);
    setCompetitorsInput(draft.competitors);
    autofill.restore({
      applied: draft.applied,
      askedOrigin: draft.askedOrigin,
      pendingOrigin: draft.pendingOrigin,
    });
  }, [props.accountId, props.initialDomain, draftSettled]);

  useEffect(() => {
    const accountId = props.accountId ?? null;
    // A saved profile open for editing is not a draft: what the fields hold is
    // the server's copy, and restoring it after a reload would read as an
    // unsaved change to a site that has none.
    if (!draftSettled || accountId === null || editingProfile !== null) return;
    const draft = {
      accountId,
      address: domain,
      name,
      suggestedName,
      context: contextValues,
      competitors: competitorsInput,
      applied: autofill.applied,
      pendingOrigin: autofill.pendingOrigin,
      askedOrigin: autofill.askedOrigin,
      savedAt: Date.now(),
    };
    if (isEmptyProfileDraft(draft)) clearProfileDraft();
    else storeProfileDraft(draft);
    // `autofill.pending` and `.completions` are in here because a read being
    // owed, or having just settled, changes the draft without changing a field
    // the owner touched — and they are what makes a reload resume rather than
    // forget. The provenance and the origins are read from the hook's refs at
    // render time, so they are current without being dependencies of their own.
  }, [
    props.accountId,
    draftSettled,
    editingProfile,
    domain,
    name,
    suggestedName,
    industry,
    businessDescription,
    offerings,
    region,
    targetLanguages,
    targetAudience,
    competitorsInput,
    autofill.pending,
    autofill.completions,
  ]);

  const [latest, setLatest] = useState<Scan | null | undefined>(undefined);
  const formRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const formOpen =
    props.profiles.length === 0 ||
    editingProfile !== null ||
    formRequested ||
    props.tourActive === true;
  // The site the right-hand column is already about: the one last checked, or
  // the first saved one. `undefined` means the account has no sites yet, and
  // the optional ownership panel simply does not appear.
  const ownershipProfile =
    props.profiles.find((candidate) => candidate.id === latest?.profileId) ?? props.profiles[0];
  const hasContext = [
    industry,
    businessDescription,
    offerings,
    region,
    targetLanguages,
    targetAudience,
    competitorsInput,
  ].some((value) => value.trim() !== '');
  const parsedCompetitors = parseCompetitorsInput(competitorsInput);
  const competitorsProblem = competitorsError(parsedCompetitors, name, domain);
  const competitorsFieldError =
    competitorsProblem === null
      ? undefined
      : competitorsErrorMessage(competitorsProblem, props.language);
  const autofillMessage = autofillStatusMessage(autofill.status, props.language);
  /**
   * Whether a read is owed, and so everything it may rewrite is held.
   *
   * The owner asked for the form to stop taking actions until the check is
   * finished: a proposal that lands in a field they are halfway through
   * writing, or a row action that replaces the form while it fills itself in,
   * is work lost to something nobody pressed a button for.
   */
  const locked = autofill.pending;

  /**
   * Whether the six context fields are unfolded.
   *
   * Controlled, because two things now open the section the owner did not open
   * themselves: a saved profile that has context in it, and a read that just
   * filled some in. `onToggle` keeps their own clicks authoritative — an
   * uncontrolled `open` prop would spring back open on the next render.
   */
  const [contextOpen, setContextOpen] = useState(false);
  const openedProfile = useRef<SiteProfile | null>(null);
  useEffect(() => {
    // Keyed on *which* profile the form is about, deliberately not on whether
    // there is context in it: `hasContext` is true for most of typing, and
    // following it would unfold the section the owner has just folded away.
    if (openedProfile.current === editingProfile) return;
    openedProfile.current = editingProfile;
    setContextOpen(editingProfile !== null && hasContext);
  }, [editingProfile, hasContext]);
  const completions = autofill.completions;
  useEffect(() => {
    // A read has settled with an answer about the owner's own site, drawn from
    // a page we read without being asked. Leaving it folded away is how an
    // owner saves a profile describing something they never saw — and an answer
    // that stated nothing is unfolded too, because the empty fields it could
    // not fill are now theirs to write.
    //
    // Keyed on the count, so folding the section away again stays folded: it
    // reopens for the next answer, not on the next render.
    if (completions > 0) setContextOpen(true);
  }, [completions]);

  const resetForm = () => {
    setEditingProfile(null);
    setFormRequested(false);
    setName('');
    setSuggestedName('');
    setDomain('');
    setIndustry('');
    setBusinessDescription('');
    setOfferings('');
    setRegion('');
    setTargetLanguages('');
    setTargetAudience('');
    setCompetitorsInput('');
    setDomainError(null);
    setContextOpen(false);
    autofill.reset();
    // A profile that is saved, or a form the owner emptied on purpose, is not
    // work in progress any more. Said here as well as left to the effect
    // above, because "there is nothing to come back to" is the point.
    clearProfileDraft();
  };

  /** Reads the site because the owner asked for it, not because the address changed. */
  const fillFromSite = async (): Promise<void> => {
    const normalized = normalizeSiteAddress(domain);
    if (!normalized.ok) {
      setDomainError(t.workspace.siteAddressError);
      return;
    }
    await autofill.fillFromSite(normalized.origin);
  };

  const openForm = () => {
    setFormRequested(true);
    window.requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ block: 'start' });
      formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    });
  };

  const editProfile = (profile: SiteProfile) => {
    autofill.reset();
    setEditingProfile(profile);
    setName(profile.name);
    setSuggestedName('');
    setDomain(profile.domain);
    setIndustry(profile.industry ?? '');
    setBusinessDescription(profile.businessDescription ?? '');
    setOfferings(profile.offerings ?? '');
    setRegion(profile.region ?? '');
    setTargetLanguages(profile.targetLanguages ?? profile.language ?? '');
    setTargetAudience(profile.targetAudience ?? '');
    setCompetitorsInput((profile.competitors ?? []).join(', '));
    setDomainError(null);
    // The owner has moved on to a site they already saved, and the form can
    // only hold one thing at a time: whatever new site was half-described here
    // is not coming back, so it is not kept as something to come back to.
    clearProfileDraft();
    window.requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: 'start' }));
  };

  const optionalText = (value: string): string | undefined => {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    // The button is disabled while a read is owed; a submit that arrives anyway
    // — a keypress in flight, a programmatic one — must not slip past the hold
    // and store a site the next moment is about to describe.
    if (locked) return;
    const normalized = normalizeSiteAddress(domain);
    if (!normalized.ok) {
      setDomainError(t.workspace.siteAddressError);
      return;
    }
    if (competitorsFieldError !== undefined) return;
    setDomainError(null);
    setBusy(true);
    const savedName = name.trim();
    const wasEditing = editingProfile !== null;
    try {
      const context = {
        industry: optionalText(industry),
        businessDescription: optionalText(businessDescription),
        offerings: optionalText(offerings),
        region: optionalText(region),
        targetLanguages: optionalText(targetLanguages),
        targetAudience: optionalText(targetAudience),
        competitors: parsedCompetitors.length === 0 ? undefined : parsedCompetitors,
      };
      await apiRequest<SiteProfile>(
        editingProfile === null ? '/profiles' : `/profiles/${editingProfile.id}`,
        {
          method: editingProfile === null ? 'POST' : 'PATCH',
          body: JSON.stringify(
            editingProfile === null
              ? { name: savedName, domain: normalized.origin, ...context }
              : {
                  name: savedName,
                  domain: normalized.origin,
                  expectedProfileConfigVersion: editingProfile.scanConfigVersion,
                  ...Object.fromEntries(
                    Object.entries(context).map(([key, value]) => [key, value ?? null]),
                  ),
                },
          ),
        },
      );
      resetForm();
      await props.onRefresh();
      // The confirmation is said where the owner is looking, and the list the
      // new row landed in is brought into view instead of an emptied form.
      props.onNotice(wasEditing ? d.profileUpdated(savedName) : d.profileSaved(savedName));
      window.requestAnimationFrame(() => listRef.current?.scrollIntoView({ block: 'start' }));
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Profile creation failed');
    } finally {
      setBusy(false);
    }
  };

  const onLatest = useCallback((scan: Scan | null) => setLatest(scan), []);

  return (
    <div className="stack">
      <div className="desktop__grid">
        <Window title={t.workspace.sites} showInertClose={false}>
          <div ref={listRef}>
            <Panel title={t.workspace.registered}>
              <div>
                {props.profiles.length === 0 ? (
                  <EmptyState title={t.workspace.noSites} description={t.workspace.noSitesHelp} />
                ) : (
                  props.profiles.map((profile) => (
                    <ProfileRow
                      key={profile.id}
                      profile={profile}
                      language={props.language}
                      locked={locked}
                      deleting={deletingProfileId === profile.id}
                      onOpenDelete={() => setDeletingProfileId(profile.id)}
                      onCancelDelete={() => setDeletingProfileId(null)}
                      onNewScan={() => props.onNewScan(profile)}
                      onReports={() => props.onSelectProfile(profile)}
                      onEdit={() => editProfile(profile)}
                      onDeleted={async (deleted) => {
                        setDeletingProfileId(null);
                        if (editingProfile?.id === deleted.id) resetForm();
                        props.onProfileDeleted(deleted);
                        await props.onRefresh();
                      }}
                      onError={props.onError}
                    />
                  ))
                )}
              </div>
            </Panel>
          </div>
          {/* About the sites in the list above, so it sits under them: the
              Google connection is configured two tabs away, and an owner who
              never opens that tab never learns their reports are running
              without their own Search Console and Analytics data. It renders
              nothing at all once there is nothing outstanding. */}
          {props.profiles.length === 0 ? null : (
            <GoogleConnectionReminder
              profiles={props.profiles}
              language={props.language}
              onOpenIntegrations={props.onOpenIntegrations}
            />
          )}
          {/* Under the list, not inside it: in the panel it read as one more
              action of the last site's row. */}
          {formOpen ? null : (
            <div className="button-row profile-add-toggle">
              <Button onClick={openForm}>{d.addSiteToggle}</Button>
            </div>
          )}
          {formOpen ? (
            <div className="profile-form" ref={formRef}>
              <Panel
                title={editingProfile === null ? t.workspace.addSite : t.workspace.editProfile}
              >
                {/* `aria-busy` on the form, not on the one control it
                    disables: what is working is the form — it is about to
                    rewrite several of these fields — and a reader who lands on
                    the save button is owed that, not only its disabled state. */}
                <form className="stack" onSubmit={save} aria-busy={autofill.pending}>
                  <p className="muted panel-help">{t.workspace.addSiteHelp}</p>
                  <Field
                    label={t.workspace.siteAddressLabel}
                    name="profile-domain"
                    autoComplete="url"
                    technical
                    value={domain}
                    onChange={(value) => {
                      setDomain(value);
                      if (domainError !== null) setDomainError(null);
                      autofill.addressChanged(value, domain);
                    }}
                    placeholder={t.workspace.siteAddressPlaceholder}
                    hint={t.workspace.siteAddressHint}
                    error={domainError ?? undefined}
                    data-tour-target="profile-domain"
                  />
                  {/* Under the address, not inside the folded context section:
                      the form filled itself without being asked, so what it is
                      doing has to be readable — and announced — where the
                      address was just typed.

                      `role="status"` carries the polite live region; the
                      pulsing dot beside the sentence is the same marker a
                      running scan section uses, and it is decoration — the
                      sentence is what a screen reader is given. */}
                  <div className="profile-autofill-status" role="status">
                    {autofillMessage === null ? null : (
                      <p className="muted profile-suggestions">
                        {autofill.pending ? (
                          <span className="profile-autofill-status__pulse" aria-hidden="true" />
                        ) : null}
                        {autofillMessage}
                      </p>
                    )}
                  </div>
                  <Field
                    label={t.workspace.displayName}
                    name="profile-name"
                    autoComplete="off"
                    value={name}
                    onChange={(value) => {
                      autofill.ownerEdited();
                      setName(value);
                    }}
                    placeholder={t.workspace.displayNamePlaceholder}
                    disabled={locked}
                  />
                  {/* Folded by default — a new owner reaches the save button
                      past two fields, not eight — and unfolded by the two
                      things that put something in it the owner did not type: a
                      saved profile with context, and a read that just filled
                      some in. See `contextOpen`. */}
                  <details
                    className="profile-context"
                    open={contextOpen}
                    onToggle={(event) => setContextOpen(event.currentTarget.open)}
                  >
                    <summary>{d.contextSummary}</summary>
                    <div className="stack">
                      <p className="muted">{t.workspace.profileContextHelp}</p>
                      <div className="stack profile-context-actions">
                        <p className="muted profile-suggestions">
                          {t.workspace.suggestProfileHelp}
                        </p>
                        <div className="button-row">
                          {/* Held while a request is in flight, not for the
                              whole time a read is owed: pressing this during
                              the debounce is "read it now", and it is the one
                              action that makes the wait shorter rather than
                              racing it. */}
                          <Button
                            type="button"
                            onClick={() => void fillFromSite()}
                            disabled={autofill.running || editingProfile !== null}
                          >
                            {autofill.running
                              ? t.workspace.suggestingProfile
                              : t.workspace.suggestProfile}
                          </Button>
                        </div>
                        {autofill.suggested ? (
                          <p className="muted profile-suggestions">
                            {t.workspace.suggestedProfile}
                          </p>
                        ) : null}
                        {autofill.missing.length === 0 ? null : (
                          <p className="muted profile-suggestions">
                            {fillCopy(t.workspace.suggestedProfileMissing, {
                              fields: new Intl.ListFormat(props.language, {
                                style: 'long',
                                type: 'conjunction',
                              }).format(
                                autofill.missing.map(
                                  (label) => t.workspace.suggestionFieldNames[label],
                                ),
                              ),
                            })}
                          </p>
                        )}
                      </div>
                      <Field
                        label={t.workspace.businessType}
                        name="profile-industry"
                        autoComplete="off"
                        value={industry}
                        onChange={(value) => {
                          // Autofill may propose this field, so writing in it
                          // retires a proposal already in flight and makes the
                          // value the owner's — see `ownerEdited`.
                          autofill.ownerEdited();
                          setIndustry(value);
                        }}
                        placeholder={t.workspace.businessTypePlaceholder}
                        hint={t.workspace.businessTypeHint}
                        disabled={locked}
                      />
                      <TextAreaField
                        label={t.workspace.businessDescription}
                        name="profile-description"
                        autoComplete="off"
                        value={businessDescription}
                        onChange={(value) => {
                          autofill.ownerEdited();
                          setBusinessDescription(value);
                        }}
                        placeholder={t.workspace.businessDescriptionPlaceholder}
                        hint={t.workspace.businessDescriptionHint}
                        disabled={locked}
                      />
                      <TextAreaField
                        label={t.workspace.offerings}
                        name="profile-offerings"
                        autoComplete="off"
                        value={offerings}
                        onChange={(value) => {
                          autofill.ownerEdited();
                          setOfferings(value);
                        }}
                        placeholder={t.workspace.offeringsPlaceholder}
                        hint={t.workspace.offeringsHint}
                        disabled={locked}
                      />
                      <Field
                        label={t.workspace.operatingRegion}
                        name="profile-region"
                        autoComplete="off"
                        value={region}
                        onChange={(value) => {
                          autofill.ownerEdited();
                          setRegion(value);
                        }}
                        placeholder={t.workspace.operatingRegionPlaceholder}
                        hint={t.workspace.operatingRegionHint}
                        disabled={locked}
                      />
                      <TargetLanguagesField
                        label={t.workspace.targetLanguages}
                        value={targetLanguages}
                        onChange={(value) => {
                          autofill.ownerEdited();
                          setTargetLanguages(value);
                        }}
                        placeholder={t.workspace.targetLanguagesPlaceholder}
                        hint={t.workspace.targetLanguagesHint}
                        language={props.language}
                        disabled={locked}
                      />
                      <TextAreaField
                        label={t.workspace.targetAudience}
                        name="profile-audience"
                        autoComplete="off"
                        value={targetAudience}
                        onChange={(value) => {
                          autofill.ownerEdited();
                          setTargetAudience(value);
                        }}
                        placeholder={t.workspace.targetAudiencePlaceholder}
                        hint={t.workspace.targetAudienceHint}
                        disabled={locked}
                      />
                      <Field
                        label={t.workspace.competitors}
                        name="profile-competitors"
                        autoComplete="off"
                        value={competitorsInput}
                        onChange={setCompetitorsInput}
                        placeholder={t.workspace.competitorsPlaceholder}
                        hint={t.workspace.competitorsHint}
                        error={competitorsFieldError}
                        disabled={locked}
                      />
                    </div>
                  </details>
                  <div className="button-row">
                    {/* Held while a read is owed, including through the
                        debounce: saving one keystroke after pasting an address
                        would store a site without the context the next moment
                        is about to fill in. The hold is never permanent — an
                        answer, a refusal, writing in a field yourself, or
                        cancelling all release it — and the line above says
                        what is happening while it lasts. */}
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={
                        busy ||
                        autofill.pending ||
                        name.trim() === '' ||
                        competitorsFieldError !== undefined
                      }
                      data-tour-target="save-profile"
                    >
                      {busy
                        ? t.workspace.saving
                        : editingProfile === null
                          ? t.workspace.saveProfile
                          : t.workspace.updateProfile}
                    </Button>
                    {/* Deliberately not held, and offered for as long as the
                        hold lasts even on an owner's very first site: emptying
                        the form is the one way out of a read they no longer
                        want to wait for, and it aborts the read and throws the
                        draft away rather than leaving either behind. */}
                    {editingProfile !== null ||
                    locked ||
                    (formRequested && props.profiles.length > 0) ? (
                      <Button type="button" onClick={resetForm}>
                        {t.workspace.cancelEdit}
                      </Button>
                    ) : null}
                  </div>
                </form>
              </Panel>
            </div>
          ) : null}
        </Window>
        <Window title={d.nextStep.heading} showInertClose={false}>
          {/* With two or more sites, one block per site: the account's newest
              scan belongs to one of them and must not speak for the others. */}
          {props.profiles.length > 1 ? (
            <SiteNextSteps
              language={props.language}
              locked={locked}
              profiles={props.profiles}
              onAddSite={openForm}
              onNewScan={props.onNewScan}
              onOpenScan={props.onOpenScan}
              onRetryScan={props.onRetryScan}
              onLatest={onLatest}
            />
          ) : (
            <>
              {latest === undefined ? null : (
                <NextStep
                  language={props.language}
                  locked={locked}
                  kind={nextStepFor(props.profiles, latest)}
                  profiles={props.profiles}
                  latest={latest}
                  onAddSite={openForm}
                  onNewScan={props.onNewScan}
                  onOpenScan={props.onOpenScan}
                  onRetryScan={props.onRetryScan}
                />
              )}
              <SiteStatusPanel
                language={props.language}
                profiles={props.profiles}
                onLatest={onLatest}
              />
            </>
          )}
          {/* Optional, and last: it changes nothing about the audits above it.
              Shown for the site the workspace is already talking about, so the
              owner is never asked which one they mean. */}
          {ownershipProfile === undefined ? null : (
            <DomainOwnershipPanel
              language={props.language}
              profile={ownershipProfile}
              onError={props.onError}
            />
          )}
          <div className="button-row">
            <Button onClick={props.onOnboarding}>{t.workspace.guide}</Button>
          </div>
        </Window>
      </div>
    </div>
  );
}

function ProfileRow(props: {
  profile: SiteProfile;
  language: Language;
  /**
   * Whether the form below is reading a site, and so this row's actions would
   * replace or discard a profile being described right now.
   *
   * Reports stays available: reading another site's reports is somewhere else
   * to be, not something done to the form.
   */
  locked: boolean;
  deleting: boolean;
  onOpenDelete: () => void;
  onCancelDelete: () => void;
  onNewScan: () => void;
  onReports: () => void;
  onEdit: () => void;
  onDeleted: (profile: SiteProfile) => Promise<void>;
  onError: (value: string) => void;
}) {
  const t = copy[props.language].workspace;
  const { profile } = props;
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="profile-row">
      <div className="profile-row__site">
        <strong>{profile.name}</strong>
        <span className="profile-row__domain">{profile.domain}</span>
      </div>
      <div className="profile-row__actions">
        <Button onClick={props.onNewScan} variant="primary" disabled={props.locked}>
          {t.newScan}
        </Button>
        <ActionMenu
          label={desktopCopy[props.language].rowActions(profile.name)}
          buttonRef={menuButtonRef}
          items={[
            { id: 'reports', label: t.inspect, onSelect: props.onReports },
            {
              id: 'edit',
              label: t.editProfile,
              onSelect: props.onEdit,
              disabled: props.locked,
            },
            {
              id: 'delete',
              label: t.deleteProfileAction,
              onSelect: props.onOpenDelete,
              danger: true,
              disabled: props.locked,
            },
          ]}
        />
      </div>
      {props.deleting ? (
        <div className="profile-row__deletion">
          <ProfileDeletion
            profile={profile}
            language={props.language}
            onDeleted={props.onDeleted}
            onError={props.onError}
            onCancel={() => {
              props.onCancelDelete();
              menuButtonRef.current?.focus();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
