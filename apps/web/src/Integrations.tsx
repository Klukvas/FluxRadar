// The Integrations screen: optional read-only data connections.
//
// Lives beside the workspace rather than inside it — a public-site audit runs
// without any of these, and the screen says so before it lists anything.

import { Fragment, useCallback, useEffect, useState } from 'react';

import { apiRequest, type IntegrationStatus, type SiteProfile } from './api';
import { Button, Panel, StatusChip, Window } from './components';
import { GoogleProperties } from './GoogleProperties';
import { copy, type Copy, type Language } from './i18n';
import { useDelayedFlag } from './use-delayed-flag';
import { useModalDialogBehavior } from './use-modal-dialog';

/**
 * Connections the API offers that this screen does not.
 *
 * Bing Webmaster Tools is implemented end to end — the OAuth start, the token
 * store, the property picker in `BingProperties` and the report panel all
 * stand — but it is not being offered to owners yet, and a row they cannot be
 * supported through is worse than no row. Hidden here, in the one place that
 * lists connections, rather than taken out of the API: deleting the server half
 * is how a feature comes back as a rewrite.
 */
const HIDDEN_PROVIDERS: readonly string[] = ['bing'];

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
  const [confirmProvider, setConfirmProvider] = useState<IntegrationStatus | null>(null);
  // Rows at the integration list's own shape instead of a terminal: shown only
  // once the fetch is known to be slow.
  const showSkeleton = useDelayedFlag(loading);
  const confirmDialog = useModalDialogBehavior(confirmProvider !== null, () =>
    setConfirmProvider(null),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const offered = await apiRequest<IntegrationStatus[]>('/integrations');
      setIntegrations(offered.filter((one) => !HIDDEN_PROVIDERS.includes(one.provider)));
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
      <div className="stack">
        <Window
          title={t.loadingTitle}
          onClose={props.onClose}
          closeLabel={props.language === 'uk' ? 'Закрити вікно' : 'Close window'}
        >
          {/* The loading window draws the same header split and policy panel as
              the loaded one, so when the data lands only the list rows swap —
              the list's position never moves. */}
          <div className="split">
            <div>
              <h2 className="section-heading">{t.heading}</h2>
              <p className="muted">{t.lead}</p>
            </div>
            <Button onClick={() => void load()}>{t.refresh}</Button>
          </div>
          {/* The labelled wrapper is present from the first render: the holdback
              hides the rows, never the fact that the list is loading. */}
          <div aria-label="Loading results">
            {showSkeleton ? <IntegrationListSkeleton /> : null}
          </div>
          <Panel title={t.policyTitle}>
            <p className="muted integration-policy">{t.policyBody}</p>
          </Panel>
        </Window>
      </div>
    );
  return (
    <div className="stack">
      <Window
        title={t.windowTitle}
        onClose={props.onClose}
        closeLabel={props.language === 'uk' ? 'Закрити вікно' : 'Close window'}
      >
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
                          disabled={busyProvider !== null}
                          aria-describedby={reason === null ? undefined : reasonId}
                          onClick={() => setConfirmProvider(integration)}
                        >
                          {busyProvider === integration.provider ? t.disconnecting : t.disconnect}
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          // One busy slot for the whole screen: while ANY
                          // connection request is in flight, starting another
                          // would overwrite the slot and leave the first
                          // operation's row claiming it finished.
                          disabled={!integration.canConnect || busyProvider !== null}
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
              </div>
            );
          })}
        </div>
        <Panel title={t.policyTitle}>
          <p className="muted integration-policy">{t.policyBody}</p>
        </Panel>
        {confirmProvider !== null ? (
          <div className="modal-backdrop" onMouseDown={() => setConfirmProvider(null)}>
            <section
              ref={confirmDialog}
              className="window window--dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="integration-disconnect-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="window__content stack">
                <h2 id="integration-disconnect-title" className="section-heading">
                  {t.disconnectTitle(confirmProvider.label)}
                </h2>
                <p>{t.disconnectBody(confirmProvider.label)}</p>
                <div className="button-row">
                  <Button
                    onClick={() => setConfirmProvider(null)}
                    disabled={busyProvider !== null}
                  >
                    {t.keepConnection}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busyProvider !== null}
                    onClick={() => {
                      const provider = confirmProvider;
                      setConfirmProvider(null);
                      void disconnect(provider);
                    }}
                  >
                    {t.disconnect}
                  </Button>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </Window>
    </div>
  );
}

/**
 * The integration list's own shape while the fetch is slow: the ONE group the
 * loaded screen draws — the Google row (name, why, services, chip, button)
 * plus its property-picker detail — at those elements' final sizes, so when
 * the data lands only the text swaps and nothing below the list moves.
 *
 * One group, not several: `bing` is hidden (`HIDDEN_PROVIDERS`) and Google is
 * the only connection the screen offers, so a multi-row placeholder would
 * collapse when the list lands. If the API ever offers a second visible
 * provider, extend this to draw one group per offered provider.
 */
function IntegrationListSkeleton() {
  return (
    <div className="integration-list" aria-hidden="true">
      <div className="integration-group">
        <div className="integration-row">
          <div className="integration-row__copy">
            <div className="skeleton-block integration-skeleton__name" />
            <div className="skeleton-block integration-skeleton__why" />
            <div className="skeleton-block integration-skeleton__services" />
          </div>
          <div className="integration-row__action">
            <div className="skeleton-block integration-skeleton__chip" />
            <div className="skeleton-block integration-skeleton__button" />
          </div>
        </div>
        <div className="integration-group__detail">
          <div className="integration-skeleton__panel">
            <div className="skeleton-block integration-skeleton__title" />
            <div className="skeleton-block integration-skeleton__readonly" />
            {Array.from({ length: 3 }, (_, index) => (
              <Fragment key={index}>
                <div className="integration-skeleton__field">
                  <div className="skeleton-block integration-skeleton__field-label" />
                  <div className="skeleton-block integration-skeleton__field-box" />
                </div>
                {index === 0 ? <div className="skeleton-block integration-skeleton__note" /> : null}
              </Fragment>
            ))}
            <div className="skeleton-block integration-skeleton__detail-button" />
          </div>
        </div>
      </div>
    </div>
  );
}
