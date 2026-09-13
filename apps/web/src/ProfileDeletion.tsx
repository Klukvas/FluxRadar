// Deleting a site profile together with the audit and billing history of that site.
//
// There is no undo: every scan, report, export and purchase record of the site
// goes with it. Typing the site's address is therefore the confirmation. The
// server refuses while anything is still in motion — a scan in progress, a
// checkout that can still be paid, a refund still being processed — and
// answers with a closed code, so the sentence the owner reads is chosen here
// rather than taken from server prose.

import { useId, useState } from 'react';

import { ApiRequestError, apiRequest, type SiteProfile } from './api';
import { Button, Field } from './components';
import { copy, fillCopy, type Language } from './i18n';

type WorkspaceCopy = (typeof copy)[Language]['workspace'];

/** The address an owner recognises: `mysite.com`, not `https://mysite.com`. */
function hostnameOf(domain: string): string {
  try {
    return new URL(domain).hostname;
  } catch {
    // A stored origin is validated server-side; show it verbatim if it is not a URL.
    return domain;
  }
}

export function profileDeletionErrorMessage(t: WorkspaceCopy, caught: unknown): string {
  const code = caught instanceof ApiRequestError ? caught.code : null;
  if (code === 'PROFILE_HAS_ACTIVE_SCAN') return t.deleteProfileActiveScan;
  if (code === 'PROFILE_HAS_OPEN_CHECKOUT') return t.deleteProfileOpenCheckout;
  if (code === 'PROFILE_HAS_OPEN_REFUND') return t.deleteProfileOpenRefund;
  return caught instanceof Error && caught.message !== '' ? caught.message : t.deleteProfileFailed;
}

export function ProfileDeletion(props: {
  profile: SiteProfile;
  language: Language;
  onDeleted: (profile: SiteProfile) => Promise<void>;
  onError: (message: string) => void;
}) {
  const t = copy[props.language].workspace;
  const headingId = useId();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const hostname = hostnameOf(props.profile.domain);
  const isConfirmed = confirmation.trim().toLowerCase() === hostname.toLowerCase();

  const remove = async () => {
    setBusy(true);
    try {
      await apiRequest<null>(`/profiles/${encodeURIComponent(props.profile.id)}`, {
        method: 'DELETE',
      });
      await props.onDeleted(props.profile);
    } catch (caught) {
      props.onError(profileDeletionErrorMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="profile-deletion" aria-labelledby={headingId}>
      <strong id={headingId}>{t.deleteProfileHeading}</strong>
      <p>{t.deleteProfileHelp}</p>
      <Field
        label={fillCopy(t.deleteProfileConfirmLabel, { domain: hostname })}
        name="profile-delete-confirmation"
        autoComplete="off"
        technical
        value={confirmation}
        onChange={setConfirmation}
        placeholder={hostname}
      />
      <Button variant="danger" disabled={busy || !isConfirmed} onClick={() => void remove()}>
        {busy ? t.deletingProfile : t.deleteProfileButton}
      </Button>
    </section>
  );
}
