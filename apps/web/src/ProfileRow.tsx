// One saved site in the workspace list: its name and address, the button that
// checks it, and a "⋯" menu folding Reports, Edit and Delete. Delete opens its
// confirmation under the row rather than in a dialog.

import { useRef } from 'react';

import { ActionMenu } from './ActionMenu';
import type { SiteProfile } from './api';
import { Button } from './components';
import { desktopCopy } from './desktop-copy';
import { copy, type Language } from './i18n';
import { ProfileDeletion } from './ProfileDeletion';

export function ProfileRow(props: {
  profile: SiteProfile;
  language: Language;
  /**
   * Whether the form below is reading a site, and so this row's actions would
   * replace or discard a profile being described right now.
   *
   * Reports stays available: reading another site's reports is somewhere else
   * to be, not something done to the form.
   */
  locked: boolean;
  deleting: boolean;
  onOpenDelete: () => void;
  onCancelDelete: () => void;
  onNewScan: () => void;
  onReports: () => void;
  onEdit: () => void;
  onDeleted: (profile: SiteProfile) => Promise<void>;
  onError: (value: string) => void;
}) {
  const t = copy[props.language].workspace;
  const { profile } = props;
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="profile-row">
      <div className="profile-row__site">
        <strong>{profile.name}</strong>
        <span className="profile-row__domain">{profile.domain}</span>
      </div>
      <div className="profile-row__actions">
        <Button onClick={props.onNewScan} variant="primary" disabled={props.locked}>
          {t.newScan}
        </Button>
        <ActionMenu
          label={desktopCopy[props.language].rowActions(profile.name)}
          buttonRef={menuButtonRef}
          items={[
            { id: 'reports', label: t.inspect, onSelect: props.onReports },
            {
              id: 'edit',
              label: t.editProfile,
              onSelect: props.onEdit,
              disabled: props.locked,
            },
            {
              id: 'delete',
              label: t.deleteProfileAction,
              onSelect: props.onOpenDelete,
              danger: true,
              disabled: props.locked,
            },
          ]}
        />
      </div>
      {props.deleting ? (
        <div className="profile-row__deletion">
          <ProfileDeletion
            profile={profile}
            language={props.language}
            onDeleted={props.onDeleted}
            onError={props.onError}
            onCancel={() => {
              props.onCancelDelete();
              menuButtonRef.current?.focus();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Opens the add-a-site form. With a site already saved it is about adding
 * another one, and stays quieter than that site's own check button; with none
 * it is the one thing to do, so it carries the primary weight.
 */
export function AddSiteToggle(props: {
  readonly language: Language;
  readonly siteCount: number;
  readonly onOpen: () => void;
}) {
  const d = desktopCopy[props.language];
  const hasSites = props.siteCount > 0;
  return (
    <Button onClick={props.onOpen} variant={hasSites ? 'default' : 'primary'}>
      {hasSites ? d.addAnotherSiteToggle : d.addSiteToggle}
    </Button>
  );
}
