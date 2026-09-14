// Links a FluxRadar profile to the Google properties the connected account can
// read. Nothing here is speculative: the lists come from Google's own read-only
// discovery endpoints, and an empty or refused list is explained in words
// instead of being shown as a failed request.
//
// It is rendered inside the Google row of the integrations list, because what it
// configures belongs to that one connection — not to integrations in general.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  apiRequest,
  ApiRequestError,
  type GoogleBinding,
  type GoogleDiscovery,
  type SiteProfile,
} from './api';
import { Button, EmptyState, Panel, SelectField } from './components';
import { GoogleDomains } from './GoogleDomains';
import { originProblemCopy, type GoogleCopy } from './google-copy';
import { copy, fillCopy, type Language } from './i18n';
import { originFromSearchConsoleProperty } from './search-console-origin';

const NONE = '';

/**
 * The one sentence the panel is currently saying about its own last action.
 *
 * A single slot rather than a notice and an error side by side: the outcome of a
 * save or a create replaces whatever came before it, and two stacked messages
 * from two different actions is how a screen starts contradicting itself.
 */
type PanelMessage = { readonly tone: 'ok' | 'error'; readonly text: string } | null;

interface Props {
  readonly profiles: readonly SiteProfile[];
  readonly connected: boolean;
  readonly language: Language;
  /** Sends the owner to the workspace screen that holds the add-profile form. */
  readonly onAddProfile: () => void;
  /** Reloads the account's profiles after this panel created one. */
  readonly onProfilesChanged: () => Promise<void>;
}

type DiscoveryService = 'searchConsole' | 'analytics';

/**
 * Why a property list is empty or missing, in the reader's language.
 *
 * The server's English sentence used to be rendered as it came, so a Ukrainian
 * screen said "This Google account cannot read the selected property" when
 * Google had refused to *list* the Analytics properties and nothing was
 * selected. The state and the reason code pick the sentence here instead.
 */
function discoveryNotice(
  t: GoogleCopy,
  service: DiscoveryService,
  section: GoogleDiscovery[DiscoveryService],
): string | null {
  const name = service === 'searchConsole' ? t.serviceSearchConsole : t.serviceAnalytics;
  switch (section.state) {
    case 'connected':
      return null;
    case 'no_data':
      return service === 'searchConsole'
        ? t.discoveryEmptySearchConsole
        : t.discoveryEmptyAnalytics;
    case 'not_connected':
    case 'needs_reconnect':
      return t.discoveryReconnect;
    case 'no_access':
      return fillCopy(
        section.reason === 'missing_scope' ? t.discoveryMissingScope : t.discoveryDenied,
        { service: name },
      );
    default:
      return t.discoveryFailed;
  }
}

/**
 * The sentence shown for a failed save or link.
 *
 * The "you do not have that property" refusal is already a sentence an owner
 * can act on, and it names the property; anything else is not.
 */
function saveFailureCopy(t: GoogleCopy, error: unknown): string {
  return error instanceof ApiRequestError && error.code === 'GOOGLE_PROPERTY_NOT_AVAILABLE'
    ? error.message
    : t.saveFailed;
}

/**
 * Every binding of the account, or null when the list could not be read.
 *
 * The domain overview offers Link only for a profile it believes reads no
 * domain, so an unreadable or malformed list must replace the overview with a
 * notice rather than read as "nothing linked". The selectors of the chosen
 * profile do not depend on it and keep working.
 */
async function loadBindings(): Promise<readonly GoogleBinding[] | null> {
  try {
    const bindings = await apiRequest<unknown>('/integrations/google/bindings');
    return Array.isArray(bindings) ? (bindings as readonly GoogleBinding[]) : null;
  } catch {
    return null;
  }
}

/**
 * The sentence shown for a failed create, chosen by the API's own error code.
 *
 * Server prose is never rendered here: "a profile for this domain already
 * exists" is a correct sentence for a developer and a dead end for an owner who
 * has to be told what to do instead.
 */
