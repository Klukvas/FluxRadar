// The Integrations screen: optional read-only data connections.
//
// Lives beside the workspace rather than inside it — a public-site audit runs
// without any of these, and the screen says so before it lists anything.

import { useCallback, useEffect, useState } from 'react';

import { apiRequest, type IntegrationStatus, type SiteProfile } from './api';
import { BingProperties } from './BingProperties';
import { Button, LoadingState, Panel, StatusChip, Window } from './components';
import { GoogleProperties } from './GoogleProperties';
import { copy, type Copy, type Language } from './i18n';

/**
 * Why a customer would connect this provider, in their own words.
 *
 * Keyed by provider so a connection the API adds later renders without an
 * explanation rather than with someone else's.
 */
function whyConnect(t: Copy['integrations'], provider: string): string | null {
  const reasons: Readonly<Record<string, string>> = t.whyConnect;
  return reasons[provider] ?? null;
}

export function IntegrationsScreen(props: {
  profiles: readonly SiteProfile[];
  language: Language;
  onClose: () => void;
  /** Sends the owner to the workspace screen that holds the add-profile form. */
  onAddProfile: () => void;
  onProfilesChanged: () => Promise<void>;
  onError: (value: string) => void;
}) {
  const t = copy[props.language].integrations;
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setIntegrations(await apiRequest<IntegrationStatus[]>('/integrations'));
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Integrations unavailable');
    } finally {
      setLoading(false);
    }
  }, [props.onError]);

  useEffect(() => {
    void load();
    const result = new URLSearchParams(window.location.search).get('result');
    const message = new URLSearchParams(window.location.search).get('message');
    if (result === 'connected') setNotice(t.connectedNotice);
    if (result === 'error') setNotice(message ?? t.errorNotice);
  }, [load, t.connectedNotice, t.errorNotice]);

  const connect = async (provider: IntegrationStatus) => {
    setBusyProvider(provider.provider);
    try {
      const result = await apiRequest<{ authorizationUrl: string }>(
        `/integrations/${provider.provider}/start`,
        { method: 'POST', body: '{}' },
      );
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Connection could not be started');
    } finally {
      setBusyProvider(null);
    }
  };

  const disconnect = async (provider: IntegrationStatus) => {
    setBusyProvider(provider.provider);
    try {
      await apiRequest<null>(`/integrations/${provider.provider}`, { method: 'DELETE' });
      await load();
    } catch (caught) {
      props.onError(
        caught instanceof Error ? caught.message : 'Integration could not be disconnected',
      );
    } finally {
      setBusyProvider(null);
    }
  };

  if (loading)
    return (
      <Window title={t.loadingTitle} onClose={props.onClose}>
        <LoadingState />
      </Window>
    );
  return (
    <div className="stack">
      <Window title={t.windowTitle} onClose={props.onClose}>
        <div className="split">
          <div>
            <h2 className="section-heading">{t.heading}</h2>
            <p className="muted">{t.lead}</p>
          </div>
          <Button onClick={() => void load()}>{t.refresh}</Button>
        </div>
        {notice ? (
          <div className="integration-notice" role="status">
            {notice}
          </div>
        ) : null}
        <div className="integration-list">
          {integrations.map((integration) => {
            const reason = whyConnect(t, integration.provider);
            const reasonId = `integration-why-${integration.provider}`;
            return (
              <div className="integration-group" key={integration.provider}>
                <div className="integration-row">
                  <div className="integration-row__copy">
                    <h3 className="integration-row__name">{integration.label}</h3>
                    {reason === null ? null : (
                      <p className="integration-row__why" id={reasonId}>
                        {reason}
                      </p>
                    )}
                    <p className="integration-row__services">{integration.services.join(' · ')}</p>
                    {integration.lastError ? (
                      <small className="integration-row__error">{integration.lastError}</small>
                    ) : null}
                  </div>
                  {/* Status and control are one pair on one line. Read apart —
                      the chip beside the name, the button in a column centred
                      on the whole description — they never line up once the
                      copy is longer than a single line. */}
                  <div className="integration-row__action">
                    <StatusChip
                      status={integration.status}
                      label={
                        integration.status === 'available'
                          ? t.readyToConnect
                          : integration.status.replace(/_/g, ' ')
                      }
                    />
                    {integration.kind === 'user' ? (
                      integration.status === 'connected' ? (
                        <Button
                          variant="danger"
                          disabled={busyProvider === integration.provider}
                          aria-describedby={reason === null ? undefined : reasonId}
                          onClick={() => void disconnect(integration)}
                        >
                          {busyProvider === integration.provider ? t.disconnecting : t.disconnect}
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          disabled={
                            !integration.canConnect || busyProvider === integration.provider
                          }
                          aria-describedby={reason === null ? undefined : reasonId}
                          onClick={() => void connect(integration)}
                        >
                          {busyProvider === integration.provider ? t.connecting : t.connect}
                        </Button>
                      )
                    ) : (
                      <span className="technical integration-row__server">
                        {integration.status === 'connected'
                          ? t.serverConfigured
                          : integration.status === 'limited'
                            ? t.serverLimited
                            : t.serverMissing}
                      </span>
                    )}
                  </div>
                </div>
                {/* Each picker is nested in the row of the connection it
                    configures. Floating after the list, they read as settings
                    for every integration at once. */}
                {integration.provider === 'google' ? (
                  <div className="integration-group__detail">
                    <GoogleProperties
                      profiles={props.profiles}
                      connected={integration.status === 'connected'}
                      language={props.language}
                      onAddProfile={props.onAddProfile}
                      onProfilesChanged={props.onProfilesChanged}
                    />
                  </div>
                ) : null}
                {integration.provider === 'bing' ? (
                  <div className="integration-group__detail">
                    <BingProperties
                      profiles={props.profiles}
                      connected={integration.status === 'connected'}
                      language={props.language}
                      onAddProfile={props.onAddProfile}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <Panel title={t.policyTitle}>
          <p className="muted integration-policy">{t.policyBody}</p>
        </Panel>
      </Window>
    </div>
  );
}
