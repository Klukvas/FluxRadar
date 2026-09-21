// Fixtures for the Action Plan tests: a Complete scan bought the production
// way and then finished by hand, its issues, and a provider that never leaves
// the process (D-232).

import { randomUUID } from 'node:crypto';

import {
  MockAiProvider,
  type AiProvider,
  type AiProviderConfig,
  type OpenAiShapedResponse,
} from '@fluxradar/ai';
import { ACTION_PLAN_NOTICE_VERSION, severityRank } from '@fluxradar/contracts';
import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import request from 'supertest';
import { expect, vi } from 'vitest';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { purchaseScan } from './purchase-scan.ts';

export const PLAN_NOW = new Date('2026-09-21T12:00:00.000Z');
/** When the fixture scan finished: an hour before PLAN_NOW, well inside the window. */
export const FINISHED_AT = new Date(PLAN_NOW.getTime() - 60 * 60 * 1000);

export const ANTHROPIC_MOCK_CONFIG: AiProviderConfig = {
  provider: 'anthropic',
  apiVersion: '2023-06-01',
  modelId: 'claude-opus-5',
  timeoutMs: 1000,
  maxRetries: 1,
};

export interface PlanActionFixture {
  readonly ruleIds: readonly string[];
  readonly title?: string;
}

/** An answer in the plan contract naming the given rules, one Action per entry. */
export function planAnswer(
  actions: readonly PlanActionFixture[],
  model = 'claude-opus-5',
): OpenAiShapedResponse {
  return {
    id: `msg_${randomUUID()}`,
    model,
    status: 'completed',
    output_text: JSON.stringify({
      overview: 'The site works, but a few changes would make it clearer and safer.',
      actions: actions.map((action, index) => ({
        ruleIds: action.ruleIds,
        title: action.title ?? `Change number ${index + 1}`,
        why: 'It clears the issues these rules found.',
        steps: ['Make the change in the site template.'],
        effort: 'small',
      })),
    }),
    usage: { input_tokens: 2_400, output_tokens: 6_100 },
  };
}

/** A provider answering every Action Plan request with `answer`. */
export function planProvider(answer: OpenAiShapedResponse): MockAiProvider {
  return new MockAiProvider([{ questionIncludes: 'Action Plan', response: answer }], {
    config: ANTHROPIC_MOCK_CONFIG,
  });
}

export interface GatedProvider {
  readonly provider: AiProvider;
  readonly calls: () => number;
  readonly prompts: () => readonly string[];
  /** Lets every waiting and later request through. */
  readonly release: () => void;
}

/** Holds each request until `release`, so a run stays in flight as long as a test needs. */
export function gatedProvider(inner: AiProvider): GatedProvider {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const prompts: string[] = [];
  return {
    provider: {
      config: inner.config,
      send: async (aiRequest, promptText) => {
        prompts.push(promptText);
        await gate;
        return inner.send(aiRequest, promptText);
      },
    },
    calls: () => prompts.length,
    prompts: () => [...prompts],
    release: () => open(),
  };
}

export interface PlanAppOptions {
  readonly provider: AiProvider | null;
  readonly now?: () => Date;
}

export function planApp(prisma: PrismaClient, options: PlanAppOptions): Express {
  return createApp({
    prisma,
    autoProcess: false,
    logger: silentLogger,
    now: options.now ?? (() => PLAN_NOW),
    createActionPlanProvider: () => options.provider,
  });
}

export interface Owner {
  readonly agent: ReturnType<typeof request.agent>;
  readonly cookie: string;
  readonly profileId: string;
}

export async function signUp(app: Express, email: string): Promise<Owner> {
  const agent = request.agent(app);
  const registration = await agent
    .post('/auth/register')
    .send({ email, password: 'correct-horse-1' });
  expect(registration.status).toBe(201);
  const cookie = registration.headers['set-cookie']?.[0]?.split(';', 1)[0];
  if (cookie === undefined) throw new Error('registration did not set a session cookie');
  const profile = await agent
    .post('/profiles')
    .set('Cookie', cookie)
    .send({ name: 'Plan Site', domain: `https://${email.split('@')[0]}.example.com` });
  expect(profile.status).toBe(201);
  return { agent, cookie, profileId: profile.body.data.id as string };
}

export interface SeedIssue {
  readonly ruleId: string;
  readonly module?: string;
  readonly severity?: string;
  readonly status?: string;
  readonly targetUrl?: string;
  readonly evidenceExcerpt?: string;
  readonly recommendation?: string;
  readonly messagesJson?: string | null;
}

