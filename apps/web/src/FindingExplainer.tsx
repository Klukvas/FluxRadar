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
//
// The last piece hands the problem on: one ready message for the developer,
// copied to the clipboard, or shown to copy by hand when the browser refuses.

import { useEffect, useState } from 'react';

import type { Issue } from './api';
import { Button } from './components';
import { developerTaskText, nothingOpen, taskPageCount } from './developer-task';
import { findingCountsPages, findingExplainer, problemTitle } from './finding-explainers';
import { problemBreakdown, type EvidenceVariant } from './finding-variants';
import { findingsCopy } from './findings-copy';
import type { Language } from './i18n';

/** How many distinct pieces of evidence the breakdown lists before the rest
 * has to be asked for. */
export const VARIANT_LIMIT = 5;

/** How many addresses one piece of evidence lists before the rest is asked for. */
export const VARIANT_PAGE_LIMIT = 5;

/**
 * What the check found, in one plain sentence, for the rules that have an
 * explanation — and nothing at all for the rest.
 *
 * It is on the row rather than behind the fold below it: a list of problems
 * whose plain names are its only readable part is a list the owner has to open
 * a disclosure per row to understand, and they do not. The rest of the
 * explanation — why it matters, what to do, what one finding counts — stays in
 * the fold, so the row is still one row.
 */
export function FindingWhat(props: { ruleId: string; language: Language }) {
  const explainer = findingExplainer(props.ruleId, props.language);
  if (explainer === null) return null;
  return <p className="muted finding-what">{explainer.what}</p>;
}

/**
 * What this rule means, why it matters and what to do — for the rules that have
 * an explanation, and nothing at all for the rest, so the problem list does not
 * grow an empty disclosure per row.
 *
 * `open` is for the finding detail. In a list it stays folded: one row per
 * problem is the whole reason the list reads.
 *
 * `withWhat` is for a caller that already says the first sentence itself
 * (`FindingWhat`): saying it twice on one row would be worse than folding it.
 */
