// A few of each problem's own findings, carried with the rule summary.
//
// "Fix these first" and the Issue Center's problem rows read the summary, and a
// row that only said "Page title is missing, too short or too long — on 1 page"
// left the owner to open it to learn which page and what the title actually
// was. The first findings of each rule ride along, with the message codes and
// values the rule recorded, so the row can say "Title now: “Home”, 4 characters"
// without a request per row.
//
// One windowed query for the whole scan, not one per rule: a Complete report has
// dozens of rules, and the summary is on the report's first screen.

import { Prisma, type PrismaClient } from '@prisma/client';
import { FINDING_LANGUAGES, type FindingLanguage } from '@fluxradar/rules';

import {
  localizedFindingTexts,
  storedFindingMessages,
  type StoredFindingMessages,
} from './localized-text.ts';

/** How many findings of one rule a row can name before it says "and N more". */
export const SAMPLE_LIMIT = 3;

/**
 * The longest value a sample carries. Values are page text (a title, an
 * outline) and the row shows a short excerpt of them; a 5 000-character title
 * would otherwise ride along in full, once per sample, on every summary read.
 */
export const SAMPLE_VALUE_MAX_CHARS = 300;

export interface IssueSample {
  readonly targetUrl: string;
  /** The codes and values the rule recorded; null for findings without codes (AI-written text). */
  readonly messages: StoredFindingMessages | null;
  /** The recorded evidence in each report language; null where `messages` is. */
  readonly evidence: Readonly<Record<FindingLanguage, string | null>> | null;
}

interface SampleRow {
  readonly ruleId: string;
  readonly module: string;
  readonly targetUrl: string;
  readonly messagesJson: string | null;
}

export function sampleKey(ruleId: string, module: string): string {
  return `${ruleId}\u0000${module}`;
}

function capValue(value: string | number): string | number {
  if (typeof value === 'number') return value;
  const codePoints = [...value];
  return codePoints.length <= SAMPLE_VALUE_MAX_CHARS
    ? value
    : codePoints.slice(0, SAMPLE_VALUE_MAX_CHARS).join('');
}

function capMessages(messages: StoredFindingMessages): StoredFindingMessages {
  const cap = (ref: StoredFindingMessages['evidence']) => ({
    code: ref.code,
    params: Object.fromEntries(
      Object.entries(ref.params).map(([name, value]) => [name, capValue(value)]),
    ),
  });
  return { evidence: cap(messages.evidence), recommendation: cap(messages.recommendation) };
}

function toSample(row: SampleRow): IssueSample {
  const messages = storedFindingMessages(row.messagesJson);
  const texts = localizedFindingTexts(row.messagesJson);
  return {
    targetUrl: row.targetUrl,
    messages: messages === null ? null : capMessages(messages),
    evidence:
      texts === null
        ? null
        : (Object.fromEntries(
            FINDING_LANGUAGES.map((language) => [language, texts[language].evidenceExcerpt]),
          ) as Record<FindingLanguage, string | null>),
  };
}

/**
 * The first open findings of every rule in a scan, keyed by `sampleKey`.
 *
 * Most severe first, then by address, so a rule's homepage finding leads; the
 * fingerprint breaks the remaining ties so the same report always names the
 * same pages.
 */
export async function openIssueSamples(
  prisma: PrismaClient,
  scanId: string,
  openStatuses: readonly string[],
): Promise<ReadonlyMap<string, readonly IssueSample[]>> {
  const rows = await prisma.$queryRaw<SampleRow[]>`
    SELECT "ruleId", "module", "targetUrl", "messagesJson"
    FROM (
      SELECT "ruleId", "module", "targetUrl", "messagesJson", "fingerprint",
        ROW_NUMBER() OVER (
          PARTITION BY "ruleId", "module"
          ORDER BY "severityRank" ASC, "targetUrl" ASC, "fingerprint" ASC
        ) AS "position"
      FROM "Issue"
      WHERE "scanId" = ${scanId} AND "status" IN (${Prisma.join([...openStatuses])})
    ) AS ranked
    WHERE "position" <= ${SAMPLE_LIMIT}
    ORDER BY "ruleId", "module", "position"`;
  const samples = new Map<string, IssueSample[]>();
  for (const row of rows) {
    const key = sampleKey(row.ruleId, row.module);
    samples.set(key, [...(samples.get(key) ?? []), toSample(row)]);
  }
  return samples;
}
