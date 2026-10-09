// The one line on the profiles screen about Google data, and when it is worth
// saying anything at all.
//
// The sites list is where an owner looks after they add a site, and the Google
// connection — Search Console and Analytics 4, read-only — is configured two
// tabs away on the Integrations screen. Somebody who never opens that tab never
// learns their reports are running without their own traffic and indexing data.
//
// So this reminds them, and only about the step they are actually on:
//
//   - Google not connected yet → connect it.
//   - Connected but broken → reconnect it.
//   - Connected, and a saved site has no property chosen → name those sites.
//   - Everything chosen → say nothing. A panel that is always there is
//     furniture, and furniture is not read.
//
// It is also deliberately quiet about failure: the two reads behind it are
// untrusted and optional, so an unreadable list means no reminder rather than
// an error on a screen the owner came to for something else.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiRequest, type SiteProfile } from './api';
import { Button, Panel } from './components';
import { copy, fillCopy, type Language } from './i18n';

/** What the reminder has to say, or that it has nothing to say. */
type ReminderState =
  | { readonly kind: 'silent' }
  | { readonly kind: 'connect' }
  | { readonly kind: 'reconnect' }
  /** Connected, but these saved sites read no property yet. */
  | { readonly kind: 'chooseProperty'; readonly profileIds: readonly string[] };

const SILENT: ReminderState = { kind: 'silent' };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The status of the Google connection in the list the API offers, or null.
 *
 * Null covers every shape this screen cannot read a status out of — a failed
 * request, an envelope holding something other than a list, a list with no
 * Google row — because all of them mean the same thing here: say nothing.
 */
function googleStatus(offered: unknown): string | null {
  if (!Array.isArray(offered)) return null;
  const google = offered.find((one) => isRecord(one) && one.provider === 'google');
  return isRecord(google) && typeof google.status === 'string' ? google.status : null;
}

/** The profile ids that read at least one Google property, from an untrusted list. */
function boundProfileIds(bindings: unknown): ReadonlySet<string> | null {
  if (!Array.isArray(bindings)) return null;
  const bound = bindings.filter(
    (one) =>
      isRecord(one) &&
      typeof one.siteProfileId === 'string' &&
      (typeof one.searchConsoleSiteUrl === 'string' || typeof one.ga4PropertyId === 'string'),
  );
  return new Set(bound.map((one) => String((one as Record<string, unknown>).siteProfileId)));
}

export function GoogleConnectionReminder(props: {
  readonly profiles: readonly SiteProfile[];
  readonly language: Language;
  /** Opens the screen that holds the connection and its property pickers. */
  readonly onOpenIntegrations: () => void;
}) {
  const t = copy[props.language].workspace;
  const [state, setState] = useState<ReminderState>(SILENT);
  // The effect keys off the ids rather than the array: the parent hands down a
  // fresh array on every render, and depending on that identity is how a
  // reminder turns into a request loop.
  const profileIds = props.profiles.map((profile) => profile.id).join(',');

  const read = useCallback(async (ids: readonly string[]): Promise<ReminderState> => {
    try {
      const status = googleStatus(await apiRequest<unknown>('/integrations'));
      if (status === null || status === 'not_configured') return SILENT;
      if (status === 'needs_reconnect') return { kind: 'reconnect' };
      if (status !== 'connected') return { kind: 'connect' };
      const bound = boundProfileIds(await apiRequest<unknown>('/integrations/google/bindings'));
      if (bound === null) return SILENT;
      const waiting = ids.filter((id) => !bound.has(id));
      return waiting.length === 0 ? SILENT : { kind: 'chooseProperty', profileIds: waiting };
    } catch {
      // Optional data about optional data: nothing here is worth an error
      // banner on the screen the owner is actually using.
      return SILENT;
    }
  }, []);

  useEffect(() => {
    let current = true;
    const ids = profileIds === '' ? [] : profileIds.split(',');
    void read(ids).then((next) => {
      if (current) setState(next);
    });
    return () => {
      current = false;
    };
  }, [profileIds, read]);

  const waitingNames = useMemo(() => {
    if (state.kind !== 'chooseProperty') return '';
    const names = state.profileIds.flatMap((id) => {
      const profile = props.profiles.find((candidate) => candidate.id === id);
      return profile === undefined ? [] : [profile.name];
    });
    return new Intl.ListFormat(props.language, { style: 'long', type: 'conjunction' }).format(
      names,
    );
  }, [state, props.profiles, props.language]);

  if (state.kind === 'silent') return null;
  // A site deleted between the read and this render can empty the list; with no
  // site left to name there is nothing to remind anyone about.
  if (state.kind === 'chooseProperty' && waitingNames === '') return null;
  const body =
    state.kind === 'connect'
      ? t.googleReminderConnect
      : state.kind === 'reconnect'
        ? t.googleReminderReconnect
        : fillCopy(t.googleReminderChooseProperty, { sites: waitingNames });
  return (
    <Panel title={t.googleReminderTitle} className="google-reminder">
      <p className="muted">{body}</p>
      <div className="button-row">
        <Button onClick={props.onOpenIntegrations}>
          {state.kind === 'chooseProperty'
            ? t.googleReminderChoose
            : state.kind === 'reconnect'
              ? t.googleReminderReconnectAction
              : t.googleReminderConnectAction}
        </Button>
      </div>
    </Panel>
  );
}
