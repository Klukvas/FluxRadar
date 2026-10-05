// The optional proof that this account controls one of its sites.
//
// It is optional in the strong sense: nothing on this panel gates a scan, a plan
// or a price, and a workspace that never opens it behaves exactly as it did
// before. What it buys the owner is a record — useful when an audit of a site
// has to be justified to somebody, and the ground the product would stand on if
// deeper paid checks are ever gated on ownership — a decision that is still
// open.

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { apiRequest, type DomainVerification, type SiteProfile } from './api';
import { Button, FieldRow, Panel, SelectField, SkeletonRows, StatusChip } from './components';
import { domainOwnershipCopy } from './domain-ownership-copy';
import { copy, fillCopy, type Language } from './i18n';
import { formatTimestamp } from './scan-status';
import './styles/domain-ownership.css';

export function DomainOwnershipPanel(props: {
  readonly language: Language;
  readonly profile: SiteProfile;
  readonly onError: (value: string) => void;
}) {
  const t = copy[props.language].domainOwnership;
  const [record, setRecord] = useState<DomainVerification | null>(null);
  const [method, setMethod] = useState<DomainVerification['method']>('dns-txt');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Folded until the owner asks, unless a proof is already under way: then the
  // record they started is what they came back for.
  const [isOpen, setIsOpen] = useState(false);
  const profileId = props.profile.id;
  const { onError } = props;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await apiRequest<DomainVerification | null>(
        `/profiles/${encodeURIComponent(profileId)}/verification`,
      );
      setRecord(loaded);
      if (loaded !== null) {
        setMethod(loaded.method);
        setIsOpen(true);
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Ownership status unavailable');
    } finally {
      setLoading(false);
    }
  }, [onError, profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const call = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      const updated = await apiRequest<DomainVerification>(
        `/profiles/${encodeURIComponent(profileId)}/verification${path}`,
        { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
      );
      setRecord(updated);
      setMethod(updated.method);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Ownership check failed');
    } finally {
      setBusy(false);
    }
  };

  const fold = (children: ReactNode) => (
    <OwnershipFold language={props.language} isOpen={isOpen} onToggle={setIsOpen} title={t.title}>
      {children}
    </OwnershipFold>
  );
  if (loading) return fold(<SkeletonRows rows={2} />);
  return fold(
    <>
      <p className="muted panel-help">{t.optionalNote}</p>
      <FieldRow label={t.site} value={props.profile.domain} />
      {record === null ? (
        <>
          <SelectField
            label={t.labelMethod}
            name="ownership-method"
            value={method}
            onChange={(value) => setMethod(value as DomainVerification['method'])}
            options={methodOptions(t)}
          />
          <div className="button-row">
            <Button variant="primary" disabled={busy} onClick={() => void call('', { method })}>
              {busy ? t.working : t.start}
            </Button>
          </div>
        </>
      ) : (
        <>
          <FieldRow
            label={t.status}
            value={
              <StatusChip status={chipStatus(record)} label={statusLabel(record, props.language)} />
            }
          />
          <FieldRow label={t.labelMethod} value={methodLabel(record.method, t)} />
          <FieldRow label={t.instruction} value={record.instruction} />
          {/* The value to publish, verbatim. A meta tag takes the bare token;
              the other two take the whole `name=value` record. */}
          <FieldRow
            label={t.value}
            technical
            value={record.method === 'meta' ? record.token : record.record}
          />
          <FieldRow
            label={t.tokenExpires}
            value={formatTimestamp(record.tokenExpiresAt, props.language) ?? t.unknown}
          />
          {record.verifiedAt === null ? null : (
            <FieldRow
              label={t.verifiedAt}
              value={formatTimestamp(record.verifiedAt, props.language) ?? t.unknown}
            />
          )}
          {record.lastFailureReason === null ? null : (
            <FieldRow
              label={t.lastCheck}
              value={fillCopy(t.lastCheckFailed, { reason: record.lastFailureReason })}
            />
          )}
          {record.stale === true && record.status === 'verified' ? (
            <p className="muted">{t.stale}</p>
          ) : null}
          <SelectField
            label={t.labelMethod}
            name="ownership-method"
            value={method}
            onChange={(value) => setMethod(value as DomainVerification['method'])}
            options={methodOptions(t)}
          />
          <div className="button-row">
            <Button
              variant="primary"
              disabled={busy || record.tokenExpired}
              onClick={() => void call('/verify')}
            >
              {busy ? t.working : t.verify}
            </Button>
            {/* Re-issuing is how the method is changed and how a token is
                rotated; it deliberately invalidates the old one. */}
            <Button disabled={busy} onClick={() => void call('', { method })}>
              {t.reissue}
            </Button>
          </div>
          {record.tokenExpired ? <p className="muted">{t.tokenExpired}</p> : null}
        </>
      )}
    </>,
  );
}

/**
 * The panel folded to one line and a reason it is safe to skip. Unfolded, it
 * shows the panel exactly as it was, title and all. The content stays mounted
 * while folded, so the status read on mount is unchanged.
 */
function OwnershipFold(props: {
  readonly language: Language;
  readonly isOpen: boolean;
  readonly onToggle: (isOpen: boolean) => void;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const fold = domainOwnershipCopy[props.language];
  return (
    <Panel className="ownership-fold">
      <details open={props.isOpen} onToggle={(event) => props.onToggle(event.currentTarget.open)}>
        <summary className="ownership-fold__summary">
          <strong>{fold.summary}</strong>
          <span className="muted ownership-fold__why">{fold.why}</span>
        </summary>
        <div className="ownership-fold__body">
          <div className="panel__label">{props.title}</div>
          {props.children}
        </div>
      </details>
    </Panel>
  );
}

/** Either language's strings: the helpers below read them, never compare them. */
type OwnershipCopy = (typeof copy)[Language]['domainOwnership'];

function methodOptions(t: OwnershipCopy): readonly { value: string; label: string }[] {
  return [
    { value: 'dns-txt', label: t.methodDns },
    { value: 'file', label: t.methodFile },
    { value: 'meta', label: t.methodMeta },
  ];
}

function methodLabel(method: DomainVerification['method'], t: OwnershipCopy): string {
  if (method === 'dns-txt') return t.methodDns;
  return method === 'file' ? t.methodFile : t.methodMeta;
}

/** The chip's colour comes from the API's vocabulary, never the translation. */
function chipStatus(record: DomainVerification): string {
  if (record.status === 'verified') return 'Completed';
  return record.status === 'failed' ? 'Failed' : 'Pending';
}

function statusLabel(record: DomainVerification, language: Language): string {
  const t = copy[language].domainOwnership;
  if (record.status === 'verified') return t.statusVerified;
  return record.status === 'failed' ? t.statusFailed : t.statusPending;
}
