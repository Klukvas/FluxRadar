// The workspace desktop: the owner's saved sites, the form that adds one, and
// the one thing to do next.
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
import { apiRequest, canRetrySection, isReportReady, type Scan, type SiteProfile } from './api';
import {
  competitorsError,
  parseCompetitorsInput,
  type CompetitorsInputError,
} from './competitors-input';
import { Button, EmptyState, Field, Panel, TextAreaField, Window } from './components';
import { desktopCopy, type NextStepKind } from './desktop-copy';
import { copy, fillCopy, type Language } from './i18n';
import { ProfileDeletion } from './ProfileDeletion';
import { displayDomain, isTerminalScanStatus } from './scan-status';
import { normalizeSiteAddress, siteNameFromAddress } from './site-address-input';
import { DomainOwnershipPanel } from './DomainOwnership';
import { SiteStatusPanel } from './SiteStatus';
import { TargetLanguagesField } from './TargetLanguagesField';
import {
  PROFILE_TARGET_LANGUAGE_NAMES,
  formatTargetLanguages,
  parseTargetLanguages,
} from './target-languages';
import './styles/desktop.css';

export interface DesktopScreenProps {
  readonly profiles: readonly SiteProfile[];
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

/**
 * The context fields a public homepage may propose, named by their own label.
 *
 * The form tells the owner which of these the page said nothing about, so a
 * proposal that filled three fields of six does not read as a broken autofill.
 */
type ProfileContextLabel =
  | 'businessType'
  | 'businessDescription'
  | 'offerings'
  | 'operatingRegion'
  | 'targetLanguages'
  | 'targetAudience';

type TranslatableProfileContext = Pick<
  ProfileSuggestionsResponse,
  'industry' | 'businessDescription' | 'offerings' | 'region' | 'targetAudience'
>;

interface ProfileSuggestionsResponse {
  readonly name?: string;
  readonly businessDescription?: string;
  readonly offerings?: string;
  readonly industry?: string;
  readonly region?: string;
  readonly targetAudience?: string;
  readonly targetLanguages?: string;
}

interface ProfileContextField {
  readonly label: ProfileContextLabel;
  /** What the form holds now — a value the owner typed is never overwritten. */
  readonly current: string;
  /** What the page stated, or `undefined` when it stated nothing. */
  readonly value?: string;
  readonly set: (next: string) => void;
  readonly translationKey?: keyof TranslatableProfileContext;
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

/** What the owner should do next, from their sites and their latest scan. */
export function nextStepFor(profiles: readonly SiteProfile[], latest: Scan | null): NextStepKind {
  if (profiles.length === 0) return 'noProfiles';
  if (latest === null) return 'noScans';
  if (!isTerminalScanStatus(latest.status) || !isReportReady(latest)) return 'running';
  if (/failed|cancelled/i.test(latest.status)) return 'failed';
  // A Partial report reads, but a section came back incomplete and can be run
  // once more. Once that retry is spent, it is a finished report like any other.
  if (canRetrySection(latest)) return 'partial';
  return latest.plan === 'Free' ? 'freeDone' : 'paidDone';
}

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
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);
  /** The context fields the last proposal found no evidence for, still empty. */
  const [suggestedMissing, setSuggestedMissing] = useState<readonly ProfileContextLabel[]>([]);
  const [translatingContext, setTranslatingContext] = useState(false);
  const [translatedContext, setTranslatedContext] = useState<{
    readonly original: Partial<TranslatableProfileContext>;
    readonly translated: Partial<TranslatableProfileContext>;
  } | null>(null);
  const suggestionVersion = useRef(0);
  const suggestionAbort = useRef<AbortController | null>(null);
  const contextTranslationVersion = useRef(0);
  const contextTranslationAbort = useRef<AbortController | null>(null);
  const languageRef = useRef(props.language);
  const contextValuesRef = useRef<TranslatableProfileContext>({
    industry,
    businessDescription,
    offerings,
    region,
    targetAudience,
  });

  useEffect(() => {
    languageRef.current = props.language;
    // A locale change only changes UI copy. It must not translate a form the
    // owner already edited, or let an earlier request apply its old locale.
    invalidateContextTranslation();
  }, [props.language]);

  useEffect(() => {
    contextValuesRef.current = {
      industry,
      businessDescription,
      offerings,
      region,
      targetAudience,
    };
  }, [industry, businessDescription, offerings, region, targetAudience]);