export function FindingExplainer(props: {
  ruleId: string;
  language: Language;
  open?: boolean;
  withWhat?: boolean;
}) {
  const f = findingsCopy[props.language].issues;
  const explainer = findingExplainer(props.ruleId, props.language);
  if (explainer === null) return null;
  return (
    <details className="finding-explainer" {...(props.open ? { open: true } : {})}>
      <summary className="finding-explainer__summary">{f.explainerTitle}</summary>
      <dl className="finding-explainer__body">
        {props.withWhat === false ? null : (
          <div>
            <dt>{f.explainerWhat}</dt>
            <dd>{explainer.what}</dd>
          </div>
        )}
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
  const [allVariants, setAllVariants] = useState(false);
  const breakdown = problemBreakdown(props.issues, props.language);
  if (breakdown.findings === 0) return null;
  const listed = allVariants ? breakdown.variants : breakdown.variants.slice(0, VARIANT_LIMIT);
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
                <span className="technical">{variant.evidence}</span>
                <EvidencePages variant={variant} language={props.language} />
              </li>
            ))}
          </ul>
          {/* Not "…and 1 more": a line that names a number and then refuses to
              show it is a dead end. The rest is one press away. */}
          {beyond > 0 || allVariants ? (
            <Button onClick={() => setAllVariants(!allVariants)}>
              {allVariants ? f.showFewer : f.showAll(breakdown.variants.length)}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * Which pages recorded one piece of evidence.
 *
 * The count alone was the whole line, and it was read backwards: "Only one
 * crawled page links to this one: /en/careers — 3 findings" reads as careers
 * having three problems, when it means three other pages each hang off a link
 * from careers. The addresses are what the line is about.
 */
function EvidencePages(props: { variant: EvidenceVariant; language: Language }) {
  const f = findingsCopy[props.language].issues;
  const [all, setAll] = useState(false);
  const { pages } = props.variant;
  const listed = all ? pages : pages.slice(0, VARIANT_PAGE_LIMIT);
  return (
    <>
      <p className="problem-breakdown__on">{f.variantPages(pages.length)}</p>
      <ul className="problem-breakdown__pages-list">
        {listed.map((page) => (
          <li key={page} className="technical">
            {page}
          </li>
        ))}
      </ul>
      {pages.length > VARIANT_PAGE_LIMIT ? (
        <Button onClick={() => setAll(!all)}>{all ? f.showFewer : f.showAll(pages.length)}</Button>
      ) : null}
    </>
  );
}

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Copies `text` and remembers how that went. A browser can refuse the clipboard
 * — no permission, an insecure page, an older browser — so a refusal is logged
 * with its rule and kept as state for the caller to say out loud.
 *
 * A new text resets the state: a "copied" left over from the previous text
 * would no longer be true of this one.
 */
function useClipboardCopy(text: string | null, ruleId: string) {
  const [state, setState] = useState<CopyState>('idle');
  useEffect(() => {
    setState('idle');
  }, [text]);
  const copy = async (): Promise<void> => {
    if (text === null) return;
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch (caught) {
      console.error('FluxRadar developer task could not be copied', ruleId, caught);
      setState('failed');
    }
  };
  return { state, copy } as const;
}

/** The refusal, said out loud, with the text on screen to copy by hand. */
function CopyFailure(props: { text: string; language: Language }) {
  const t = findingsCopy[props.language].task;
  return (
    <div className="developer-task__failed" role="alert">
      <p>{t.failed}</p>
      <textarea
        className="control developer-task__text"
        aria-label={t.textLabel}
        readOnly
        rows={10}
        value={props.text}
        onFocus={(event) => event.currentTarget.select()}
      />
    </div>
  );
}

/**
 * "Copy task for developer" for the problem that is open: one message with the
 * problem's name, how far it reaches, example addresses and the recommendation.
 *
 * A button that silently did nothing would leave the owner pasting an empty
 * message, so a refused copy is shown, never swallowed.
 */
export function DeveloperTaskCopy(props: {
  ruleId: string;
  issues: readonly Issue[];
  allLoaded: boolean;
  /** The summary's open count, or null when there is no summary. */
  openFindings: number | null;
  language: Language;
}) {
  const t = findingsCopy[props.language].task;
  const input = {
    ruleId: props.ruleId,
    language: props.language,
    issues: props.issues,
    allLoaded: props.allLoaded,
    openFindings: props.openFindings,
  };
  const text = developerTaskText(input);
  const { state, copy } = useClipboardCopy(text, props.ruleId);
  if (text === null) {
    // Said rather than left out: a button that vanished would read as broken.
    // Either nothing is open at all, or the open findings are past what is loaded.
    return (
      <p className="muted developer-task">{nothingOpen(input) ? t.nothingOpen : t.notLoaded}</p>
    );
  }
  // What the button copies, and who it is for. Without it the label read as
  // "copy this row", and as something only a developer may press.
  const problem = problemTitle(props.ruleId, props.language);
  // The task's own counts, not the loaded rows': a page whose only finding the
  // owner ignored is in neither the message nor this sentence, a finding the
  // summary has not caught up with is in both, and a partly loaded list is
  // hedged here the same way the message hedges it.
  const reach = taskPageCount(input);
  const namesPages = reach.atLeast ? t.explainsAtLeast : t.explains;
  const explains = findingCountsPages(props.ruleId)
    ? namesPages(problem, reach.pages)
    : t.explainsCount(problem, reach.findings);
  return (
    <div className="developer-task">
      <Button onClick={() => void copy()} aria-label={t.copyFor(problem)}>
        {t.copy}
      </Button>
      <p className="muted developer-task__explains">{explains}</p>
      {state === 'copied' ? (
        <p className="developer-task__status" role="status">
          {t.copied}
        </p>
      ) : null}
      {state === 'failed' ? <CopyFailure text={text} language={props.language} /> : null}
    </div>
  );
}
