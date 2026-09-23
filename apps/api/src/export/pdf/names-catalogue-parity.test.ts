// The two server-side copies of the owner-facing rule titles, against each other.
//
// There are three declarations of the same words. `apps/web/src/rule-titles.ts`
// is the original; `@fluxradar/rules`'s copy exists because the Action Plan sends
// the title to a model from the server, and `export/pdf/names.ts` exists because
// the downloadable report writes it into a document. Each already has a parity
// test against the browser file, and each of those was written in a different
// lane, in ignorance of the other.
//
// Transitively that is enough — two copies pinned to one original agree. What it
// does not survive is one of those guards being relaxed, which is a one-line
// change in a file whose own suite stays green. So the two server copies are
// also compared to each other, here, where a drift in either shows up as a drift
// between them.
//
// This is the only place in the repository that imports both.

import { RULE_TITLES as PLAN_TITLES } from '@fluxradar/rules';
import { describe, expect, it } from 'vitest';

import { RULE_TITLES as PDF_TITLES } from './names.ts';

describe('the Action Plan and the PDF name a rule the same way', () => {
  it('declares the same rules on both sides', () => {
    // Neither is a subset of the other by design: both are meant to be the whole
    // catalogue, so a rule missing from one is a gap, not a scope difference.
    expect(Object.keys(PDF_TITLES).sort()).toEqual(Object.keys(PLAN_TITLES).sort());
  });

  it('uses the same words in both languages', () => {
    const drifted = Object.keys(PDF_TITLES).filter((ruleId) => {
      const pdf = PDF_TITLES[ruleId];
      const plan = PLAN_TITLES[ruleId];
      return plan === undefined || pdf?.en !== plan.en || pdf.uk !== plan.uk;
    });
    // A document and a plan that name the same finding differently read as two
    // findings to the owner holding both.
    expect(drifted).toEqual([]);
  });
});
