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
// WHICH NAME THE PAGES COME UNDER, AND WHY THE TWO NAMES NEVER MIX. The rules
// that declare `judgedAddress` name a page by where the site's redirects say the
// document lives, one entry per document (CANONICAL_PAGE_RULE_IDS); every other
// page rule names the snapshot's own address, so two addresses of one document
// are two entries. Those are two different censuses of the same crawl, and a set
// that pools them is neither: a redirect-aliased document would appear once
// under its document address AND once per snapshot address, so a scan that ran
// one more canonical rule than the other would report pages that "appeared"
// although nothing changed. That is not hypothetical — six page rules shipped in
// one week, four of them canonical. So each census is built from its own rules,
// and the two are only ever compared like with like:
//
//   • both scans established document identity → compare documents;
//   • neither did (a one-page crawl leaves the duplicate-value rules nothing to
//     compare) → compare snapshot addresses, and say so;
//   • one did and the other did not → refuse (`page-identity-mismatch`), because
//     collapsing aliases on one side only turns every alias of the other side
//     into a page that came or went.
//
// The census itself is read out of the stored proofs in coverage-evidence.ts,
// together with the rules that ran: both answers come from one pass over the
// same table. What lives here is what the two censuses MEAN and how they may be
// compared.
//
// WHAT IS NOT KNOWN, AND IS SAID. The proof is kept for the last two completed
// scans of a plan (`pruneCoverageProofs`), which is exactly the pair a fresh
// report compares — and nothing older. An earlier report therefore compares its
// findings and reports `page-evidence-missing` for its pages. A proof that is
// present but unreadable, or that names no page at all, gets its own reason. None
// of them is ever rendered as "0 pages added, 0 removed".

import type { PageComparisonReason, PageIdentityKind } from '@fluxradar/contracts';

/** One scan's page census: the addresses it judged, under each of the two names. */
export interface PageCensus {
  /** One entry per document, from the rules that resolve redirects. */
  readonly canonical: ReadonlySet<string>;
  /** One entry per address a snapshot was read under. */
  readonly crawlAddress: ReadonlySet<string>;
  /** Why the census is unusable; null when at least one page was named. */
  readonly problem: PageComparisonReason | null;
}

export const NO_PAGE_CENSUS: PageCensus = {
  canonical: new Set(),
  crawlAddress: new Set(),
  problem: 'page-evidence-missing',
};

export interface PageSets {
  readonly identity: PageIdentityKind;
  readonly current: ReadonlySet<string>;
  readonly previous: ReadonlySet<string>;
}

/** The two sets to diff — or the reason they must not be diffed at all. */
export type PageSetsRead =
  | { readonly sets: PageSets; readonly problem: null }
  | {
      readonly sets: null;
      readonly problem: PageComparisonReason;
    };

/**
 * The two sets to diff, and the identity they are named under.
 *
 * Document addresses are used only when BOTH scans established them, and
 * snapshot addresses only when NEITHER did. The mixed case is refused rather
 * than answered under the weaker name: the side that ran the canonical rules
 * carries one extra entry per redirect-aliased document, which is a difference
 * in what was checked and not a page the owner added.
 */
export function pageSetsFor(current: PageCensus, previous: PageCensus): PageSetsRead {
  const currentHasDocuments = current.canonical.size > 0;
  const previousHasDocuments = previous.canonical.size > 0;
  if (currentHasDocuments !== previousHasDocuments) {
    return { sets: null, problem: 'page-identity-mismatch' };
  }
  if (currentHasDocuments && previousHasDocuments) {
    return {
      sets: {
        identity: 'canonical-document',
        current: current.canonical,
        previous: previous.canonical,
      },
      problem: null,
    };
  }
  return {
    sets: {
      identity: 'crawl-address',
      current: current.crawlAddress,
      previous: previous.crawlAddress,
    },
    problem: null,
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
