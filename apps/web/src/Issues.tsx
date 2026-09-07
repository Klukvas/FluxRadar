// The Issue Center: every finding of one report, with its evidence.
//
// The table is the product here, so the copy around it explains what a finding
// is and what severity means — the owner reading it is not an engineer.

import { Fragment, useEffect, useMemo, useState } from 'react';

import { apiRequest, type Issue, type Scan } from './api';
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  FieldRow,
  SkeletonRows,
  StatusChip,
  Window,
} from './components';
import { copy, fillCopy, type Language } from './i18n';

export function IssuesScreen(props: {
  scan: Scan | null;
  language: Language;
  onError: (value: string) => void;
}) {
  const t = copy[props.language].issues;
  const [issues, setIssues] = useState<Issue[]>([]);
  const [filter, setFilter] = useState('');
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!props.scan) {
      setLoading(false);
      return;
    }
    apiRequest<Issue[]>(`/scans/${props.scan.id}/issues?limit=100`)
      .then(setIssues)
      .catch((caught) =>
        props.onError(caught instanceof Error ? caught.message : 'Issues unavailable'),
      )
      .finally(() => setLoading(false));
  }, [props.scan?.id, props.onError]);
  const visible = useMemo(
    () =>
      filter === ''
        ? issues
        : issues.filter((issue) =>
            `${issue.ruleId} ${issue.module} ${issue.status} ${issue.targetUrl}`
              .toLowerCase()
              .includes(filter.toLowerCase()),
          ),
    [filter, issues],
  );
  const update = async (issue: Issue, status: string) => {
    try {
      const value = await apiRequest<Issue>(`/scans/${issue.scanId}/issues/${issue.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setIssues((current) =>
        current.map((candidate) => (candidate.id === value.id ? value : candidate)),
      );
      setSelectedIssue((current) => (current?.id === value.id ? value : current));
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Issue update failed');
    }
  };
  if (loading)
    return (
      <Window title={t.windowTitle}>
        <SkeletonRows rows={3} />
      </Window>
    );
  return (
    <Window title={`${t.windowTitle} · ${props.scan?.id ?? t.noScan}`}>
      <div className="split">
        <div>
          <h2 className="section-heading">{t.heading}</h2>
          <p className="muted">{t.lead}</p>
        </div>
        <Field
          label={t.filterLabel}
          technical
          value={filter}
          onChange={setFilter}
          placeholder={t.filterPlaceholder}
        />
      </div>
      <p className="muted issue-severity-legend">
        <strong>{t.severityLegendTerm}</strong> {t.severityLegendBody}
      </p>
      {visible.length === 0 ? (
        issues.length === 0 ? (
          <EmptyState title={t.emptyAll} description={t.emptyAllBody} />
        ) : (
          <EmptyState title={t.emptyFiltered} />
        )
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>{t.columnSeverity}</th>
              <th>{t.columnRule}</th>
              <th>{t.columnTarget}</th>
              <th>{t.columnStatus}</th>
              <th>{t.columnAction}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((issue) => {
              const isExpanded = selectedIssue?.id === issue.id;
              const detailId = `issue-detail-${issue.id}`;
              return (
                <Fragment key={issue.id}>
                  <tr>
                    <td data-label={t.columnSeverity}>
                      <StatusChip status={issue.severity} />
                    </td>
                    <td data-label={t.columnRule} className="technical">
                      {issue.ruleId}
                      <br />
                      <span className="muted">{issue.module}</span>
                    </td>
                    <td data-label={t.columnTarget} className="technical">
                      {issue.targetUrl}
                    </td>
                    <td data-label={t.columnStatus}>
                      <StatusChip status={issue.status} />
                    </td>
                    <td data-label={t.columnAction}>
                      <div className="button-row">
                        <Button
                          onClick={() => setSelectedIssue(isExpanded ? null : issue)}
                          aria-expanded={isExpanded}
                          aria-controls={detailId}
                        >
                          {isExpanded ? t.hideDetails : t.details}
                        </Button>
                        <select
                          className="control"
                          aria-label={t.columnStatus}
                          value={
                            ['New', 'Acknowledged', 'Ignored', 'False Positive'].includes(
                              issue.status,
                            )
                              ? issue.status
                              : 'New'
                          }
                          onChange={(event) => void update(issue, event.target.value)}
                        >
                          <option>New</option>
                          <option>Acknowledged</option>
                          <option>Ignored</option>
                          <option>False Positive</option>
                        </select>
                      </div>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr id={detailId} className="issue-detail-row">
                      <td colSpan={5} className="issue-detail-cell">
                        <div className="issue-detail">
                          <div className="split">
                            <strong>
                              {issue.ruleId} · {issue.module}
                            </strong>
                            <Button onClick={() => setSelectedIssue(null)}>{t.closeDetails}</Button>
                          </div>
                          <FieldRow
                            label={t.columnSeverity}
                            value={<StatusChip status={issue.severity} />}
                          />
                          <FieldRow
                            label={t.columnStatus}
                            value={<StatusChip status={issue.status} />}
                          />
                          <FieldRow label={t.columnTarget} value={issue.targetUrl} technical />
                          <FieldRow
                            label={t.evidence}
                            value={issue.evidenceExcerpt ?? t.noExcerpt}
                          />
                          <FieldRow label={t.recommendation} value={issue.recommendation} />
                          <FieldRow
                            label={t.impact}
                            value={fillCopy(t.impactValue, {
                              affected: issue.affectedTargets,
                              applicable: issue.applicableTargets,
                              delta: issue.scoreDelta.toFixed(2),
                            })}
                          />
                          <FieldRow
                            label={t.confidence}
                            value={`${(issue.confidence * 100).toFixed(0)}%`}
                          />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </Window>
  );
}
