// Which rules a finished scan actually ran.
//
// A comparison that counts findings by fingerprint alone cannot tell "this
// problem is new" from "this check is new". The two look identical: the rule
// shipped between the two scans, it found forty pages, and none of those
// fingerprints existed before. `RULESET_VERSION` does not separate them — six
// page rules shipped in one week without it moving — but the stored re-check
// proof does, because every rule that ran left an entry in it under its own id
// (orchestrator/run-coverage.ts).
//
// The read itself is in coverage-evidence.ts, beside the page census it shares a
// pass over the proof with. What lives here is the distinction that makes the
// answer safe: "this scan ran no rules" and "nobody can say which rules this
// scan ran" must not be the same answer. The first would make every finding of
// the other scan first-checked; so a scan with no stored proof, or one whose
// proof will not decode, is UNKNOWN and the comparison then draws no
// first-checked conclusion at all.

/** The rules of one scan, and whether the answer is complete enough to use. */
export interface CheckedRules {
  readonly ruleIds: ReadonlySet<string>;
  /**
   * True only when every module of the scan accounted for its rules.
   *
   * False means "unknown", never "none": a proof that was pruned, was never
   * written, or will not decode leaves a gap that a set difference would read as
   * a rule that did not run.
   */
  readonly known: boolean;
}

export const UNKNOWN_CHECKED_RULES: CheckedRules = { ruleIds: new Set(), known: false };

/** Rules of the first set that the second does not have, sorted. */
function ruleDifference(left: CheckedRules, right: CheckedRules): readonly string[] {
  if (!left.known || !right.known) {
    return [];
  }
  return [...left.ruleIds].filter((ruleId) => !right.ruleIds.has(ruleId)).toSorted();
}

/** What each scan checked that the other did not, in both directions. */
export interface RuleCoverageDelta {
  /** Ran now, absent from the previous scan's proof. */
  readonly firstChecked: readonly string[];
  /** Ran before, absent from this scan's proof. */
  readonly noLongerChecked: readonly string[];
}

export function ruleCoverageDelta(
  current: CheckedRules,
  previous: CheckedRules,
): RuleCoverageDelta {
  return {
    firstChecked: ruleDifference(current, previous),
    noLongerChecked: ruleDifference(previous, current),
  };
}
