// Links a FluxRadar website to the Google properties the connected account can
// read. Nothing here is speculative: the lists come from Google's own read-only
// discovery endpoints, and an empty or refused list is explained in words
// instead of being shown as a failed request.

import { useCallback, useEffect, useState } from 'react';

import { apiRequest, type GoogleBinding, type GoogleDiscovery, type SiteProfile } from './api';
import { Button, Panel, SelectField } from './components';

const NONE = '';

interface Props {
  readonly profiles: readonly SiteProfile[];
  readonly connected: boolean;
  readonly onError: (value: string) => void;
}

function sectionNotice(state: string, detail: string): string | null {
  return state === 'connected' ? null : detail;
}

export function GoogleProperties(props: Props) {
  const [profileId, setProfileId] = useState(props.profiles[0]?.id ?? NONE);
  const [discovery, setDiscovery] = useState<GoogleDiscovery | null>(null);
  const [binding, setBinding] = useState<GoogleBinding | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [searchConsoleSiteUrl, setSearchConsoleSiteUrl] = useState(NONE);
  const [ga4PropertyId, setGa4PropertyId] = useState(NONE);

  useEffect(() => {
    if (props.profiles.length > 0 && !props.profiles.some((profile) => profile.id === profileId)) {
      setProfileId(props.profiles[0]?.id ?? NONE);
    }
  }, [props.profiles, profileId]);

  const load = useCallback(async () => {
    if (!props.connected || profileId === NONE) return;
    setLoading(true);
    setSaved(null);
    try {
      const [properties, current] = await Promise.all([
        apiRequest<GoogleDiscovery>('/integrations/google/properties'),
        apiRequest<GoogleBinding | null>(`/profiles/${profileId}/google-binding`),
      ]);
      setDiscovery(properties);
      setBinding(current);
      setSearchConsoleSiteUrl(current?.searchConsoleSiteUrl ?? NONE);
      setGa4PropertyId(current?.ga4PropertyId ?? NONE);
    } catch (caught) {
      props.onError(
        caught instanceof Error ? caught.message : 'Google properties could not be loaded',
      );
    } finally {
      setLoading(false);
    }
  }, [profileId, props.connected, props.onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setSaved(null);
    try {
      const updated = await apiRequest<GoogleBinding>(`/profiles/${profileId}/google-binding`, {
        method: 'PUT',
        body: JSON.stringify({
          searchConsoleSiteUrl: searchConsoleSiteUrl === NONE ? null : searchConsoleSiteUrl,
          ga4PropertyId: ga4PropertyId === NONE ? null : ga4PropertyId,
        }),
      });
      setBinding(updated);
      setSaved(
        updated.searchConsoleSiteUrl === null && updated.ga4PropertyId === null
          ? 'Google properties unlinked. Reports will not include Google data.'
          : 'Saved. The next scan of this website will include this Google data.',
      );
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Selection could not be saved');
    } finally {
      setSaving(false);
    }
  };

  if (!props.connected) {
    return (
      <Panel title="Google properties">
        <p className="muted">
          Connect Google above to choose which Search Console property and Analytics property each
          website should report on.
        </p>
      </Panel>
    );
  }
  if (props.profiles.length === 0) {
    return (
      <Panel title="Google properties">
        <p className="muted">
          Add a website first. Google data is linked per website, so a report always names the
          property it came from.
        </p>
      </Panel>
    );
  }

  const searchConsoleNotice =
    discovery === null
      ? null
      : sectionNotice(discovery.searchConsole.state, discovery.searchConsole.detail);
  const analyticsNotice =
    discovery === null
      ? null
      : sectionNotice(discovery.analytics.state, discovery.analytics.detail);

  return (
    <Panel title="Google properties">
      <p className="muted">
        FluxRadar reads these properties only. It never writes to Search Console or Analytics.
      </p>
      <SelectField
        label="Website"
        value={profileId}
        onChange={setProfileId}
        options={props.profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
      />
      {loading ? (
        <p className="muted" role="status">
          Loading Google properties…
        </p>
      ) : (
        <>
          {searchConsoleNotice ? (
            <p className="integration-row__error" role="status">
              Search Console: {searchConsoleNotice}
            </p>
          ) : null}
          <SelectField
            label="Search Console property"
            value={searchConsoleSiteUrl}
            onChange={setSearchConsoleSiteUrl}
            options={[
              { value: NONE, label: 'Not linked' },
              ...(discovery?.searchConsole.items ?? []).map((site) => ({
                value: site.siteUrl,
                label: site.siteUrl,
              })),
            ]}
          />
          {analyticsNotice ? (
            <p className="integration-row__error" role="status">
              Analytics: {analyticsNotice}
            </p>
          ) : null}
          <SelectField
            label="Analytics property"
            value={ga4PropertyId}
            onChange={setGa4PropertyId}
            options={[
              { value: NONE, label: 'Not linked' },
              ...(discovery?.analytics.items ?? []).map((property) => ({
                value: property.propertyId,
                label: `${property.displayName} · ${property.accountName}`,
              })),
            ]}
          />
          <div className="button-row">
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save selection'}
            </Button>
            <Button disabled={loading} onClick={() => void load()}>
              Refresh list
            </Button>
          </div>
          {saved ? (
            <p className="integration-notice" role="status">
              {saved}
            </p>
          ) : null}
          {binding === null && saved === null ? (
            <p className="muted">
              No property is linked to this website yet, so reports will show Google data as not
              configured.
            </p>
          ) : null}
        </>
      )}
    </Panel>
  );
}
