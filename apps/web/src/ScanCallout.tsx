import type { ReactNode } from 'react';

/**
 * A collapsible explanation sitting next to the control it explains.
 *
 * The three callouts on the new-scan screen were 575px of always-open prose
 * wedged between the fields — read once, scrolled past on every later scan.
 * The eyebrow, the mode chip and the heading stay visible, so the screen still
 * announces that robots.txt, AI processing and the performance provider are
 * part of the deal; the paragraph is one click away.
 *
 * `<details>` keeps the body in the DOM while closed, so the `aria-describedby`
 * a checkbox points at still resolves — a disclosure that hid it would take the
 * description away from exactly the reader who most needs it.
 *
 * What a callout may cost in height is not the same question as what it owes
 * the buyer: a body that has to be read before money changes hands opens with
 * `defaultOpen`, and only the operational explanations start folded.
 */
export function ScanCallout(props: {
  eyebrow: string;
  title: string;
  titleId: string;
  mode: string;
  /** Set when a control describes itself with this callout's body. */
  bodyId?: string;
  /** Constant per call site: the open state is the reader's from then on. */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className="scan-option-callout"
      aria-labelledby={props.titleId}
      {...(props.defaultOpen ? { open: true } : {})}
    >
      <summary className="scan-option-callout__summary">
        <span className="scan-option-callout__header">
          <span className="scan-option-callout__eyebrow">{props.eyebrow}</span>
          <span className="status-chip status-chip--neutral">{props.mode}</span>
        </span>
        <h3 id={props.titleId}>{props.title}</h3>
      </summary>
      <p id={props.bodyId} className="scan-option-callout__body">
        {props.children}
      </p>
    </details>
  );
}
