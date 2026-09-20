// The workspace desktop: the owner's saved sites, the form that adds one, and
// the one thing to do next.
//
// Three things changed here. The add-profile form was always open — eight
// fields under every list, however many sites it already held — so it now
// folds behind "+ Add a site" once there is a site, with the six AI-context
// fields folded again inside it. A site's delete button stood shoulder to
// shoulder with "Edit" at the same weight; it now sits apart. And the right
// column's terminal repeated the price list in four hard-coded English lines;
// it now names the owner's next step, worked out from their own last scan.

import { useCallback, useRef, useState, type FormEvent } from 'react';

import { apiRequest, canRetrySection, type Scan, type SiteProfile } from './api';
import { Button, EmptyState, Field, Panel, TextAreaField, Window } from './components';
import { desktopCopy, type NextStepKind } from './desktop-copy';
import { copy, type Language } from './i18n';
import { ProfileDeletion } from './ProfileDeletion';
import { displayDomain, isTerminalScanStatus } from './scan-status';
import { normalizeSiteAddress, siteNameFromAddress } from './site-address-input';
import { SiteStatusPanel } from './SiteStatus';
import { TargetLanguagesField } from './TargetLanguagesField';
import './styles/desktop.css';

export interface DesktopScreenProps {
  readonly profiles: readonly SiteProfile[];
  readonly onRefresh: () => Promise<void>;
  /** Called once a profile is gone, so screens still holding it can let it go. */
  readonly onProfileDeleted: (profile: SiteProfile) => void;
  readonly onSelectProfile: (profile: SiteProfile) => void;
  readonly onNewScan: (profile: SiteProfile, plan?: 'Free' | 'Complete') => void;
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

/** What the owner should do next, from their sites and their latest scan. */
export function nextStepFor(profiles: readonly SiteProfile[], latest: Scan | null): NextStepKind {
  if (profiles.length === 0) return 'noProfiles';
  if (latest === null) return 'noScans';
  if (!isTerminalScanStatus(latest.status)) return 'running';
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
  const [editingProfile, setEditingProfile] = useState<SiteProfile | null>(null);
  /** The one row whose delete confirmation is open; opening another closes it. */
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  // The last name this form filled in from the address. Anything else in the
  // name field was typed by the owner and is never overwritten.
  const [suggestedName, setSuggestedName] = useState('');
  const [domain, setDomain] = useState('');
  const [domainError, setDomainError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formRequested, setFormRequested] = useState(false);
  const [latest, setLatest] = useState<Scan | null | undefined>(undefined);
  const formRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const formOpen =
    props.profiles.length === 0 ||
    editingProfile !== null ||
    formRequested ||
    props.tourActive === true;
  const hasContext = [
    industry,
    businessDescription,
    offerings,
    region,
    targetLanguages,
    targetAudience,
  ].some((value) => value.trim() !== '');

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
    setDomainError(null);
  };

  const openForm = () => {
    setFormRequested(true);
    window.requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ block: 'start' });
      formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    });
  };

  const editProfile = (profile: SiteProfile) => {
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
                      onToggleDelete={() =>
                        setDeletingProfileId((current) =>
                          current === profile.id ? null : profile.id,
                        )
                      }
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
              {formOpen ? null : (
                <div className="button-row profile-add-toggle">
                  <Button onClick={openForm}>{d.addSiteToggle}</Button>
                </div>
              )}
            </Panel>
          </div>
          {formOpen ? (
            <div ref={formRef}>
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
                    onChange={setName}
                    placeholder={t.workspace.displayNamePlaceholder}
                  />
                  {/* Open by default only when there is context to show: a new
                      owner reaches the save button past two fields, not eight. */}
                  <details className="profile-context" open={editingProfile !== null && hasContext}>
                    <summary>{d.contextSummary}</summary>
                    <div className="stack">
                      <p className="muted">{t.workspace.profileContextHelp}</p>
                      <Field
                        label={t.workspace.businessType}
                        name="profile-industry"
                        autoComplete="off"
                        value={industry}
                        onChange={setIndustry}
                        placeholder={t.workspace.businessTypePlaceholder}
                        hint={t.workspace.businessTypeHint}
                      />
                      <TextAreaField
                        label={t.workspace.businessDescription}
                        name="profile-description"
                        autoComplete="off"
                        value={businessDescription}
                        onChange={setBusinessDescription}
                        placeholder={t.workspace.businessDescriptionPlaceholder}
                        hint={t.workspace.businessDescriptionHint}
                      />
                      <TextAreaField
                        label={t.workspace.offerings}
                        name="profile-offerings"
                        autoComplete="off"
                        value={offerings}
                        onChange={setOfferings}
                        placeholder={t.workspace.offeringsPlaceholder}
                        hint={t.workspace.offeringsHint}
                      />
                      <Field
                        label={t.workspace.operatingRegion}
                        name="profile-region"
                        autoComplete="off"
                        value={region}
                        onChange={setRegion}
                        placeholder={t.workspace.operatingRegionPlaceholder}
                        hint={t.workspace.operatingRegionHint}
                      />
                      <TargetLanguagesField
                        label={t.workspace.targetLanguages}
                        value={targetLanguages}
                        onChange={setTargetLanguages}
                        placeholder={t.workspace.targetLanguagesPlaceholder}
                        hint={t.workspace.targetLanguagesHint}
                        language={props.language}
                      />
                      <TextAreaField
                        label={t.workspace.targetAudience}
                        name="profile-audience"
                        autoComplete="off"
                        value={targetAudience}
                        onChange={setTargetAudience}
                        placeholder={t.workspace.targetAudiencePlaceholder}
                        hint={t.workspace.targetAudienceHint}
                      />
                    </div>
                  </details>
                  <div className="button-row">
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={busy || name.trim() === ''}
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
  onToggleDelete: () => void;
  onNewScan: () => void;
  onReports: () => void;
  onEdit: () => void;
  onDeleted: (profile: SiteProfile) => Promise<void>;
  onError: (value: string) => void;
}) {
  const t = copy[props.language].workspace;
  const { profile } = props;
  const deletionId = `profile-deletion-${profile.id}`;
  return (
    <div className="profile-row">
      <div>
        <strong>{profile.name}</strong>
        <span className="profile-row__domain">{profile.domain}</span>
      </div>
      <div className="profile-row__actions">
        <Button onClick={props.onNewScan} variant="primary">
          {t.newScan}
        </Button>
        <Button onClick={props.onReports} aria-label={`${t.inspect}: ${profile.name}`}>
          {t.inspect}
        </Button>
        <Button onClick={props.onEdit}>{t.editProfile}</Button>
        {/* Apart from the rest, so the irreversible action is never the
            neighbour of an everyday one. */}
        <span className="profile-row__danger">
          <Button
            variant="danger"
            onClick={props.onToggleDelete}
            aria-expanded={props.deleting}
            aria-controls={deletionId}
          >
            {t.deleteProfileAction}
          </Button>
        </span>
      </div>
      {props.deleting ? (
        <div className="profile-row__deletion" id={deletionId}>
          <ProfileDeletion
            profile={profile}
            language={props.language}
            onDeleted={props.onDeleted}
            onError={props.onError}
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
  onNewScan: (profile: SiteProfile, plan?: 'Free' | 'Complete') => void;
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
