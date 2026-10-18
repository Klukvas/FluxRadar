// The pages a problem was found on, and what was found on each, in the row.
//
// Shared by "Fix these first" and the Issue Center's problem view, so the two
// name the same pages in the same words. Up to three findings are named; the
// rest are counted ("and 5 more") and one click away behind the row's button.
// A problem whose summary carries no samples (an older API, the public example)
// renders nothing, and the row reads exactly as it did before.

import type { IssueRuleGroup } from './api';
import { evidenceCopy } from './finding-evidence-copy';
import {
  cleanEvidenceText,
  evidenceLine,
  readIssueSamples,
  shortAddress,
} from './finding-evidence';
import type { Language } from './i18n';

/** The full address in the tooltip: long enough for any real page address. */
const FULL_ADDRESS_MAX_CHARS = 2048;

export function ProblemEvidence(props: { group: IssueRuleGroup; language: Language }) {
  const samples = readIssueSamples(props.group);
  if (samples.length === 0) return null;
  const copy = evidenceCopy[props.language];
  const more = props.group.openIssues - samples.length;
  return (
    <ul className="problem-evidence" aria-label={copy.listLabel}>
      {samples.map((sample, index) => {
        const line = evidenceLine(sample, props.language);
        const address = shortAddress(sample.targetUrl);
        return (
          // Two findings can share an address (two broken links on one page),
          // so the position is part of the key.
          <li key={`${index}:${sample.targetUrl}`} className="problem-evidence__item">
            <span
              className="problem-evidence__page technical"
              title={cleanEvidenceText(sample.targetUrl, FULL_ADDRESS_MAX_CHARS)}
            >
              {address}
            </span>
            {line === null ? null : <span className="problem-evidence__line">{line}</span>}
          </li>
        );
      })}
      {more > 0 ? <li className="problem-evidence__more muted">{copy.more(more)}</li> : null}
    </ul>
  );
}
