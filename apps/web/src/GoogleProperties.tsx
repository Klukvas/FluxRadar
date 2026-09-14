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
import { copy, fillCopy, type Language } from './i18n';
import { originFromSearchConsoleProperty } from './search-console-origin';

const NONE = '';

type GoogleCopy = (typeof copy)[Language]['integrations']['google'];

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
  const [searchConsoleSiteUrl, setSearchConsoleSiteUrl] = useState(NONE);
  const [ga4PropertyId, setGa4PropertyId] = useState(NONE);
  // A profile can change while Google is answering. Generations distinguish
  // A→B→A as well as A→B, so an older response can never repaint the current
  // selectors or announce a save for the wrong profile.
  const loadGeneration = useRef(0);
  const saveGeneration = useRef(0);

  const hasProfiles = props.profiles.length > 0;

  useEffect(() => {
    if (hasProfiles && !props.profiles.some((profile) => profile.id === profileId)) {
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
    setLoading(true);
    setBinding(null);
    setSearchConsoleSiteUrl(NONE);
    setGa4PropertyId(NONE);
    try {
      const [properties, current] = await Promise.all([
        apiRequest<GoogleDiscovery>('/integrations/google/properties'),
        profileId === NONE
          ? Promise.resolve(null)
          : apiRequest<GoogleBinding | null>(`/profiles/${profileId}/google-binding`),
      ]);
      if (loadGeneration.current !== generation) return;
      setDiscovery(properties);
      setBinding(current);
      setSearchConsoleSiteUrl(current?.searchConsoleSiteUrl ?? NONE);
      setGa4PropertyId(current?.ga4PropertyId ?? NONE);
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
      // The "you do not have that property" refusal is already a sentence an
      // owner can act on, and it names the property; anything else is not.
      setMessage({
        tone: 'error',
        text:
          caught instanceof ApiRequestError && caught.code === 'GOOGLE_PROPERTY_NOT_AVAILABLE'
            ? caught.message
            : t.saveFailed,
      });
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
      setMessage({
        tone: 'error',
        text: converted.reason === 'insecure_scheme' ? t.createInsecure : t.createUnsupported,
      });
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
      // happens whether or not the link landed.
      setProfileId(created.id);
      setCreatingProperty(null);
      await props.onProfilesChanged();
    }
  };

  if (!props.connected) {
    return (
      <Panel title={t.title} className="google-properties">
        <p className="muted">{t.notConnected}</p>
      </Panel>
    );
  }

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
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? t.saving : t.save}
            </Button>
            <Button disabled={loading} onClick={refresh}>
              {t.refresh}
            </Button>
          </div>
          {binding === null && message === null ? <p className="muted">{t.noBinding}</p> : null}
        </>
      )}
    </Panel>
  );
}