export async function seedIssues(
  prisma: PrismaClient,
  scanId: string,
  issues: readonly SeedIssue[],
): Promise<void> {
  const scan = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
  await prisma.issue.createMany({
    data: issues.map((issue, index) => {
      const severity = issue.severity ?? 'Medium';
      const targetUrl = issue.targetUrl ?? `${scan.domain}/page-${index}`;
      return {
        scanId,
        ruleId: issue.ruleId,
        module: issue.module ?? 'SEO',
        fingerprint: `fp-${index}-${randomUUID()}`,
        severity,
        severityRank: severityRank(severity),
        category: 'on-page',
        status: issue.status ?? 'New',
        targetKind: 'page',
        normalizedUrl: targetUrl,
        normalizedResource: '',
        normalizedSelector: '',
        normalizedParameter: '',
        ruleVariant: 'v1',
        targetUrl,
        evidenceType: 'dom',
        evidenceExcerpt: issue.evidenceExcerpt ?? null,
        recommendation: issue.recommendation ?? `Fix ${issue.ruleId}.`,
        messagesJson: issue.messagesJson ?? null,
        confidence: 1,
        applicableTargets: 1,
        affectedTargets: 1,
        rulePenalty: 0,
        scoreDelta: 0,
        observedAt: FINISHED_AT,
      };
    }),
  });
}

export interface SeedModule {
  readonly module: string;
  readonly runtimeStatus: string;
  readonly score?: number | null;
  readonly coverage?: number | null;
}

export const DEFAULT_MODULES: readonly SeedModule[] = [
  { module: 'SEO', runtimeStatus: 'Completed', score: 72, coverage: 1 },
  { module: 'Security', runtimeStatus: 'Completed', score: 64, coverage: 1 },
  { module: 'Performance', runtimeStatus: 'Partial', score: null, coverage: 0.5 },
  { module: 'AI SEO / GEO', runtimeStatus: 'Unavailable', score: null, coverage: 0 },
  { module: 'Analytics', runtimeStatus: 'Completed', score: 80, coverage: 1 },
];

export interface FinishOptions {
  readonly status?: string;
  readonly completedAt?: Date | null;
  readonly jobStatus?: string;
  readonly modules?: readonly SeedModule[];
}

/** Moves a bought scan to where the worker leaves it, without crawling anything. */
export async function finishScan(
  prisma: PrismaClient,
  scanId: string,
  options: FinishOptions = {},
): Promise<void> {
  await prisma.scanModule.createMany({
    data: (options.modules ?? DEFAULT_MODULES).map((module) => ({
      scanId,
      module: module.module,
      runtimeStatus: module.runtimeStatus,
      score: module.score ?? null,
      coverage: module.coverage ?? null,
      usableOutput: module.runtimeStatus === 'Completed',
    })),
  });
  await prisma.scan.update({
    where: { id: scanId },
    data: {
      status: options.status ?? 'Completed',
      startedAt: new Date(FINISHED_AT.getTime() - 10 * 60 * 1000),
      completedAt: options.completedAt === undefined ? FINISHED_AT : options.completedAt,
    },
  });
  await prisma.job.update({
    where: { scanId },
    data: { status: options.jobStatus ?? 'Done', claimedAt: null, leaseUntil: null },
  });
}

/** Issues most tests plan from: two SEO rules, one Security rule and Analytics. */
export const DEFAULT_ISSUES: readonly SeedIssue[] = [
  { ruleId: 'SEO-TECH-004', severity: 'Medium' },
  { ruleId: 'SEO-TECH-004', severity: 'High' },
  { ruleId: 'SEO-ONPAGE-002', severity: 'Low' },
  { ruleId: 'SEC-PASSIVE-003', module: 'Security', severity: 'High' },
  { ruleId: 'ANALYTICS-SC-002', module: 'Analytics', severity: 'Medium' },
];

export interface PlannableScan {
  readonly owner: Owner;
  readonly scanId: string;
  readonly purchaseId: string;
}

/** A finished Complete scan with open issues, owned by a new account. */
export async function plannableScan(
  prisma: PrismaClient,
  app: Express,
  email: string,
  options: FinishOptions & {
    readonly plan?: 'Basic' | 'Complete';
    readonly issues?: readonly SeedIssue[];
  } = {},
): Promise<PlannableScan> {
  const owner = await signUp(app, email);
  const { scanId, purchaseId } = await purchaseScan(prisma, {
    siteProfileId: owner.profileId,
    plan: options.plan ?? 'Complete',
    scope: { maxPages: 15 },
  });
  await seedIssues(prisma, scanId, options.issues ?? DEFAULT_ISSUES);
  await finishScan(prisma, scanId, options);
  return { owner, scanId, purchaseId };
}

export function postPlan(
  owner: Owner,
  scanId: string,
  language: string,
  body: Readonly<Record<string, unknown>> = {},
) {
  return owner.agent
    .post(`/scans/${scanId}/action-plan`)
    .set('Cookie', owner.cookie)
    .send({ language, noticeVersion: ACTION_PLAN_NOTICE_VERSION, ...body });
}

export function getPlan(owner: Owner, scanId: string, language: string) {
  return owner.agent
    .get(`/scans/${scanId}/action-plan`)
    .query({ language })
    .set('Cookie', owner.cookie);
}

/** Waits until the scan has no generation in flight. */
export async function settledRun(prisma: PrismaClient, scanId: string): Promise<void> {
  await vi.waitFor(
    async () => {
      const scan = await prisma.scan.findUniqueOrThrow({
        where: { id: scanId },
        select: { actionPlanRunStartedAt: true },
      });
      expect(scan.actionPlanRunStartedAt).toBeNull();
    },
    { timeout: 5_000, interval: 20 },
  );
}
