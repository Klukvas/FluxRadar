// What the Action Plan is allowed to send, proved against a real scan snapshot.
//
// The prompt is an allowlist, not a redaction: the builder picks the fields that
// may leave, so a new column on Issue cannot quietly join them. These tests read
// the prompt the provider would receive and assert on what is in it — and, more
// importantly, on what is not.

import { buildActionPlanRequest, buildPrompt } from '@fluxradar/ai';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createTestDb,
  seedAccountWithProfile,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';
import { buildActionPlanScanInput, incompleteModulesFor } from './input-builder.ts';

interface IssueSeed {
  readonly ruleId: string;
  readonly module: string;
  readonly severity: string;
  readonly severityRank: number;
  readonly status?: string;
  readonly targetUrl: string;
  readonly recommendation: string;
  readonly evidenceExcerpt?: string;
  readonly messagesJson?: string;
}

async function seedScanWithIssues(
  prisma: PrismaClient,
  account: SeededAccount,
  issues: readonly IssueSeed[],
): Promise<string> {
  const scan = await prisma.scan.create({
    data: {
      accountId: account.accountId,
      siteProfileId: account.siteProfileId,
      plan: 'Complete',
      domain: account.domain,
      status: 'Completed',
      scopeJson: '{}',
      rulesetVersion: 'rules-mvp-0.1',
      completedAt: new Date(),
    },
  });
  await prisma.scanModule.createMany({
    data: [
      {
        scanId: scan.id,
        module: 'SEO',
        runtimeStatus: 'Completed',
        coverage: 1,
        score: 72,
        usableOutput: true,
      },
      {
        scanId: scan.id,
        module: 'Performance',
        runtimeStatus: 'Partial',
        coverage: 0.5,
        usableOutput: false,
      },
      {
        scanId: scan.id,
        module: 'Analytics',
        runtimeStatus: 'Completed',
        coverage: 1,
        usableOutput: true,
      },
    ],
  });
  await prisma.issue.createMany({
    data: issues.map((issue, index) => ({
      scanId: scan.id,
      ruleId: issue.ruleId,
      module: issue.module,
      fingerprint: `fp-${scan.id}-${index}`,
      severity: issue.severity,
      severityRank: issue.severityRank,
      category: 'seo',
      status: issue.status ?? 'New',
      targetKind: 'page',
      normalizedUrl: issue.targetUrl,
      normalizedResource: '',
      normalizedSelector: '',
      normalizedParameter: '',
      ruleVariant: 'v1',
      targetUrl: issue.targetUrl,
      evidenceType: 'html',
      evidenceExcerpt: issue.evidenceExcerpt ?? null,
      messagesJson: issue.messagesJson ?? null,
      recommendation: issue.recommendation,
      confidence: 1,
      applicableTargets: 1,
      affectedTargets: 1,
      rulePenalty: 5,
      scoreDelta: -5,
      observedAt: new Date(),
    })),
  });
  return scan.id;
}

