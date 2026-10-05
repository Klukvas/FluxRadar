// The plain-language layer over a security finding, and what a problem's
// findings add up to.
//
// A report that says `The HTML response has no Content-Security-Policy` three
// hundred times tells the owner nothing they can act on. The disclosure says
// what the problem is — folded, so the problem list stays one row per problem —
// and the breakdown says whether it is one fix or several.
//
// Both stay quiet about what the scanner does not know: the disclosure closes
// with the scope sentence, and the breakdown says "so far" until every finding
// of the problem is loaded.

import type { Issue } from './api';
import { findingExplainer } from './finding-explainers';
import { problemBreakdown } from './finding-variants';
import { findingsCopy } from './findings-copy';
import type { Language } from './i18n';

/** How many distinct pieces of evidence the breakdown lists before summarising. */
export const VARIANT_LIMIT = 5;

/**
 * What this rule means, why it matters and what to do — for the rules that have
 * an explanation, and nothing at all for the rest, so the problem list does not
 * grow an empty disclosure per row.
 *
 * `open` is for the finding detail. In a list it stays folded: one row per
 * problem is the whole reason the list reads.
 */
export function FindingExplainer(props: { ruleId: string; language: Language; open?: boolean }) {
  const f = findingsCopy[props.language].issues;
  const explainer = findingExplainer(props.ruleId, props.language);
  if (explainer === null) return null;
  return (
    <details className="finding-explainer" {...(props.open ? { open: true } : {})}>
      <summary className="finding-explainer__summary">{f.explainerTitle}</summary>
      <dl className="finding-explainer__body">
        <div>
          <dt>{f.explainerWhat}</dt>
          <dd>{explainer.what}</dd>
        </div>
        <div>
          <dt>{f.explainerWhy}</dt>
          <dd>{explainer.why}</dd>
        </div>
        <div>
          <dt>{f.explainerFix}</dt>
          <dd>{explainer.fix}</dd>
        </div>
        <div>
          <dt>{f.explainerCount}</dt>
          <dd>{explainer.count}</dd>
        </div>
      </dl>
      <p className="muted finding-explainer__scope">{f.explainerScope}</p>
    </details>
  );
}

/**
 * How many pages one problem's loaded findings touch, and where their evidence
 * differs — the difference between "one server setting" and "a list to read".
 *
 * `complete` is the caller's answer to "is this every finding of the problem?":
 * the page count is only a count of the problem when nothing is left to load.
 */
export function ProblemBreakdown(props: {
  issues: readonly Issue[];
  language: Language;
  complete: boolean;
}) {
  const f = findingsCopy[props.language].issues;
  const breakdown = problemBreakdown(props.issues, props.language);
  if (breakdown.findings === 0) return null;
  const listed = breakdown.variants.slice(0, VARIANT_LIMIT);
  const beyond = breakdown.variants.length - listed.length;
  // "The same evidence" only holds when the one variant accounts for every
  // loaded finding: a finding that recorded no evidence is in none of the
  // variants, and the sentence would be speaking for it too.
  const sole = breakdown.variants.length === 1 ? breakdown.variants[0] : undefined;
  const allSameEvidence = props.complete && sole?.findings === breakdown.findings;
  return (
    <div className="problem-breakdown">
      <p className="problem-breakdown__pages">
        {props.complete
          ? f.breakdownPages(breakdown.pages)
          : f.breakdownPagesSoFar(breakdown.pages)}
      </p>
      {allSameEvidence ? <p className="muted">{f.breakdownSame}</p> : null}
      {breakdown.variants.length > 1 ? (
        <>
          <p className="problem-breakdown__heading">{f.breakdownVariants}</p>
          <ul className="problem-breakdown__variants">
            {listed.map((variant) => (
              <li key={variant.evidence}>
                <span className="technical">{variant.evidence}</span> —{' '}
                {f.variantFindings(variant.findings)}
              </li>
            ))}
            {beyond > 0 ? <li className="muted">{f.variantsMore(beyond)}</li> : null}
          </ul>
        </>
      ) : null}
    </div>
  );
}
