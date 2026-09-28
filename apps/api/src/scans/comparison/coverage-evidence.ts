// Everything a comparison needs from a finished scan's stored re-check proof,
// read once.
//
// Two questions live in that proof, and they are asked together: which pages the
// scan judged (page-census.ts) and which rules it ran at all (checked-rules.ts).
// Both are answered by walking the same rule table, and the table costs a gunzip
// of up to 800 KB per module to reach — so the rows are loaded once, each
// module's proof is decoded once, and the two answers come out of that one pass.
//
// The read fails closed, module by module. A proof that will not decode leaves a
// set of pages nobody can account for, and a census missing them would report
// them as removed; it also leaves the rules of that module unknown, and a rule
// set with a hole in it would read as a check that stopped running. Neither is
// reported as a fact about the site.

import { CANONICAL_PAGE_RULE_IDS, PAGE_RULE_IDS } from '@fluxradar/rules';
import type { PrismaClient } from '@prisma/client';

import { readProofFacts } from '../../orchestrator/run-coverage.ts';
import { UNKNOWN_CHECKED_RULES, type CheckedRules } from './checked-rules.ts';
import { NO_PAGE_CENSUS, type PageCensus } from './page-census.ts';

const CANONICAL_RULES: ReadonlySet<string> = new Set(CANONICAL_PAGE_RULE_IDS);

/**
 * The page rules that name a snapshot rather than a document.
 *
 * Derived by subtraction rather than listed, so a rule that gains or loses
 * `judgedAddress` moves between the two censuses by itself.
 */
const SNAPSHOT_RULES: ReadonlySet<string> = new Set(
  PAGE_RULE_IDS.filter((ruleId) => !CANONICAL_RULES.has(ruleId)),
);

const PROOF_GROUPS = { canonical: CANONICAL_RULES, snapshot: SNAPSHOT_RULES } as const;

/** What one scan's proofs say, in the two readings the comparison uses. */
export interface CoverageEvidence {
  readonly census: PageCensus;
  readonly checkedRules: CheckedRules;
}

/** Records a proof this read could not decode; never user-facing. */
export type CoverageProblemLog = (detail: {
  scanId: string;
  module: string;
  problem: string;
}) => void;

export async function readCoverageEvidence(
  prisma: PrismaClient,
  scanId: string,
  onProblem?: CoverageProblemLog,
): Promise<CoverageEvidence> {
  const proofs = await prisma.ruleCoverageProof.findMany({
    where: { scanId },
    select: { module: true, proof: true },
  });
  if (proofs.length === 0) {
    // No proof at all is not "this scan checked nothing": it is a scan whose
    // evidence was pruned or never written, and both readings say so.
    return { census: NO_PAGE_CENSUS, checkedRules: UNKNOWN_CHECKED_RULES };
  }
  const canonical = new Set<string>();
  const crawlAddress = new Set<string>();
  const ruleIds = new Set<string>();
  let unreadable = false;
  for (const stored of proofs) {
    const facts = readProofFacts(stored.proof, PROOF_GROUPS);
    if (facts.problem !== null) {
      onProblem?.({ scanId, module: stored.module, problem: facts.problem });
      unreadable = true;
      continue;
    }
    for (const target of facts.targets.canonical ?? []) {
      canonical.add(target);
    }
    for (const target of facts.targets.snapshot ?? []) {
      crawlAddress.add(target);
    }
    for (const ruleId of facts.ruleIds) {
      ruleIds.add(ruleId);
    }
  }
  if (unreadable) {
    return {
      census: {
        canonical: new Set(),
        crawlAddress: new Set(),
        problem: 'page-evidence-unreadable',
      },
      checkedRules: UNKNOWN_CHECKED_RULES,
    };
  }
  const checkedRules: CheckedRules = { ruleIds, known: true };
  if (canonical.size === 0 && crawlAddress.size === 0) {
    return { census: { canonical, crawlAddress, problem: 'page-evidence-empty' }, checkedRules };
  }
  return { census: { canonical, crawlAddress, problem: null }, checkedRules };
}
