// Which rules of a run can be asked "what pages did you read".
//
// A finished scan keeps no list of its crawled pages: the stored snapshots are
// evidence for a resume and are deleted the moment the run reaches a terminal
// status (apps/api/src/orchestrator/crawl-store.ts). What survives is the
// re-check proof — for every rule, the targets it judged
// (apps/api/src/orchestrator/run-coverage.ts) — and the targets of a PAGE rule
// are pages, named exactly as its findings name them.
//
// So a page census is the union of what the page rules of a run judged, and the
// only question is which name the pages come under:
//
//   • a rule that declares `judgedAddress` names the page by the address the
//     site's own redirects say the document lives at (`canonicalAddress`), one
//     entry per document. `/p` and `/p/` are one page there, which is what keeps
//     a change in the linked form from reading as one page removed and another
//     added;
//   • every other page rule names the snapshot's own `normalizedUrl`, so two
//     addresses of one document are two entries.
//
// Both lists are derived from the registry rather than written out: a rule that
// gains or loses `judgedAddress` moves between them by itself, and
// `page-census.test.ts` pins the derivation against the implementations.

import type { ModuleName } from '@fluxradar/contracts';

import type { Rule } from './engine/types.js';
import { implementedModules, rulesForModule } from './registry.js';

function pageRules(): readonly Extract<Rule, { kind: 'page' }>[] {
  return implementedModules().flatMap((module: ModuleName) =>
    rulesForModule(module).filter(
      (rule): rule is Extract<Rule, { kind: 'page' }> => rule.kind === 'page',
    ),
  );
}

function ruleIdsOf(rules: readonly Extract<Rule, { kind: 'page' }>[]): readonly string[] {
  return [...new Set(rules.map((rule) => rule.descriptor.ruleId))].toSorted();
}

/**
 * Every implemented rule whose judged targets are pages.
 *
 * The widest census available from a stored proof, and the weaker of the two:
 * it counts addresses the crawl read, so one document reached under two
 * addresses appears twice.
 */
export const PAGE_RULE_IDS: readonly string[] = ruleIdsOf(pageRules());

/**
 * The page rules that name their target by the document's own address.
 *
 * These are the census to prefer: one entry per document, redirect aliases
 * collapsed. They are not always present in a run — the duplicate-value rules
 * need at least two judged pages and the link-graph rules need a complete graph
 * — which is why the wider list above still exists.
 */
export const CANONICAL_PAGE_RULE_IDS: readonly string[] = ruleIdsOf(
  pageRules().filter((rule) => rule.judgedAddress !== undefined),
);
