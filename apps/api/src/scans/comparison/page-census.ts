// The pages of a finished scan, and the honest limits of knowing them.
//
// WHERE THE PAGES OF A FINISHED SCAN LIVE. Not in `ScanCrawlPage`: those rows
// are a paused run's evidence, and every terminal path deletes them
// (`clearCrawlEvidence`, orchestrator/worker.ts). A Completed scan therefore has
// no stored page list — the only surviving per-address record is the re-check
// proof the plans that close findings write, `RuleCoverageProof`, where every
// rule names the targets it judged. The targets of a page rule are pages, under
// the same name its findings use (@fluxradar/rules PAGE_RULE_IDS).
//
// WHICH NAME THE PAGES COME UNDER. Preferably the document's own address: the
// rules that declare `judgedAddress` name a page by where the site's redirects
// say the document lives, one entry per document (CANONICAL_PAGE_RULE_IDS). That
// is what keeps `/p` and `/p/` from reading as one page removed and another
// added when only the linked form changed. When no such rule ran — a one-page
// crawl leaves the duplicate-value rules with nothing to compare — the census
// falls back to the addresses each snapshot was read under, and the response
// says which identity was used rather than letting the reader assume the
// stronger one.
//
// WHAT IS NOT KNOWN, AND IS SAID. The proof is kept for the last two completed
// scans of a plan (`pruneCoverageProofs`), which is exactly the pair a fresh
// report compares — and nothing older. An earlier report therefore compares its
// findings and reports `page-evidence-missing` for its pages. A proof that is
// present but unreadable, or that names no page at all, gets its own reason. None
// of the three is ever rendered as "0 pages added, 0 removed".

import { CANONICAL_PAGE_RULE_IDS, PAGE_RULE_IDS } from '@fluxradar/rules';
import type { PageComparisonReason, PageIdentityKind } from '@fluxradar/contracts';
import type { PrismaClient } from '@prisma/client';

import { checkedTargetsOfProof } from '../../orchestrator/run-coverage.ts';

const CANONICAL_RULES: ReadonlySet<string> = new Set(CANONICAL_PAGE_RULE_IDS);
const PAGE_RULES: ReadonlySet<string> = new Set(PAGE_RULE_IDS);

/** One scan's page census: the addresses it judged, under a named identity. */
export interface PageCensus {
  readonly canonical: ReadonlySet<string>;
  readonly crawlAddress: ReadonlySet<string>;
  /** Why the census is unusable; null when at least one page was named. */
  readonly problem: PageComparisonReason | null;
}

export const NO_PAGE_CENSUS: PageCensus = {
  canonical: new Set(),
  crawlAddress: new Set(),
  problem: 'page-evidence-missing',
};

/** An unreadable proof of any module makes the whole census unusable. */
export type CensusProblemLog = (detail: {
  scanId: string;
  module: string;
  problem: string;
}) => void;

/**
 * Reads one scan's page census out of its stored re-check proofs.
 *
 * Module by module, and only the target sets the page rules point at: the proof
 * of a 50 000-URL crawl is hundreds of kilobytes compressed per module, and
 * indexing all of it to answer "which pages" would hold the whole thing in
 * memory for nothing (`checkedTargetsOfProof`).
 */
export async function readPageCensus(
  prisma: PrismaClient,
  scanId: string,
  onProblem?: CensusProblemLog,
): Promise<PageCensus> {
  const proofs = await prisma.ruleCoverageProof.findMany({
    where: { scanId },
    select: { module: true, proof: true },
  });
  if (proofs.length === 0) {
    return NO_PAGE_CENSUS;
  }
  const canonical = new Set<string>();
  const crawlAddress = new Set<string>();
  let unreadable = false;
  for (const stored of proofs) {
    const read = checkedTargetsOfProof(stored.proof, PAGE_RULES);
    if (read.problem !== null) {
      // Fail closed for the whole scan: a module whose proof is gone is a set of
      // pages nobody can account for, and a census missing them would report
      // them as removed.
      onProblem?.({ scanId, module: stored.module, problem: read.problem });
      unreadable = true;
      continue;
    }
    for (const target of read.targets) {
      crawlAddress.add(target);
    }
    const documents = checkedTargetsOfProof(stored.proof, CANONICAL_RULES);
    for (const target of documents.targets) {
      canonical.add(target);
    }
  }
  if (unreadable) {
    return { canonical: new Set(), crawlAddress: new Set(), problem: 'page-evidence-unreadable' };
  }
  if (crawlAddress.size === 0) {
    return { canonical, crawlAddress, problem: 'page-evidence-empty' };
  }
  return { canonical, crawlAddress, problem: null };
}

export interface PageSets {
  readonly identity: PageIdentityKind;
  readonly current: ReadonlySet<string>;
  readonly previous: ReadonlySet<string>;
}

/**
 * The two sets to diff, and the identity they are named under.
 *
 * Document addresses are used only when BOTH scans established them: comparing a
 * document census with an address census would collapse aliases on one side
 * only, and every alias of the other side would read as a page that appeared.
 */
export function pageSetsFor(current: PageCensus, previous: PageCensus): PageSets {
  if (current.canonical.size > 0 && previous.canonical.size > 0) {
    return {
      identity: 'canonical-document',
      current: current.canonical,
      previous: previous.canonical,
    };
  }
  return {
    identity: 'crawl-address',
    current: current.crawlAddress,
    previous: previous.crawlAddress,
  };
}

export interface PageDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly kept: number;
}

/**
 * Set difference over two address sets, in sorted order.
 *
 * Sets both ways, so the cost is one pass over each census rather than a lookup
 * per pair — a 50 000-page crawl compared by `Array.includes` would be 2.5
 * billion string comparisons.
 */
export function diffPages(sets: PageSets): PageDiff {
  const added: string[] = [];
  const removed: string[] = [];
  let kept = 0;
  for (const url of sets.current) {
    if (sets.previous.has(url)) {
      kept += 1;
    } else {
      added.push(url);
    }
  }
  for (const url of sets.previous) {
    if (!sets.current.has(url)) {
      removed.push(url);
    }
  }
  return { added: added.toSorted(), removed: removed.toSorted(), kept };
}