  const invalidateContextTranslation = () => {
    contextTranslationVersion.current += 1;
    contextTranslationAbort.current?.abort();
    contextTranslationAbort.current = null;
    setTranslatingContext(false);
  };

  const invalidateSuggestions = () => {
    suggestionVersion.current += 1;
    suggestionAbort.current?.abort();
    suggestionAbort.current = null;
    setSuggesting(false);
  };

  const setContextValue = <Key extends keyof TranslatableProfileContext>(
    key: Key,
    value: string,
    set: (next: string) => void,
  ) => {
    contextValuesRef.current = { ...contextValuesRef.current, [key]: value };
    set(value);
  };
  const [formRequested, setFormRequested] = useState(false);
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

  /**
   * Keep the display name in step with the address until the owner takes it
   * over: an empty name, or one this form suggested, follows what is typed;
   * a name the owner edited stays exactly as they left it.
   */
  const updateSuggestedName = (address: string) => {
    if (name !== '' && name !== suggestedName) return;
    const next = siteNameFromAddress(address) ?? '';
    setSuggestedName(next);
    setName(next);
  };

  const clearSuggestionNotices = () => {
    setSuggested(false);
    setSuggestedMissing([]);
  };

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
    contextValuesRef.current = {
      industry: '',
      businessDescription: '',
      offerings: '',
      region: '',
      targetAudience: '',
    };
    setCompetitorsInput('');
    setDomainError(null);
    clearSuggestionNotices();
    setSuggesting(false);
    setTranslatedContext(null);
    invalidateSuggestions();
    invalidateContextTranslation();
  };

  const translateExtractedContext = async (
    original: TranslatableProfileContext,
    targetLanguage: Language,
  ): Promise<void> => {
    if (Object.keys(original).length === 0 || languageRef.current !== targetLanguage) return;
    contextTranslationAbort.current?.abort();
    const controller = new AbortController();
    contextTranslationAbort.current = controller;
    const version = contextTranslationVersion.current;
    setTranslatingContext(true);
    try {
      const translated = await apiRequest<Partial<TranslatableProfileContext>>(
        '/profiles/context-translation',
        {
          method: 'POST',
          body: JSON.stringify({ targetLanguage, ...original }),
          signal: controller.signal,
        },
      );
      if (contextTranslationVersion.current !== version || languageRef.current !== targetLanguage)
        return;
      const applied: Partial<TranslatableProfileContext> = {};
      const applyIfUnchanged = <Key extends keyof TranslatableProfileContext>(
        key: Key,
        set: (value: string) => void,
      ) => {
        const next = translated[key];
        const before = original[key];
        if (
          next !== undefined &&
          before !== undefined &&
          contextValuesRef.current[key] === before
        ) {
          setContextValue(key, next, set);
          applied[key] = next;
        }
      };
      applyIfUnchanged('industry', setIndustry);
      applyIfUnchanged('businessDescription', setBusinessDescription);
      applyIfUnchanged('offerings', setOfferings);
      applyIfUnchanged('region', setRegion);
      applyIfUnchanged('targetAudience', setTargetAudience);
      const appliedOriginal = Object.fromEntries(
        Object.keys(applied).map((key) => [key, original[key as keyof TranslatableProfileContext]]),
      ) as Partial<TranslatableProfileContext>;
      setTranslatedContext(
        Object.keys(applied).length === 0
          ? null
          : { original: appliedOriginal, translated: applied },
      );
    } catch {
      if (!controller.signal.aborted) props.onNotice(t.workspace.translateProfileUnavailable);
    } finally {
      if (contextTranslationVersion.current === version) {
        setTranslatingContext(false);
        contextTranslationAbort.current = null;
      }
    }
  };

  const suggestFromSite = async (): Promise<void> => {
    const normalized = normalizeSiteAddress(domain);
    if (!normalized.ok) {
      setDomainError(t.workspace.siteAddressError);
      return;
    }
    invalidateContextTranslation();
    setTranslatedContext(null);
    // A cancelled fetch may still settle. Each Fill gets its own generation so
    // an earlier response cannot apply after the owner asks for a newer one.
    invalidateSuggestions();
    const controller = new AbortController();
    suggestionAbort.current = controller;
    const version = suggestionVersion.current;
    const languageAtSubmit = props.language;
    setSuggesting(true);
    try {
      const suggestions = await apiRequest<ProfileSuggestionsResponse>('/profiles/suggestions', {
        method: 'POST',
        body: JSON.stringify({ domain: normalized.origin }),
        signal: controller.signal,
      });
      // An address or form edit made while the request was in flight wins.
      if (suggestionVersion.current !== version) return;
      const proposedName =
        name.trim() === '' || name === suggestedName ? suggestions.name : undefined;
      if (proposedName !== undefined) {
        setName(proposedName);
        setSuggestedName('');
      }
      const context: readonly ProfileContextField[] = [
        {
          label: 'businessType',
          current: industry,
          value: suggestions.industry,
          set: setIndustry,
          translationKey: 'industry',
        },
        {
          label: 'businessDescription',
          current: businessDescription,
          value: suggestions.businessDescription,
          set: setBusinessDescription,
          translationKey: 'businessDescription',
        },
        {
          label: 'offerings',
          current: offerings,
          value: suggestions.offerings,
          set: setOfferings,
          translationKey: 'offerings',
        },
        {
          label: 'operatingRegion',
          current: region,
          value: suggestions.region,
          set: setRegion,
          translationKey: 'region',
        },
        {
          label: 'targetLanguages',
          current: targetLanguages,
          value:
            suggestions.targetLanguages === undefined
              ? undefined
              : (() => {
                  const supported = parseTargetLanguages(suggestions.targetLanguages).filter(
                    (language) => PROFILE_TARGET_LANGUAGE_NAMES.includes(language),
                  );
                  return supported.length === 0 ? undefined : formatTargetLanguages(supported);
                })(),
          set: setTargetLanguages,
        },
        {
          label: 'targetAudience',
          current: targetAudience,
          value: suggestions.targetAudience,
          set: setTargetAudience,
          translationKey: 'targetAudience',
        },
      ];
      // A field the owner already wrote in is left alone whether the page stated
      // one or not, and is not reported as missing: they answered it themselves.
      const fillable = context.flatMap((field) =>
        field.value !== undefined && field.current.trim() === ''
          ? [{ set: field.set, value: field.value, translationKey: field.translationKey }]
          : [],
      );
      const extractedContext = fillable.reduce<Partial<TranslatableProfileContext>>(
        (result, field) =>
          field.translationKey === undefined
            ? result
            : { ...result, [field.translationKey]: field.value },
        {},
      );
      fillable.forEach((field) => {
        if (field.translationKey === undefined) field.set(field.value);
        else setContextValue(field.translationKey, field.value, field.set);
      });
      setSuggested(proposedName !== undefined || fillable.length > 0);
      setSuggestedMissing(
        context
          .filter((field) => field.value === undefined && field.current.trim() === '')
          .map((field) => field.label),
      );
      void translateExtractedContext(extractedContext, languageAtSubmit);
    } catch {
      if (!controller.signal.aborted) props.onNotice(t.workspace.suggestProfileUnavailable);
    } finally {
      if (suggestionVersion.current === version) {
        setSuggesting(false);
        suggestionAbort.current = null;
      }
    }
  };

  const restoreOriginalContext = () => {
    if (translatedContext === null) return;
    // Restoring is guarded by the exact translated value: an owner who edited a
    // field after the response keeps their newer wording.
    if (
      translatedContext.translated.industry !== undefined &&
      contextValuesRef.current.industry === translatedContext.translated.industry
    ) {
      setContextValue('industry', translatedContext.original.industry ?? industry, setIndustry);
    }
    if (
      translatedContext.translated.businessDescription !== undefined &&
      contextValuesRef.current.businessDescription ===
        translatedContext.translated.businessDescription
    ) {
      setContextValue(
        'businessDescription',
        translatedContext.original.businessDescription ?? businessDescription,
        setBusinessDescription,
      );
    }
    if (
      translatedContext.translated.offerings !== undefined &&
      contextValuesRef.current.offerings === translatedContext.translated.offerings
    ) {
      setContextValue('offerings', translatedContext.original.offerings ?? offerings, setOfferings);
    }
    if (
      translatedContext.translated.region !== undefined &&
      contextValuesRef.current.region === translatedContext.translated.region
    ) {
      setContextValue('region', translatedContext.original.region ?? region, setRegion);
    }
    if (
      translatedContext.translated.targetAudience !== undefined &&
      contextValuesRef.current.targetAudience === translatedContext.translated.targetAudience
    ) {
      setContextValue(
        'targetAudience',
        translatedContext.original.targetAudience ?? targetAudience,
        setTargetAudience,
      );
    }
    setTranslatedContext(null);
  };

  const openForm = () => {
    setFormRequested(true);
    window.requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ block: 'start' });
      formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    });
  };

  const editProfile = (profile: SiteProfile) => {
    invalidateSuggestions();
    clearSuggestionNotices();
    setTranslatedContext(null);
    invalidateContextTranslation();
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
    contextValuesRef.current = {
      industry: profile.industry ?? '',
      businessDescription: profile.businessDescription ?? '',
      offerings: profile.offerings ?? '',
      region: profile.region ?? '',
      targetAudience: profile.targetAudience ?? '',
    };
    setCompetitorsInput((profile.competitors ?? []).join(', '));
    setDomainError(null);
    window.requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: 'start' }));
  };

  const optionalText = (value: string): string | undefined => {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
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
        <Window title={t.workspace.sites}>
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
                <form className="stack" onSubmit={save}>
                  <p className="muted panel-help">{t.workspace.addSiteHelp}</p>
                  <Field
                    label={t.workspace.siteAddressLabel}
                    name="profile-domain"
                    autoComplete="url"
                    technical
                    value={domain}
                    onChange={(value) => {
                      invalidateSuggestions();
                      setDomain(value);
                      if (domainError !== null) setDomainError(null);
                      updateSuggestedName(value);
                    }}
                    placeholder={t.workspace.siteAddressPlaceholder}
                    hint={t.workspace.siteAddressHint}
                    error={domainError ?? undefined}
                    data-tour-target="profile-domain"
                  />
                  <Field
                    label={t.workspace.displayName}
                    name="profile-name"
                    autoComplete="off"
                    value={name}
                    onChange={(value) => {
                      invalidateSuggestions();
                      setName(value);
                    }}
                    placeholder={t.workspace.displayNamePlaceholder}
                  />
                  {/* Open by default only when there is context to show: a new
                      owner reaches the save button past two fields, not eight. */}
                  <details className="profile-context" open={editingProfile !== null && hasContext}>
                    <summary>{d.contextSummary}</summary>
                    <div className="stack">
                      <p className="muted">{t.workspace.profileContextHelp}</p>
                      <div className="stack profile-context-actions">
                        <p className="muted profile-suggestions">
                          {t.workspace.suggestProfileHelp}
                        </p>
                        <div className="button-row">
                          <Button
                            type="button"
                            onClick={() => void suggestFromSite()}
                            disabled={translatingContext || editingProfile !== null}
                          >
                            {suggesting
                              ? t.workspace.suggestingProfile
                              : t.workspace.suggestProfile}
                          </Button>
                          {translatedContext === null ? null : (
                            <Button type="button" onClick={restoreOriginalContext}>
                              {t.workspace.restoreProfileContextOriginal}
                            </Button>
                          )}
                        </div>
                        {translatingContext ? (
                          <p className="muted profile-suggestions">
                            {t.workspace.translatingProfileContext}
                          </p>
                        ) : null}
                        {suggested ? (
                          <p className="muted profile-suggestions">
                            {t.workspace.suggestedProfile}
                          </p>
                        ) : null}
                        {suggestedMissing.length === 0 ? null : (
                          <p className="muted profile-suggestions">
                            {fillCopy(t.workspace.suggestedProfileMissing, {
                              fields: new Intl.ListFormat(props.language, {
                                style: 'long',
                                type: 'conjunction',
                              }).format(
                                suggestedMissing.map(
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
                          // Autofill may propose this field now, so typing in it
                          // has to retire a proposal already in flight — see
                          // `invalidateSuggestions`.
                          invalidateSuggestions();
                          invalidateContextTranslation();
                          setContextValue('industry', value, setIndustry);
                        }}
                        placeholder={t.workspace.businessTypePlaceholder}
                        hint={t.workspace.businessTypeHint}
                      />
                      <TextAreaField
                        label={t.workspace.businessDescription}
                        name="profile-description"
                        autoComplete="off"
                        value={businessDescription}
                        onChange={(value) => {
                          invalidateSuggestions();
                          invalidateContextTranslation();
                          setContextValue('businessDescription', value, setBusinessDescription);
                        }}
                        placeholder={t.workspace.businessDescriptionPlaceholder}
                        hint={t.workspace.businessDescriptionHint}
                      />
                      <TextAreaField
                        label={t.workspace.offerings}
                        name="profile-offerings"
                        autoComplete="off"
                        value={offerings}
                        onChange={(value) => {
                          invalidateSuggestions();
                          invalidateContextTranslation();
                          setContextValue('offerings', value, setOfferings);
                        }}
                        placeholder={t.workspace.offeringsPlaceholder}
                        hint={t.workspace.offeringsHint}
                      />
                      <Field
                        label={t.workspace.operatingRegion}
                        name="profile-region"
                        autoComplete="off"
                        value={region}
                        onChange={(value) => {
                          invalidateSuggestions();
                          invalidateContextTranslation();
                          setContextValue('region', value, setRegion);
                        }}
                        placeholder={t.workspace.operatingRegionPlaceholder}
                        hint={t.workspace.operatingRegionHint}
                      />
                      <TargetLanguagesField
                        label={t.workspace.targetLanguages}
                        value={targetLanguages}
                        onChange={(value) => {
                          invalidateSuggestions();
                          setTargetLanguages(value);
                        }}
                        placeholder={t.workspace.targetLanguagesPlaceholder}
                        hint={t.workspace.targetLanguagesHint}
                        language={props.language}
                      />
                      <TextAreaField
                        label={t.workspace.targetAudience}
                        name="profile-audience"
                        autoComplete="off"
                        value={targetAudience}
                        onChange={(value) => {
                          invalidateSuggestions();
                          invalidateContextTranslation();
                          setContextValue('targetAudience', value, setTargetAudience);
                        }}
                        placeholder={t.workspace.targetAudiencePlaceholder}
                        hint={t.workspace.targetAudienceHint}
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
                      />
                    </div>
                  </details>
                  <div className="button-row">
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={busy || name.trim() === '' || competitorsFieldError !== undefined}
                      data-tour-target="save-profile"
                    >
                      {busy
                        ? t.workspace.saving
                        : editingProfile === null
                          ? t.workspace.saveProfile
                          : t.workspace.updateProfile}
                    </Button>
                    {editingProfile !== null || (formRequested && props.profiles.length > 0) ? (
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
        <Window title={d.nextStep.heading}>
          {latest === undefined ? null : (
            <NextStep
              language={props.language}
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
        <Button onClick={props.onNewScan} variant="primary">
          {t.newScan}
        </Button>
        <ActionMenu
          label={desktopCopy[props.language].rowActions(profile.name)}
          buttonRef={menuButtonRef}
          items={[
            { id: 'reports', label: t.inspect, onSelect: props.onReports },
            { id: 'edit', label: t.editProfile, onSelect: props.onEdit },
            {
              id: 'delete',
              label: t.deleteProfileAction,
              onSelect: props.onOpenDelete,
              danger: true,
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

function NextStep(props: {
  language: Language;
  kind: NextStepKind;
  profiles: readonly SiteProfile[];
  latest: Scan | null;
  onAddSite: () => void;
  onNewScan: (profile: SiteProfile, plan?: 'Free' | 'WebsiteAudit' | 'Complete') => void;
  onOpenScan: (scanId: string) => void;
  onRetryScan: (scanId: string) => Promise<void>;
}) {
  const d = desktopCopy[props.language].nextStep;
  const [retrying, setRetrying] = useState(false);
  const { kind, latest } = props;
  const profile =
    props.profiles.find((candidate) => candidate.id === latest?.profileId) ?? props.profiles[0];
  const domain =
    latest !== null ? displayDomain(latest.domain) : profile ? displayDomain(profile.domain) : '';
  const act = (): void => {
    if (kind === 'noProfiles') {
      props.onAddSite();
      return;
    }
    if (kind === 'noScans' && profile) {
      props.onNewScan(profile, 'Free');
      return;
    }
    if (kind === 'freeDone' && profile) {
      props.onNewScan(profile, 'Complete');
      return;
    }
    if (kind === 'partial' && latest !== null) {
      setRetrying(true);
      void props.onRetryScan(latest.id).finally(() => setRetrying(false));
      return;
    }
    if (latest !== null) props.onOpenScan(latest.id);
  };
  return (
    <Panel title={d.titles[kind]} className="next-step">
      <p>{d.bodies[kind](domain)}</p>
      <div className="button-row">
        <Button variant="primary" onClick={act} disabled={retrying}>
          {d.actions[kind](domain)}
        </Button>
        {kind === 'freeDone' && latest !== null ? (
          <Button onClick={() => props.onOpenScan(latest.id)}>{d.freeReport}</Button>
        ) : null}
        {kind === 'partial' && latest !== null ? (
          <Button onClick={() => props.onOpenScan(latest.id)}>{d.openReport}</Button>
        ) : null}
      </div>
    </Panel>
  );
}
