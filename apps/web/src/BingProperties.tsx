// Links a FluxRadar profile to the Bing Webmaster site whose data its reports
// should include.
//
// It is rendered inside the Bing row of the integrations list, because what it
// configures belongs to that one connection. The list comes from Bing's own
// read-only discovery call, so nothing here is speculative: a site the connected
// account cannot see is not offered, and the server refuses a binding to one
// anyway.
//
// Three things it is careful to say out loud:
//
//   * a site Bing has not verified is listed rather than hidden, and marked. An
//     owner who added a site to Bing and never finished verifying it needs to be
//     told that; a list that silently omitted it reads as "Bing does not know
//     this site", which sends them to the wrong place entirely.
//   * a property whose host is not the profile's domain is accepted and named.
//     A subdomain, or another host the owner verified with Bing, is a legitimate
//     choice and the server allows it — but the figures in that profile's
//     reports will then describe that property, and only a notice says so.
//   * an empty or refused list is explained in the reader's own language. The
//     API's sentence is English, and it is used only for a state this build has
//     no wording for.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  apiRequest,
  ApiRequestError,
  type BingBinding,
  type BingDiscovery,
  type SiteProfile,
} from './api';
import { Button, EmptyState, Panel, SelectField } from './components';
import { copy, fillCopy, type Language } from './i18n';

const NONE = '';

/** Keyed by `Language`, so both dictionaries widen to one type. */
type BingCopy = (typeof copy)[Language]['integrations']['bing'];

/** A single message slot: the outcome of the last action replaces the one before. */
type PanelMessage = { readonly tone: 'ok' | 'error'; readonly text: string } | null;

interface Props {
  readonly profiles: readonly SiteProfile[];
  readonly connected: boolean;
  readonly language: Language;
  /** Sends the owner to the workspace screen that holds the add-profile form. */
  readonly onAddProfile: () => void;
}

/** Why the site list is empty or missing, in the reader's language. */
function discoveryNotice(t: BingCopy, discovery: BingDiscovery | null): string | null {
  if (discovery === null) return null;
  switch (discovery.sites.state) {
    case 'connected':
      return null;
    case 'no_data':
      return t.discoveryEmpty;
    case 'not_connected':
    case 'needs_reconnect':
      return t.discoveryReconnect;
    case 'no_access':
      return discovery.sites.reason === 'missing_scope'
        ? t.discoveryMissingScope
        : t.discoveryDenied;
    default:
      return t.discoveryFailed;
  }
}

/** The sentence for a failed save. The server's own refusal is already actionable. */
function saveFailureCopy(t: BingCopy, error: unknown): string {
  return error instanceof ApiRequestError && error.code === 'BING_SITE_NOT_AVAILABLE'
    ? error.message
    : t.saveFailed;
}

