// The order a scan's modules are returned in (API DTOs, the dashboard, exports).
//
// Postgres hands back a scan's module rows in physical order, which changes as
// rows are updated (the Pending/Running upserts rewrite them), so any list built
// straight from the rows had no stable order. That stayed hidden while most
// lists were read by name; a Free scan's two rows — SEO and its GEO preview —
// made it visible ("AI SEO / GEO" listed before "SEO"). Every module list leaves
// the API in the canonical registry order instead: `MODULE_NAMES` in
// packages/contracts (SEO, AI SEO / GEO, Security, …), the order the comparison
// already uses. A name outside the registry goes last, by name.

import { MODULE_NAMES } from '@fluxradar/contracts';

const RANK: ReadonlyMap<string, number> = new Map(MODULE_NAMES.map((name, index) => [name, index]));

function rankOf(name: string): number {
  return RANK.get(name) ?? MODULE_NAMES.length;
}

/** A new list in canonical module order; equal names keep their input order. */
export function sortModules<T extends { readonly module: string }>(
  modules: readonly T[],
): readonly T[] {
  return [...modules].sort((left, right) => {
    const byRank = rankOf(left.module) - rankOf(right.module);
    if (byRank !== 0) return byRank;
    if (left.module === right.module) return 0;
    return left.module < right.module ? -1 : 1;
  });
}
