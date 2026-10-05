// What a page of findings of one problem adds up to: how many pages it touches,
// and where those pages actually differ.
//
// For the header rules every row carries the same sentence, so a list of three
// hundred rows looks like three hundred things to read. Folding the loaded
// findings by their evidence says in one line whether this is one fix or
// several, without hiding a row.
//
// Derived from the findings the browser already has, not from a second count:
// the caller knows whether that is all of them (`meta.total`) and says so,
// because "9 pages" and "9 pages so far" are different statements.

import type { Issue } from './api';
import type { Language } from './i18n';

/** One distinct piece of evidence among findings of the same problem. */
export interface EvidenceVariant {
  readonly evidence: string;
  readonly findings: number;
  /**
   * The addresses that recorded it, in the order they were loaded.
   *
   * The count alone read as a property of the evidence: "Only one crawled page
   * links to this one: /en/careers — 3 findings" was read as "/en/careers has
   * 3 problems", when it means three other pages are each held by a link from
   * /en/careers. Naming those three pages is the only way the line says what
   * it means. A page with two findings of the same evidence is listed once.
   */
  readonly pages: readonly string[];
}

export interface ProblemBreakdown {
  readonly findings: number;
  /** Distinct target addresses: a page is counted once however many findings it has. */
  readonly pages: number;
  /** Most common first; empty when no loaded finding carries evidence text. */
  readonly variants: readonly EvidenceVariant[];
}

/**
 * The finding's evidence in the reader's language.
 *
 * The API renders it per language from the finding's message codes; a finding
 * stored before those codes existed, or written by AI, has the stored text only.
 */
export function findingEvidence(issue: Issue, language: Language): string | null {
  return issue.localized?.[language]?.evidenceExcerpt ?? issue.evidenceExcerpt ?? null;
}

export function problemBreakdown(issues: readonly Issue[], language: Language): ProblemBreakdown {
  const byEvidence = new Map<string, { findings: number; pages: string[] }>();
  for (const issue of issues) {
    const evidence = findingEvidence(issue, language)?.trim();
    if (evidence === undefined || evidence === '') continue;
    const entry = byEvidence.get(evidence) ?? { findings: 0, pages: [] };
    const pages = entry.pages.includes(issue.targetUrl)
      ? entry.pages
      : [...entry.pages, issue.targetUrl];
    byEvidence.set(evidence, { findings: entry.findings + 1, pages });
  }
  const variants = [...byEvidence.entries()]
    .map(([evidence, entry]): EvidenceVariant => ({ evidence, ...entry }))
    .sort(
      (left, right) =>
        right.findings - left.findings || left.evidence.localeCompare(right.evidence),
    );
  return {
    findings: issues.length,
    pages: new Set(issues.map((issue) => issue.targetUrl)).size,
    variants,
  };
}