/** A site URL or a bare host, reduced to the host both can be compared on. */
function hostOf(value: string): string {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

/**
 * The chosen property's host when it is not the profile's own domain.
 *
 * NOT A REFUSAL. Binding a subdomain property, or a host the owner verified with
 * Bing under another name, is legitimate and the server accepts any site the
 * account's own grant can read — the same rule the Google binding follows. What
 * was missing is anyone saying so: a report would then carry `shop.example.com`
 * figures under an `example.com` heading with nothing to mark the difference.
 */
function mismatchedHost(siteUrl: string, profileDomain: string | undefined): string | null {
  if (siteUrl === NONE || profileDomain === undefined || profileDomain === '') return null;
  const property = hostOf(siteUrl);
  const domain = hostOf(profileDomain);
  return property === '' || domain === '' || property === domain ? null : property;
}

export function BingProperties(props: Props) {
  const t = copy[props.language].integrations.bing;
  const [profileId, setProfileId] = useState(props.profiles[0]?.id ?? NONE);
  const [discovery, setDiscovery] = useState<BingDiscovery | null>(null);
  const [siteUrl, setSiteUrl] = useState(NONE);
  const [binding, setBinding] = useState<BingBinding | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<PanelMessage>(null);
  /**
   * Which profile the selector below was last filled from, and which load is
   * current. An answer from a previous profile must not overwrite the selection
   * an owner has already moved on to.
   */
  const [loadedProfileId, setLoadedProfileId] = useState<string | null>(null);
  const loadGeneration = useRef(0);

  const hasProfiles = props.profiles.length > 0;

  const load = useCallback(
    async (targetProfileId: string) => {
      if (!props.connected) return;
      const generation = loadGeneration.current + 1;
      loadGeneration.current = generation;
      setLoading(true);
      try {
        const sites = await apiRequest<BingDiscovery>('/integrations/bing/sites');
        const saved =
          targetProfileId === NONE
            ? null
            : await apiRequest<BingBinding | null>(
                `/profiles/${targetProfileId}/bing-binding`,
              ).catch(() => null);
        if (loadGeneration.current !== generation) return;
        setDiscovery(sites);
        setBinding(saved);
        setSiteUrl(saved?.siteUrl ?? NONE);
        setLoadedProfileId(targetProfileId);
      } catch {
        if (loadGeneration.current !== generation) return;
        setDiscovery(null);
        setMessage({ tone: 'error', text: t.discoveryFailed });
      } finally {
        if (loadGeneration.current === generation) setLoading(false);
      }
    },
    [props.connected, t.discoveryFailed],
  );

  useEffect(() => {
    void load(profileId);
  }, [load, profileId]);

  const selectProfile = (value: string) => {
    setMessage(null);
    setProfileId(value);
  };

  const save = async () => {
    if (profileId === NONE) return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = await apiRequest<BingBinding>(`/profiles/${profileId}/bing-binding`, {
        method: 'PUT',
        body: JSON.stringify({ siteUrl: siteUrl === NONE ? null : siteUrl }),
      });
      setBinding(saved);
      setSiteUrl(saved.siteUrl ?? NONE);
      setMessage({ tone: 'ok', text: saved.siteUrl === null ? t.cleared : t.saved });
    } catch (caught) {
      setMessage({ tone: 'error', text: saveFailureCopy(t, caught) });
    } finally {
      setSaving(false);
    }
  };

  if (!props.connected) {
    return (
      <Panel title={t.title} className="google-properties">
        <p className="muted">{t.notConnected}</p>
      </Panel>
    );
  }

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
      </Panel>
    );
  }

  const notice = discoveryNotice(t, discovery);
  const sites = discovery?.sites.items ?? [];
  const profileDomain = props.profiles.find((profile) => profile.id === profileId)?.domain;
  const mismatch = mismatchedHost(siteUrl, profileDomain);

  return (
    <Panel title={t.title} className="google-properties">
      <p className="muted">{t.readOnly}</p>
      <SelectField
        label={t.profileLabel}
        value={profileId}
        onChange={selectProfile}
        disabled={saving}
        options={props.profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
      />
      {message === null ? null : (
        <p
          className={message.tone === 'ok' ? 'integration-notice' : 'integration-row__error'}
          role="status"
        >
          {message.text}
        </p>
      )}
      {loading ? (
        <p className="muted" role="status">
          {t.loading}
        </p>
      ) : (
        <>
          <SelectField
            label={t.siteLabel}
            technical
            value={siteUrl}
            onChange={setSiteUrl}
            error={notice ?? undefined}
            options={[
              { value: NONE, label: t.notLinked },
              ...sites.map((site) => ({
                value: site.siteUrl,
                // The verification state travels with the option: picking an
                // unverified site is allowed, and being surprised by it is not.
                label: site.isVerified ? site.siteUrl : `${site.siteUrl} · ${t.unverifiedSuffix}`,
              })),
            ]}
          />
          <div className="button-row">
            <Button
              variant="primary"
              disabled={saving || loadedProfileId !== profileId}
              onClick={() => void save()}
            >
              {saving ? t.saving : t.save}
            </Button>
            <Button disabled={loading || saving} onClick={() => void load(profileId)}>
              {t.refresh}
            </Button>
          </div>
          {mismatch === null ? null : (
            <p className="muted" role="status">
              {fillCopy(t.hostMismatch, {
                site: mismatch,
                domain: hostOf(profileDomain ?? ''),
              })}
            </p>
          )}
          {binding === null && message === null ? <p className="muted">{t.noBinding}</p> : null}
          {binding !== null && !binding.verifiedAtSelection && binding.siteUrl !== null ? (
            <p className="muted" role="status">
              {fillCopy(t.unverifiedWarning, { site: binding.siteUrl })}
            </p>
          ) : null}
        </>
      )}
    </Panel>
  );
}
