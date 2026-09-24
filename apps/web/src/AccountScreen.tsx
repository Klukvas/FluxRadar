// The signed-in owner's account: email confirmation, password, purchases, the
// emails FluxRadar sends, and deleting the account.
//
// None of this had a screen. `emailVerified` arrived with every session and was
// never shown, so an owner who missed the confirmation email was never told;
// the password could only be changed through "forgot password"; purchases were
// visible only as the scans they started; and `DELETE /account` — transactional,
// tested, the owner's right — had no button anywhere.

import { useEffect, useState, type FormEvent } from 'react';

import { apiRequest, ApiRequestError, type Account, type Purchase } from './api';
import { accountCopy, PASSWORD_MIN_LENGTH } from './account-copy';
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  FieldRow,
  Panel,
  SkeletonRows,
  StatusChip,
  Window,
} from './components';
import { formatDate } from './format-date';
import type { Language } from './i18n';
import { displayDomain } from './scan-status';
import './styles/account.css';
import { planName } from './plan-modules';

function formatAmount(amount: number, currency: string, language: Language): string {
  try {
    return new Intl.NumberFormat(language === 'uk' ? 'uk-UA' : 'en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    // An unknown currency code must not take the whole purchase list down.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Asks the API to send the confirmation link again. Shared with the workspace banner. */
export async function resendVerification(email: string): Promise<void> {
  await apiRequest<{ status: string }>('/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function AccountScreen(props: {
  account: Account;
  language: Language;
  onOpenScan: (scanId: string) => void;
  onDeleted: () => void;
  onNotice: (value: string) => void;
  onError: (value: string) => void;
}) {
  const t = accountCopy[props.language];
  return (
    <Window title={t.windowTitle}>
      <div className="account">
        <div>
          <h2 className="section-heading">{t.heading}</h2>
          <p className="muted">{t.lead}</p>
        </div>
        <EmailPanel {...props} />
        <PasswordPanel
          language={props.language}
          onNotice={props.onNotice}
          onError={props.onError}
        />
        <PurchasesPanel language={props.language} onOpenScan={props.onOpenScan} />
        <Panel title={t.emails.heading}>
          <p>{t.emails.lead(props.account.email)}</p>
          <ul className="account-list">
            {t.emails.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Panel>
        <DeletionPanel {...props} />
      </div>
    </Window>
  );
}

function EmailPanel(props: {
  account: Account;
  language: Language;
  onNotice: (value: string) => void;
  onError: (value: string) => void;
}) {
  const t = accountCopy[props.language].email;
  const [sending, setSending] = useState(false);
  const verified = props.account.emailVerified === true;
  const resend = async (): Promise<void> => {
    setSending(true);
    try {
      await resendVerification(props.account.email);
      props.onNotice(t.resent(props.account.email));
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : t.resend);
    } finally {
      setSending(false);
    }
  };
  return (
    <Panel title={t.heading}>
      <FieldRow label={t.address} value={props.account.email} technical />
      <FieldRow
        label={t.status}
        value={
          <StatusChip
            status={verified ? 'Completed' : 'Partial'}
            label={verified ? t.verified : t.unverified}
          />
        }
      />
      {verified ? null : (
        <>
          <p className="muted">{t.unverifiedBody}</p>
          <div className="button-row">
            <Button onClick={() => void resend()} disabled={sending}>
              {sending ? t.resending : t.resend}
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

function PasswordPanel(props: {
  language: Language;
  onNotice: (value: string) => void;
  onError: (value: string) => void;
}) {
  const t = accountCopy[props.language].password;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const found = {
      ...(next.length < PASSWORD_MIN_LENGTH ? { next: t.tooShort } : {}),
      ...(confirm !== next ? { confirm: t.mismatch } : {}),
    };
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      await apiRequest<{ status: string }>('/account/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      setCurrent('');
      setNext('');
      setConfirm('');
      props.onNotice(t.changed);
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.code === 'CURRENT_PASSWORD_INCORRECT') {
        setErrors({ current: t.wrongCurrent });
      } else {
        props.onError(caught instanceof Error ? caught.message : t.submit);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title={t.heading}>
      <form className="stack account-password" onSubmit={(event) => void submit(event)}>
        <p className="muted">{t.lead}</p>
        <Field
          label={t.current}
          type="password"
          name="current-password"
          autoComplete="current-password"
          value={current}
          onChange={setCurrent}
          error={errors.current}
        />
        <Field
          label={t.next}
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={next}
          onChange={setNext}
          hint={t.hint}
          error={errors.next}
        />
        <Field
          label={t.confirm}
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
          error={errors.confirm}
        />
        <div className="button-row">
          <Button type="submit" variant="primary" disabled={saving || current === ''}>
            {saving ? t.saving : t.submit}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function PurchasesPanel(props: { language: Language; onOpenScan: (scanId: string) => void }) {
  const t = accountCopy[props.language].purchases;
  const [purchases, setPurchases] = useState<readonly Purchase[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    apiRequest<Purchase[]>('/account/purchases')
      .then((value) => {
        if (current) setPurchases(value);
      })
      .catch((caught: unknown) => {
        console.error('FluxRadar purchases unavailable', caught);
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, []);
  return (
    <Panel title={t.heading}>
      <p className="muted">{t.lead}</p>
      {failed ? (
        <p role="alert">{t.loadFailed}</p>
      ) : purchases === null ? (
        <SkeletonRows rows={2} />
      ) : purchases.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>{t.date}</th>
              <th>{t.site}</th>
              <th>{t.plan}</th>
              <th>{t.amount}</th>
              <th>{t.status}</th>
              <th>{t.report}</th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((purchase) => (
              <tr key={purchase.id}>
                <td data-label={t.date}>
                  {formatDate(purchase.createdAt, props.language, 'short')}
                </td>
                <td data-label={t.site} className="technical">
                  {displayDomain(purchase.domain)}
                </td>
                <td data-label={t.plan}>{planName(purchase.plan)}</td>
                <td data-label={t.amount}>
                  {formatAmount(purchase.amount, purchase.currency, props.language)}
                </td>
                <td data-label={t.status}>
                  <StatusChip
                    status={purchase.status === 'paid' ? 'Completed' : 'Failed'}
                    label={t.statuses[purchase.status] ?? purchase.status}
                  />
                  {purchase.status === 'paid' && purchase.entitlementExpiresAt !== null ? (
                    <div className="muted account-note">
                      {t.accessUntil(
                        formatDate(purchase.entitlementExpiresAt, props.language, 'short'),
                      )}
                    </div>
                  ) : null}
                </td>
                <td data-label={t.report}>
                  {purchase.scanId !== null && purchase.status === 'paid' ? (
                    <Button onClick={() => props.onOpenScan(purchase.scanId ?? '')}>
                      {t.open}
                    </Button>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Panel>
  );
}

function DeletionPanel(props: {
  account: Account;
  language: Language;
  onDeleted: () => void;
  onError: (value: string) => void;
}) {
  const t = accountCopy[props.language].deletion;
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const confirmed = typed.trim().toLowerCase() === props.account.email.toLowerCase();
  const remove = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!confirmed) return;
    setDeleting(true);
    try {
      await apiRequest<{ deleted: boolean }>('/account', { method: 'DELETE' });
      props.onDeleted();
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : t.submit);
      setDeleting(false);
    }
  };
  return (
    <Panel title={t.heading} className="account-danger">
      <form className="stack" onSubmit={(event) => void remove(event)}>
        <p>{t.body}</p>
        <p className="muted">{t.provider}</p>
        <Field
          label={t.confirmLabel(props.account.email)}
          value={typed}
          onChange={setTyped}
          technical
          autoComplete="off"
        />
        <div className="button-row">
          <Button type="submit" variant="danger" disabled={!confirmed || deleting}>
            {deleting ? t.deleting : t.submit}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