function createFailureCopy(t: GoogleCopy, error: unknown): string {
  const code = error instanceof ApiRequestError ? error.code : null;
  if (code === 'DOMAIN_EXISTS') return t.createDuplicate;
  if (code === 'GOOGLE_PROPERTY_NOT_AVAILABLE') return t.createUnsupported;
  return t.createFailed;
}

export function GoogleProperties(props: Props) {
  const t = copy[props.language].integrations.google;
  const [profileId, setProfileId] = useState(props.profiles[0]?.id ?? NONE);
  const [discovery, setDiscovery] = useState<GoogleDiscovery | null>(null);
  const [binding, setBinding] = useState<GoogleBinding | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<PanelMessage>(null);
  const [creatingProperty, setCreatingProperty] = useState<string | null>(null);
  const [linkingProperty, setLinkingProperty] = useState<string | null>(null);
  /**
   * Every profile's binding, for the domain overview; null until read, or when it
   * could not be. `binding` is the selected profile's.
   */
  const [bindings, setBindings] = useState<readonly GoogleBinding[] | null>(null);
  /**
   * The profile whose binding the selectors were last filled from. Until it is
   * the selected profile, the selectors show "Not linked" for want of an answer,
   * and saving them would unlink whatever that profile really reads.
   */
  const [loadedProfileId, setLoadedProfileId] = useState<string | null>(null);
  const [searchConsoleSiteUrl, setSearchConsoleSiteUrl] = useState(NONE);
  const [ga4PropertyId, setGa4PropertyId] = useState(NONE);
  // A profile can change while Google is answering. Generations distinguish
  // A→B→A as well as A→B, so an older response can never repaint the current
  // selectors or announce a save for the wrong profile.
  const loadGeneration = useRef(0);
  const saveGeneration = useRef(0);
  // Every binding change the panel made itself bumps this, so a reload that was
  // already on its way cannot put back the list from before that change.
  const bindingsRevision = useRef(0);
  // The profile a create just made. The profile list reloads after the create,
  // and until it contains the new profile, "the selected profile is gone" must
  // not throw the selection back to the first profile and wipe the message.
  const createdProfileId = useRef<string | null>(null);

  const hasProfiles = props.profiles.length > 0;

  useEffect(() => {
    if (props.profiles.some((profile) => profile.id === createdProfileId.current)) {
      createdProfileId.current = null;
    }
    if (
      hasProfiles &&
      profileId !== createdProfileId.current &&
      !props.profiles.some((profile) => profile.id === profileId)
    ) {
      loadGeneration.current += 1;
      saveGeneration.current += 1;
      setProfileId(props.profiles[0]?.id ?? NONE);
      setBinding(null);
      setSearchConsoleSiteUrl(NONE);
      setGa4PropertyId(NONE);
      setMessage(null);
    }
  }, [props.profiles, profileId, hasProfiles]);

  useEffect(
    () => () => {
      loadGeneration.current += 1;
      saveGeneration.current += 1;
    },
    [],
  );

  /**
   * Discovery runs as soon as Google is connected, with or without a profile:
   * an account that has connected Google but saved nothing yet is exactly the
   * one that needs to see which Search Console properties it could start from.
   * The binding is per profile, so it is only read when one is selected.
   *
   * It reports a failure but never clears the message slot — this also runs
   * right after a create, and wiping what that create just reported would be
   * the panel forgetting the only thing the owner is waiting to read.
   */
  const load = useCallback(async () => {
    if (!props.connected) return;
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    const revision = bindingsRevision.current;
    setLoading(true);
    setLoadedProfileId(null);
    setBinding(null);
    setSearchConsoleSiteUrl(NONE);
    setGa4PropertyId(NONE);
    try {
      const [properties, current, all] = await Promise.all([
        apiRequest<GoogleDiscovery>('/integrations/google/properties'),
        profileId === NONE
          ? Promise.resolve(null)
          : apiRequest<GoogleBinding | null>(`/profiles/${profileId}/google-binding`),
        loadBindings(),
      ]);
      if (loadGeneration.current !== generation) return;
      setDiscovery(properties);
      if (bindingsRevision.current === revision) setBindings(all);
      // The selectors take the fetched binding unconditionally. No save, link or
      // create can start while a load runs, and none of them can start a load of
      // the profile it is changing (see `isMutating` and `isLocked` below), so
      // nothing newer than this answer can exist for the selected profile.
      setBinding(current);
      setSearchConsoleSiteUrl(current?.searchConsoleSiteUrl ?? NONE);
      setGa4PropertyId(current?.ga4PropertyId ?? NONE);
      setLoadedProfileId(profileId);
    } catch {
      if (loadGeneration.current === generation) {
        setMessage({ tone: 'error', text: t.loadFailed });
      }
    } finally {
      if (loadGeneration.current === generation) setLoading(false);
    }
  }, [profileId, props.connected, t.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectProfile = (value: string) => {
    if (value === profileId) return;
    loadGeneration.current += 1;
    saveGeneration.current += 1;
    setProfileId(value);
    setBinding(null);
    setSearchConsoleSiteUrl(NONE);
    setGa4PropertyId(NONE);
    setLoading(true);
    setSaving(false);
    // Whatever the panel last said was about the previous profile.
    setMessage(null);
  };

  const refresh = () => {
    setMessage(null);
    void load();
  };

  /** Keeps the domain overview in step with a binding the API just returned. */
  const rememberBinding = (updated: GoogleBinding) => {
    bindingsRevision.current += 1;
    // A list that could not be read stays unknown: one known binding does not
    // make the others known.
    setBindings((current) =>
      current === null
        ? null
        : [...current.filter((entry) => entry.siteProfileId !== updated.siteProfileId), updated],
    );
  };

  /**
   * Links a Search Console domain to the profile at its address, keeping that
   * profile's Analytics property. The profile need not be the one selected in
   * the pickers; when it is, the pickers follow.
   *
   * The overview always takes the answer. The pickers and the message take it
   * only while nothing else moved the panel on: a profile switch or a save
   * bumps the save generation, exactly as for `save`, so a late reply cannot
   * paint one profile's domain into another profile's pickers.
   */
  const linkDomain = async (profile: SiteProfile, siteUrl: string) => {
    const generation = saveGeneration.current;
    setLinkingProperty(siteUrl);
    setMessage(null);
    try {
      const current = bindings?.find((entry) => entry.siteProfileId === profile.id);
      const linked = await apiRequest<GoogleBinding>(`/profiles/${profile.id}/google-binding`, {
        method: 'PUT',
        body: JSON.stringify({
          searchConsoleSiteUrl: siteUrl,
          ga4PropertyId: current?.ga4PropertyId ?? null,
        }),
      });
      rememberBinding(linked);
      if (saveGeneration.current !== generation) return;
      if (profile.id === profileId) {
        setBinding(linked);
        setSearchConsoleSiteUrl(linked.searchConsoleSiteUrl ?? NONE);
      }
      setMessage({
        tone: 'ok',
        text: fillCopy(t.domainLinkedMessage, { property: siteUrl, name: profile.name }),
      });
    } catch (caught) {
      if (saveGeneration.current !== generation) return;
      setMessage({ tone: 'error', text: saveFailureCopy(t, caught) });
    } finally {
      setLinkingProperty(null);
    }
  };

  const save = async () => {
    const generation = saveGeneration.current + 1;
    saveGeneration.current = generation;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await apiRequest<GoogleBinding>(`/profiles/${profileId}/google-binding`, {
        method: 'PUT',
        body: JSON.stringify({
          searchConsoleSiteUrl: searchConsoleSiteUrl === NONE ? null : searchConsoleSiteUrl,
          ga4PropertyId: ga4PropertyId === NONE ? null : ga4PropertyId,
        }),
      });
      rememberBinding(updated);
      if (saveGeneration.current !== generation) return;
      setBinding(updated);
      setMessage({
        tone: 'ok',
        text:
          updated.searchConsoleSiteUrl === null && updated.ga4PropertyId === null
            ? t.savedUnlinked
            : t.savedLinked,
      });
    } catch (caught) {
      if (saveGeneration.current !== generation) return;
      setMessage({ tone: 'error', text: saveFailureCopy(t, caught) });
    } finally {
      if (saveGeneration.current === generation) setSaving(false);
    }
  };

  /**
   * Creates a real profile for a Search Console property, then links the two.
   *
   * The address comes from the property itself and is re-validated by the API,
   * which is also what decides whether the profile exists at all; a property
   * with no usable https origin is refused here rather than turned into an
   * invented URL. The link is a second request because the API has no combined
   * create-and-bind route — so a create that succeeds and a link that fails says
   * exactly that, instead of pretending the profile is not there.
   */
  const createFromProperty = async (siteUrl: string) => {
    const converted = originFromSearchConsoleProperty(siteUrl);
    if (!converted.ok) {
      setMessage({ tone: 'error', text: originProblemCopy(t, converted.reason) });
      return;
    }
    setCreatingProperty(siteUrl);
    setMessage(null);
    let created: SiteProfile;
    try {
      created = await apiRequest<SiteProfile>('/profiles', {
        method: 'POST',
        body: JSON.stringify({ name: converted.host, domain: converted.origin }),
      });
    } catch (caught) {
      setMessage({ tone: 'error', text: createFailureCopy(t, caught) });
      setCreatingProperty(null);
      return;
    }
    try {
      const linked = await apiRequest<GoogleBinding>(`/profiles/${created.id}/google-binding`, {
        method: 'PUT',
        body: JSON.stringify({ searchConsoleSiteUrl: siteUrl, ga4PropertyId: null }),
      });
      rememberBinding(linked);
      setBinding(linked);
      setSearchConsoleSiteUrl(linked.searchConsoleSiteUrl ?? NONE);
      setGa4PropertyId(linked.ga4PropertyId ?? NONE);
      setMessage({
        tone: 'ok',
        text: fillCopy(t.createdLinked, { name: created.name, property: siteUrl }),
      });
    } catch {
      setBinding(null);
      setSearchConsoleSiteUrl(NONE);
      setGa4PropertyId(NONE);
      setMessage({ tone: 'error', text: fillCopy(t.createdUnlinked, { name: created.name }) });
    } finally {
      // Selecting the new profile is what makes the pickers describe it, so it
      // happens whether or not the link landed. See `createdProfileId`.
      createdProfileId.current = created.id;
      setProfileId(created.id);
      try {
        await props.onProfilesChanged();
      } catch {
        // Without the reloaded list the new profile is not in the picker, and a
        // selection the picker cannot show would send the next Save to it. The
        // selection goes back to a profile the picker lists, and the owner is
        // told the profile exists.
        createdProfileId.current = null;
        loadGeneration.current += 1;
        saveGeneration.current += 1;
        setProfileId(props.profiles[0]?.id ?? NONE);
        setMessage({ tone: 'error', text: fillCopy(t.createdListFailed, { name: created.name }) });
      } finally {
        // The profile choice stays locked until the picker's list has caught up
        // with the create: picked during the reload, a profile could be undone by
        // the reset above and leave the panel waiting on a load it cancelled.
        setCreatingProperty(null);
      }
    }
  };

  if (!props.connected) {
    return (
      <Panel title={t.title} className="google-properties">
        <p className="muted">{t.notConnected}</p>
      </Panel>
    );
  }

  // A link or a create changes which profile reads what. While one runs, the
  // profile choice, Save and Refresh wait, so no answer from before it can land
  // after it. Every row action, and Refresh, also waits while the panel loads or
  // saves.
  const isMutating = linkingProperty !== null || creatingProperty !== null;
  const isLocked = loading || saving || isMutating;

  const searchConsoleSites = discovery?.searchConsole.items ?? [];
  const searchConsoleNotice =
    discovery === null ? null : discoveryNotice(t, 'searchConsole', discovery.searchConsole);
  const analyticsNotice =
    discovery === null ? null : discoveryNotice(t, 'analytics', discovery.analytics);

  const messageBlock =
    message === null ? null : (
      <p
        className={message.tone === 'ok' ? 'integration-notice' : 'integration-row__error'}
        role="status"
      >
        {message.text}
      </p>
    );

  // Connected Google, nothing saved yet. An empty property picker would be a
  // control with nothing to pick, so the panel offers the two ways to get a
  // profile instead: from a Search Console property, or by hand.
  if (!hasProfiles) {
    return (
      <Panel title={t.title} className="google-properties">
        <p className="muted">{t.readOnly}</p>
        <EmptyState
          title={t.emptyTitle}
          description={t.emptyBody}
          action={
            <Button variant="primary" onClick={props.onAddProfile}>
              {t.emptyAction}
            </Button>
          }
        />
        {messageBlock}
        {loading ? (
          <p className="muted" role="status">
            {t.loading}
          </p>
        ) : searchConsoleSites.length > 0 ? (
          <section className="google-properties__create" aria-label={t.createHeading}>
            <h3 className="section-heading">{t.createHeading}</h3>
            <p className="muted">{t.createBody}</p>
            <div className="google-properties__list">
              {searchConsoleSites.map((site) => (
                <div className="google-properties__row" key={site.siteUrl}>
                  <span className="technical">{site.siteUrl}</span>
                  <Button
                    disabled={creatingProperty !== null}
                    onClick={() => void createFromProperty(site.siteUrl)}
                    aria-label={`${t.create} · ${site.siteUrl}`}
                  >
                    {creatingProperty === site.siteUrl ? t.creating : t.create}
                  </Button>
                </div>
              ))}
            </div>
          </section>
        ) : discovery === null ? null : (
          // Discovery answered and had nothing to offer. A failed discovery
          // leaves this out entirely: "no property to start from" and "we could
          // not ask" are different facts, and only the error is known here.
          <>
            <p className="muted">
              {searchConsoleNotice === null || discovery.searchConsole.state === 'no_data'
                ? t.noProperties
                : searchConsoleNotice}
            </p>
            <p className="muted">{t.analyticsOnlyNote}</p>
          </>
        )}
      </Panel>
    );
  }

  return (
    <Panel title={t.title} className="google-properties">
      <p className="muted">{t.readOnly}</p>
      <SelectField
        label={t.profileLabel}
        value={profileId}
        onChange={selectProfile}
        disabled={isMutating}
        options={props.profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
      />
      {messageBlock}
      {loading ? (
        <p className="muted" role="status">
          {t.loading}
        </p>
      ) : (
        <>
          <SelectField
            label={t.searchConsoleLabel}
            technical
            value={searchConsoleSiteUrl}
            onChange={setSearchConsoleSiteUrl}
            error={searchConsoleNotice ?? undefined}
            options={[
              { value: NONE, label: t.notLinked },
              ...searchConsoleSites.map((site) => ({ value: site.siteUrl, label: site.siteUrl })),
            ]}
          />
          <SelectField
            label={t.analyticsLabel}
            value={ga4PropertyId}
            onChange={setGa4PropertyId}
            error={analyticsNotice ?? undefined}
            options={[
              { value: NONE, label: t.notLinked },
              ...(discovery?.analytics.items ?? []).map((property) => ({
                value: property.propertyId,
                label: `${property.displayName} · ${property.accountName}`,
              })),
            ]}
          />
          <div className="button-row">
            <Button
              variant="primary"
              disabled={saving || isMutating || loadedProfileId !== profileId}
              onClick={() => void save()}
            >
              {saving ? t.saving : t.save}
            </Button>
            <Button disabled={loading || saving || isMutating} onClick={refresh}>
              {t.refresh}
            </Button>
          </div>
          {binding === null && message === null ? <p className="muted">{t.noBinding}</p> : null}
        </>
      )}
      {/* Outside the loading branch: choosing Configure switches the profile
          above, and a list that vanished while it reloaded would jump the
          page away from the row that was just clicked. */}
      {discovery === null ? null : bindings === null ? (
        <p className="muted">{t.domainsUnavailable}</p>
      ) : (
        <GoogleDomains
          sites={searchConsoleSites}
          profiles={props.profiles}
          bindings={bindings}
          language={props.language}
          actions={{
            busySiteUrl: linkingProperty ?? creatingProperty,
            isLocked,
            onConfigure: selectProfile,
            onLink: (profile, siteUrl) => void linkDomain(profile, siteUrl),
            onCreate: (siteUrl) => void createFromProperty(siteUrl),
          }}
        />
      )}
    </Panel>
  );
}
