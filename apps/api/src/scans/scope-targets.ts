// The addresses a scan's scope may point at.
//
// Two settings name URLs directly — the seed list and the API checks — and both
// are a way to say "also look here". "Here" has to be the site the scan is of:
// a scan aimed at someone else's server is not an audit, it is a request
// generator with a customer's name on it. The crawler and the API-check runner
// both refuse an out-of-scope address at execution time as well, so a scope
// stored before this existed cannot smuggle one through; this is the earlier,
// friendlier refusal — before a checkout opens on a scan that would not do what
// was asked.

import type { ScanScopeInput } from '@fluxradar/contracts';

export interface ScopeTargetProblem {
  readonly field: 'seedUrls' | 'apiChecks';
  readonly url: string;
  readonly reason: string;
}

/** Whether one URL belongs to the site a scan is of. */
export function isWithinSite(url: string, siteOrigin: string, includeSubdomains: boolean): boolean {
  let target: URL;
  let site: URL;
  try {
    target = new URL(url);
    site = new URL(siteOrigin);
  } catch {
    return false;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  if (target.hostname === site.hostname) return true;
  return includeSubdomains && target.hostname.endsWith(`.${site.hostname}`);
}

/** Every address in the scope that does not belong to the site, with its reason. */
export function scopeTargetProblems(
  scope: ScanScopeInput,
  siteOrigin: string,
): readonly ScopeTargetProblem[] {
  const outside = (url: string, field: ScopeTargetProblem['field']): ScopeTargetProblem[] =>
    isWithinSite(url, siteOrigin, scope.includeSubdomains)
      ? []
      : [
          {
            field,
            url,
            reason: scope.includeSubdomains
              ? 'address is not on the scanned site or one of its subdomains'
              : 'address is not on the scanned site',
          },
        ];
  return [
    ...(scope.seedUrls ?? []).flatMap((url) => outside(url, 'seedUrls')),
    ...(scope.apiChecks ?? []).flatMap((check) => outside(check.url, 'apiChecks')),
  ];
}

/** A single sentence naming what is wrong, for a 400 the owner can act on. */
export function scopeTargetMessage(problems: readonly ScopeTargetProblem[]): string {
  const listed = problems
    .slice(0, 5)
    .map((problem) => `${problem.field}: ${problem.url} — ${problem.reason}`)
    .join('; ');
  return problems.length > 5 ? `${listed}; and ${problems.length - 5} more` : listed;
}
