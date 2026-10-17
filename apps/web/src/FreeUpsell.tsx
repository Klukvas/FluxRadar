// The last block of a Free report: what the free check found on the homepage,
// and the Basic report that reads the rest of the site.
//
// It used to sell Complete with a generic feature list. The owners this block
// is for weigh one question — why am I not found in search and in AI answers —
// and that is what Basic answers, so the block sells Basic and opens with the
// real result of the check they just ran.

import type { Scan } from './api';
import { Button } from './components';
import { findingsCopy } from './findings-copy';
import type { Language } from './i18n';
import type { PaidPlan } from './plan-modules';
import { displayDomain } from './scan-status';

/** The plan this block sells, preselected on the scan form its button opens. */
export const FREE_UPSELL_PLAN: PaidPlan = 'Basic';

export function FreeUpsell(props: {
  scan: Scan;
  language: Language;
  /**
   * How many distinct problems the free check left open on the homepage, or
   * null while the issue summary is loading — the lead then says no number
   * rather than a "0" that flips to the real one.
   */
  openProblems: number | null;
  onUpgrade: (plan: PaidPlan) => void;
}) {
  const f = findingsCopy[props.language].upsell;
  return (
    <section className="report-block upsell" aria-labelledby="upsell-heading">
      <h3 id="upsell-heading">{f.heading}</h3>
      <p>{f.lead(displayDomain(props.scan.domain), props.openProblems)}</p>
      <p className="upsell__intro">{f.listIntro}</p>
      <ul>
        {f.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <p className="upsell__price">{f.price}</p>
      <div className="button-row">
        <Button variant="primary" onClick={() => props.onUpgrade(FREE_UPSELL_PLAN)}>
          {f.action}
        </Button>
        <a href="/plans">{f.compare}</a>
      </div>
    </section>
  );
}
