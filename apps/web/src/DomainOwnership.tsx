// The optional proof that this account controls one of its sites.
//
// It is optional in the strong sense: nothing on this panel gates a scan, a plan
// or a price, and a workspace that never opens it behaves exactly as it did
// before. What it buys the owner is a record — useful when an audit of a site
// has to be justified to somebody, and the ground the product would stand on if
// deeper paid checks are ever gated on ownership — a decision that is still
// open.

import { useCallback, useEffect, useState } from 'react';

import { apiRequest, type DomainVerification, type SiteProfile } from './api';
import { Button, FieldRow, Panel, SelectField, SkeletonRows, StatusChip } from './components';
import { copy, fillCopy, type Language } from './i18n';
import { formatTimestamp } from './scan-status';

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
  const profileId = props.profile.id;
  const { onError } = props;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await apiRequest<DomainVerification | null>(
        `/profiles/${encodeURIComponent(profileId)}/verification`,
      );
      setRecord(loaded);
      if (loaded !== null) setMethod(loaded.method);
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

  if (loading) {
    return (
      <Panel title={t.title}>
        <SkeletonRows rows={2} />
      </Panel>
    );
  }
  return (
    <Panel title={t.title}>
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
