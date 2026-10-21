// GEO-VIS-009 — "AI answers differ from your site" — as one Action Plan rule.
//
// Every other rule reaches the plan through its open Issue rows. GEO findings
// cannot: they are informational (D-109), the Issue record requires a severity
// (§16), and `issueRowsForModule` drops them before they are written. So the
// plan reads this one rule from where the scan stored it — the fact digest in
// the GEO module's metadata — and sends exactly what the Action Plan notice
// lists for any rule: id, title, section, count, up to three page addresses
// and the rule's own recommendations as the report shows them. Never the
// statements, never the quotes: those are answer and page text, and the notice
// promises no excerpts.

import { GEO_FACT_ADVICE } from '@fluxradar/ai';
import type { ActionPlanRuleInput, GeoFactAdviceLanguage } from '@fluxradar/ai';
import { RULE_TITLES } from '@fluxradar/rules';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { MAX_SAMPLE_URLS, pathOnly, takeDistinct } from './plan-sample.ts';

export const GEO_FACT_RULE_ID = 'GEO-VIS-009';
const GEO_MODULE = 'AI SEO / GEO';

/** GEO rules carry no severity (D-109); the plan row says so in the field it has for it. */
const INFORMATIONAL_SEVERITY = 'Informational';

/** Only the parts of the stored digest this row may use: one entry per source, and its address. */
const storedFactsSchema = z.object({
  providerVisibility: z.object({
    answerDigest: z.object({
      facts: z.object({
        groups: z.array(
          z.object({
            source: z.object({
              key: z.string().min(1),
              kind: z.enum(['page', 'profile']).optional(),
              url: z.string().nullable(),
            }),
          }),
        ),
      }),
    }),
  }),
});

type StoredGroup = z.infer<
  typeof storedFactsSchema
>['providerVisibility']['answerDigest']['facts']['groups'][number];

function storedGroups(metadataJson: string | null | undefined): readonly StoredGroup[] {
  if (metadataJson === null || metadataJson === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadataJson) as unknown;
  } catch {
    // A row that is not JSON has no digest; the plan is built without this rule.
    return [];
  }
  const result = storedFactsSchema.safeParse(parsed);
  return result.success ? result.data.providerVisibility.answerDigest.facts.groups : [];
}

/**
 * The advice the report shows for each kind of source among the findings, in
 * the plan's language — the way an issue row's recommendation is localized
 * (Ukrainian when the plan is Ukrainian, the English text otherwise).
 */
function adviceFor(groups: readonly StoredGroup[], language: string): readonly string[] {
  const adviceLanguage: GeoFactAdviceLanguage = language === 'uk' ? 'uk' : 'en';
  const kinds = new Set(
    groups.map((group) => group.source.kind ?? (group.source.url === null ? 'profile' : 'page')),
  );
  return (['page', 'profile'] as const)
    .filter((kind) => kinds.has(kind))
    .map((kind) => GEO_FACT_ADVICE[kind][adviceLanguage]);
}

/**
 * The GEO-VIS-009 row for a stored GEO module, or null when the scan found no
 * difference — or ran before the digest existed, which reads the same: there
 * is nothing to plan from.
 *
 * The count is the number of findings: one per page or profile field.
 */
export function geoFactRuleFromMetadata(
  metadataJson: string | null | undefined,
  language: string,
): ActionPlanRuleInput | null {
  const groups = storedGroups(metadataJson);
  if (groups.length === 0) return null;
  const urls = groups.flatMap((group) => {
    const url = group.source.url === null ? null : pathOnly(group.source.url);
    return url === null ? [] : [url];
  });
  return {
    ruleId: GEO_FACT_RULE_ID,
    title: RULE_TITLES[GEO_FACT_RULE_ID]?.en ?? GEO_FACT_RULE_ID,
    module: GEO_MODULE,
    severity: INFORMATIONAL_SEVERITY,
    openIssues: groups.length,
    sampleUrls: takeDistinct(urls, MAX_SAMPLE_URLS),
    recommendations: adviceFor(groups, language),
  };
}

async function geoMetadata(prisma: PrismaClient, scanId: string): Promise<string | null> {
  const row = await prisma.scanModule.findFirst({
    where: { scanId, module: GEO_MODULE },
    select: { metadataJson: true },
  });
  return row?.metadataJson ?? null;
}

export async function readGeoFactRule(
  prisma: PrismaClient,
  scanId: string,
  language: string,
): Promise<ActionPlanRuleInput | null> {
  return geoFactRuleFromMetadata(await geoMetadata(prisma, scanId), language);
}

/**
 * How many GEO-VIS-009 findings the scan stored — what an Action naming the
 * rule still has open. They cannot be triaged like issues, so they stay open
 * until a later scan stops finding them.
 */
export async function readGeoFactCount(prisma: PrismaClient, scanId: string): Promise<number> {
  return storedGroups(await geoMetadata(prisma, scanId)).length;
}
