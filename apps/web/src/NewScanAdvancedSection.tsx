import { useEffect, useState } from 'react';

import { apiRequest, type GoogleBinding, type IntegrationStatus } from './api';
import { Button, FieldRow, Panel, StatusChip } from './components';
import { copy, type Language } from './i18n';
import { LaunchSummary } from './LaunchSummary';
import { newScanCopy } from './new-scan-copy';
import type { NewScanForm } from './new-scan-form';
import { AdvancedCrawlRules, ExpertSettings } from './NewScanExpertSettings';

/**
 * "For advanced users": everything on the new-scan screen a first-time buyer
 * does not need to read, folded under one heading.
 *
 * Nothing in here was removed from the screen, only moved: the rows that were
 * the "What will run" table, the saved-settings status that sat under the site
 * picker, the crawl settings, the extra crawl rules, the optional Google
 * context and the way to save settings without buying anything. Folding hides
 * nothing from the request — a closed `<details>` keeps its controls in the
 * form — and the section opens by itself whenever a block inside it does
 * (`expertOpen`, `advancedOpen`), so a saved setting that differs from the safe
 * default is never out of sight while the owner pays for it.
 */
export function AdvancedSection(props: { form: NewScanForm; language: Language }) {
  const c = newScanCopy[props.language];
  const { advancedOpen, expertOpen, toggleAdvanced, toggleExpert } = props.form;
  const [ownChoice, setOwnChoice] = useState(false);
  const open = ownChoice || expertOpen || advancedOpen;
  return (
    <details
      className="scan-advanced scan-advanced-section"
      open={open}
      onToggle={(event) => {
        const nowOpen = event.currentTarget.open;
        if (nowOpen === open) return;
        setOwnChoice(nowOpen);
        // Closing the section closes what is inside it; otherwise an open block
        // would hold the section open against the owner's click.
        if (!nowOpen) {
          toggleExpert(false);
          toggleAdvanced(false);
        }
      }}
    >
      <summary className="scan-advanced__summary scan-expert__summary">{c.expertTitle}</summary>
      <div className="scan-advanced__fields">
        <TechnicalRows form={props.form} language={props.language} />
        <ConfigurationStatus form={props.form} language={props.language} />
        <FreeScope form={props.form} language={props.language} />
        <ExpertSettings form={props.form} language={props.language} />
        {props.form.paidScopeControls ? (
          <AdvancedCrawlRules form={props.form} language={props.language} />
        ) : null}
        {props.form.usingSavedProfile &&
        (props.form.plan === 'WebsiteAudit' || props.form.plan === 'Complete') ? (
          <GoogleLaunchContext profileId={props.form.target} language={props.language} />
        ) : null}
        <SaveSettings form={props.form} language={props.language} />
      </div>
    </details>
  );
}

/** What the crawler will do, in the words of the settings below it. */
function TechnicalRows(props: { form: NewScanForm; language: Language }) {
  const c = newScanCopy[props.language];
  const { egressLocation, launchConfig, plan, scope } = props.form;
  return (
    <div>
      <h3 className="scan-advanced__heading" id="scan-technical-title">
        {c.technicalTitle}
      </h3>
      <LaunchSummary
        language={props.language}
        plan={plan}
        labelledBy="scan-technical-title"
        scope={scope}
        egressLocation={egressLocation}
        egressDirect={launchConfig.status === 'ready' && launchConfig.egress.mode === 'direct'}
      />
    </div>
  );
}

/** Whether these settings are the ones saved for the site, and what launching does to them. */
function ConfigurationStatus(props: { form: NewScanForm; language: Language }) {
  const t = copy[props.language];
  const { carriedOver, configurationState, configurationStatusLabel, robotsOverrideStale } =
    props.form;
  return (
    <section
      className={`configuration-status configuration-status--${configurationState}`}
      aria-live="polite"
    >
      <div className="configuration-status__header">
        <strong>{t.newScan.configurationTitle}</strong>
        <StatusChip
          status={
            configurationState === 'dirty'
              ? 'warning'
              : configurationState === 'saved'
                ? 'Completed'
                : 'info'
          }
          label={configurationStatusLabel}
        />
      </div>
      {configurationState === 'dirty' ? (
        <p>{t.newScan.configurationUnsavedBody}</p>
      ) : configurationState === 'new' ? (
        <p>{t.newScan.configurationNewBody}</p>
      ) : null}
      {/* The one difference from the saved version that the owner did not
          make: a saved permission to ignore robots.txt is deliberately never
          reused, so say that rather than leave them hunting for what they
          changed. Said whether or not they have also made a real edit — the
          generic sentence above covers the edit, this one covers the part
          that is not theirs. */}
      {robotsOverrideStale ? <p>{t.newScan.configurationRobotsNotReused}</p> : null}
      {carriedOver ? <p>{t.newScan.prefillNote}</p> : null}
    </section>
  );
}

/**
 * What Free actually is, in place of the controls it does not have. The rows
 * are the enforced settings, not suggestions: the crawler reads the homepage
 * and obeys robots.txt on this plan whatever the request says.
 */
function FreeScope(props: { form: NewScanForm; language: Language }) {
  const t = copy[props.language];
  if (props.form.paidScopeControls) return null;
  return (
    <Panel title={t.newScan.freeScopeTitle}>
      <p className="muted panel-help">{t.newScan.freeScopeNote}</p>
      <FieldRow label={t.newScan.freeScopePages} value={t.newScan.freeScopePagesValue} />
      <FieldRow label={t.newScan.freeScopeRobots} value={t.newScan.freeScopeRobotsValue} />
      <p className="muted panel-help">{t.newScan.freeScopeLocked}</p>
    </Panel>
  );
}

/** The way to keep these settings for the site without buying anything. */
function SaveSettings(props: { form: NewScanForm; language: Language }) {
  const c = newScanCopy[props.language];
  const { canSave, saveConfiguration, savingConfiguration } = props.form;
  return (
    <div className="button-row">
      <Button type="button" disabled={!canSave} onClick={() => void saveConfiguration()}>
        {savingConfiguration ? c.savingSettings : c.saveSettings}
      </Button>
    </div>
  );
}

/** A binding is optional, but the audit plans can use its real Google context. */
function GoogleLaunchContext(props: { profileId: string; language: Language }) {
  const [state, setState] = useState<'loading' | 'missing' | 'ready' | 'unavailable'>('loading');
  useEffect(() => {
    let active = true;
    setState('loading');
    void Promise.all([
      apiRequest<GoogleBinding | null>(
        `/profiles/${encodeURIComponent(props.profileId)}/google-binding`,
      ),
      apiRequest<readonly IntegrationStatus[]>('/integrations'),
    ])
      .then(([binding, integrations]) => {
        if (!active) return;
        const google = integrations.find((integration) => integration.provider === 'google');
        setState(
          google?.status === 'connected' &&
            binding !== null &&
            (binding.searchConsoleSiteUrl !== null || binding.ga4PropertyId !== null)
            ? 'ready'
            : 'missing',
        );
      })
      .catch(() => {
        if (active) setState('unavailable');
      });
    return () => {
      active = false;
    };
  }, [props.profileId]);
  const c = newScanCopy[props.language].googleContext;
  return (
    <Panel title={c.title}>
      <p className="muted panel-help">{c[state]}</p>
      {state === 'missing' || state === 'unavailable' ? (
        <a className="button" href="/integrations">
          {c.open}
        </a>
      ) : null}
    </Panel>
  );
}
