// The Search Console domains of the connected Google account, each with the
// FluxRadar profile it feeds and the action that moves it forward. See
// `google-domains.ts` for how a row is decided.

import type { GoogleBinding, SiteProfile } from './api';
import { Button } from './components';
import { originProblemCopy, type GoogleCopy } from './google-copy';
import { copy, fillCopy, type Language } from './i18n';
import { googleDomainRows, type GoogleDomainRow } from './google-domains';

/** What a domain row can do, and which domain is already busy. */
export interface GoogleDomainActions {
  /** The domain being linked or turned into a profile; its button says it is working. */
  readonly busySiteUrl: string | null;
  /** True while the panel loads, saves, links or creates; every row action waits. */
  readonly isLocked: boolean;
  readonly onConfigure: (profileId: string) => void;
  readonly onLink: (profile: SiteProfile, siteUrl: string) => void;
  readonly onCreate: (siteUrl: string) => void;
}

export function GoogleDomains(props: {
  sites: readonly { readonly siteUrl: string }[];
  profiles: readonly SiteProfile[];
  bindings: readonly GoogleBinding[];
  language: Language;
  actions: GoogleDomainActions;
}) {
  const t = copy[props.language].integrations.google;
  const rows = googleDomainRows(props.sites, props.profiles, props.bindings);
  if (rows.length === 0) return null;
  return (
    <section className="google-properties__domains" aria-label={t.domainsHeading}>
      <h3 className="section-heading">{t.domainsHeading}</h3>
      <p className="muted">{t.domainsBody}</p>
      <div className="google-properties__list">
        {rows.map((row) => (
          <div className="google-properties__row" key={row.siteUrl}>
            <span>
              <span className="technical">{row.siteUrl}</span>
              <small className="google-properties__status">{statusText(row, t)}</small>
            </span>
            <span className="google-properties__actions">
              <DomainAction row={row} t={t} actions={props.actions} />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function statusText(row: GoogleDomainRow, t: GoogleCopy): string {
  switch (row.kind) {
    case 'linked':
      return fillCopy(t.domainLinked, {
        profiles: row.profiles.map((profile) => profile.name).join(', '),
      });
    case 'matching':
      return fillCopy(t.domainMatching, { profile: row.profile.name });
    case 'occupied':
      return fillCopy(t.domainOccupied, { profile: row.profile.name });
    case 'unsupported':
      return originProblemCopy(t, row.reason);
    case 'unlinked':
      return t.domainUnlinked;
  }
}

function DomainAction(props: {
  row: GoogleDomainRow;
  t: GoogleCopy;
  actions: GoogleDomainActions;
}) {
  const { row, t, actions } = props;
  const isThisBusy = actions.busySiteUrl === row.siteUrl;
  switch (row.kind) {
    case 'linked':
      // A domain read by several profiles opens each of them, named, rather than
      // only the first.
      return row.profiles.map((profile) => {
        const label =
          row.profiles.length === 1
            ? t.domainConfigure
            : fillCopy(t.domainConfigureProfile, { profile: profile.name });
        return (
          <Button
            key={profile.id}
            disabled={actions.isLocked}
            onClick={() => actions.onConfigure(profile.id)}
            aria-label={`${label} · ${row.siteUrl}`}
          >
            {label}
          </Button>
        );
      });
    case 'occupied':
      return (
        <Button
          disabled={actions.isLocked}
          onClick={() => actions.onConfigure(row.profile.id)}
          aria-label={`${t.domainConfigure} · ${row.siteUrl}`}
        >
          {t.domainConfigure}
        </Button>
      );
    case 'matching':
      return (
        <Button
          variant="primary"
          disabled={actions.isLocked}
          onClick={() => actions.onLink(row.profile, row.siteUrl)}
          aria-label={`${t.domainLink} · ${row.siteUrl}`}
        >
          {isThisBusy ? t.domainLinking : t.domainLink}
        </Button>
      );
    case 'unlinked':
      return (
        <Button
          disabled={actions.isLocked}
          onClick={() => actions.onCreate(row.siteUrl)}
          aria-label={`${t.create} · ${row.siteUrl}`}
        >
          {isThisBusy ? t.creating : t.create}
        </Button>
      );
    case 'unsupported':
      return null;
  }
}