describe('the Action Plan input', () => {
  let db: TestDb;
  let account: SeededAccount;

  beforeEach(async () => {
    db = await createTestDb();
    account = await seedAccountWithProfile(db.prisma);
  });

  afterEach(async () => {
    await db.cleanup();
  });

  async function promptFor(scanId: string, language = 'en'): Promise<string> {
    const input = await buildActionPlanScanInput(db.prisma, scanId, language);
    return buildPrompt(
      buildActionPlanRequest({
        scanId,
        domain: account.domain,
        language,
        modules: input.modules,
        rules: input.rules,
        consent: null,
      }),
    ).promptText;
  }

  it('sends rule metadata and no evidence excerpt', async () => {
    const scanId = await seedScanWithIssues(db.prisma, account, [
      {
        ruleId: 'SEO-TECH-001',
        module: 'SEO',
        severity: 'High',
        severityRank: 1,
        targetUrl: 'https://example.com/',
        recommendation: 'Publish a robots.txt at the site root.',
        evidenceExcerpt: 'SECRET-EVIDENCE-STRING-DO-NOT-SEND',
      },
    ]);

    const prompt = await promptFor(scanId);

    expect(prompt).toContain('SEO-TECH-001');
    expect(prompt).toContain('robots.txt is missing or unreachable');
    expect(prompt).toContain('severity=High');
    expect(prompt).toContain('openIssues=1');
    expect(prompt).toContain('Publish a robots.txt at the site root.');
    expect(prompt).not.toContain('SECRET-EVIDENCE-STRING-DO-NOT-SEND');
  });

  it('never sends an Analytics rule, because those findings are Google data', async () => {
    const scanId = await seedScanWithIssues(db.prisma, account, [
      {
        ruleId: 'SEO-TECH-001',
        module: 'SEO',
        severity: 'High',
        severityRank: 1,
        targetUrl: 'https://example.com/',
        recommendation: 'Publish a robots.txt.',
      },
      {
        ruleId: 'ANALYTICS-SC-001',
        module: 'Analytics',
        severity: 'High',
        severityRank: 1,
        targetUrl: 'https://example.com/',
        recommendation: 'Investigate the organic traffic drop.',
      },
    ]);

    const input = await buildActionPlanScanInput(db.prisma, scanId, 'en');
    const prompt = await promptFor(scanId);

    expect(input.rules.map((rule) => rule.ruleId)).toEqual(['SEO-TECH-001']);
    expect(input.modules.map((module) => module.module)).not.toContain('Analytics');
    expect(prompt).not.toContain('ANALYTICS-SC-001');
    expect(prompt).not.toContain('organic traffic drop');
  });

  it('strips query and fragment from sample URLs and keeps at most three', async () => {
    const scanId = await seedScanWithIssues(
      db.prisma,
      account,
      Array.from({ length: 5 }, (_value, index) => ({
        ruleId: 'SEO-ONPAGE-001',
        module: 'SEO',
        severity: 'Medium',
        severityRank: 2,
        targetUrl: `https://example.com/page-${index}?session=SECRET#anchor`,
        recommendation: 'Give every page a title of the right length.',
      })),
    );

    const input = await buildActionPlanScanInput(db.prisma, scanId, 'en');

    expect(input.rules[0]?.sampleUrls).toHaveLength(3);
    expect(input.rules[0]?.sampleUrls.join(' ')).not.toContain('SECRET');
    expect(input.rules[0]?.sampleUrls.join(' ')).not.toContain('#anchor');
    expect(input.rules[0]?.openIssues).toBe(5);
  });

  it('merges one rule’s severities and keeps the highest open one', async () => {
    const scanId = await seedScanWithIssues(db.prisma, account, [
      {
        ruleId: 'UX-CONV-AI-001',
        module: 'UX/Conversion',
        severity: 'Low',
        severityRank: 3,
        targetUrl: 'https://example.com/a',
        recommendation: 'Say what the site offers above the fold.',
      },
      {
        ruleId: 'UX-CONV-AI-001',
        module: 'UX/Conversion',
        severity: 'High',
        severityRank: 1,
        targetUrl: 'https://example.com/b',
        recommendation: 'Say what the site offers above the fold.',
      },
    ]);

    const input = await buildActionPlanScanInput(db.prisma, scanId, 'en');

    expect(input.rules).toHaveLength(1);
    expect(input.rules[0]).toMatchObject({ severity: 'High', openIssues: 2 });
    // One rule, one set of distinct recommendations — not one per issue.
    expect(input.rules[0]?.recommendations).toHaveLength(1);
  });

  it('counts only open issues and names the modules that did not complete', async () => {
    const scanId = await seedScanWithIssues(db.prisma, account, [
      {
        ruleId: 'SEO-TECH-001',
        module: 'SEO',
        severity: 'High',
        severityRank: 1,
        status: 'Resolved',
        targetUrl: 'https://example.com/',
        recommendation: 'Publish a robots.txt.',
      },
      {
        ruleId: 'SEO-TECH-002',
        module: 'SEO',
        severity: 'Medium',
        severityRank: 2,
        targetUrl: 'https://example.com/',
        recommendation: 'Publish a sitemap.',
      },
    ]);

    const input = await buildActionPlanScanInput(db.prisma, scanId, 'en');

    expect(input.rules.map((rule) => rule.ruleId)).toEqual(['SEO-TECH-002']);
    expect(await incompleteModulesFor(db.prisma, scanId)).toEqual(['Performance']);
  });
});
