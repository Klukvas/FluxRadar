// Issue Center API: tenant-scoped browsing, deterministic filters and the
// user-controlled status subset. Resolved/Reopened are worker-owned and cannot
// be forged by a client PATCH.

import { Router } from 'express';
import type { PrismaClient, Issue } from '@prisma/client';
import { ISSUE_STATUSES, SEVERITIES, issueStatusUpdateInputSchema } from '@fluxradar/contracts';
import { z } from 'zod';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import { forbidden, gone, notFound } from '../http/errors.ts';
import { sendOk } from '../http/envelope.ts';
import { requiredParam } from '../http/params.ts';
import { parseInput } from '../http/validate.ts';
import { findOwnScan } from '../scans/routes.ts';

export interface IssuesRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
}

const issueQuerySchema = z.object({
  module: z.string().min(1).optional(),
  severity: z.enum(SEVERITIES).optional(),
  status: z.enum(ISSUE_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function issuesRouter(deps: IssuesRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);

  router.get('/scans/:scanId/issues', auth, async (req, res) => {
    const scanId = requiredParam(req.params.scanId, 'scanId');
    await findOwnScan(deps.prisma, accountIdFrom(res), scanId);
    const query = parseInput(issueQuerySchema, req.query);
    const where = {
      scanId,
      ...(query.module !== undefined ? { module: query.module } : {}),
      ...(query.severity !== undefined ? { severity: query.severity } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.search !== undefined
        ? {
            OR: [
              { ruleId: { contains: query.search } },
              { targetUrl: { contains: query.search } },
              { evidenceExcerpt: { contains: query.search } },
              { recommendation: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [issues, total] = await Promise.all([
      deps.prisma.issue.findMany({
        where,
        orderBy: [{ severity: 'asc' }, { fingerprint: 'asc' }],
        skip: query.offset,
        take: query.limit,
      }),
      deps.prisma.issue.count({ where }),
    ]);
    sendOk(res, issues.map(toIssueDto), {
      meta: { total, page: Math.floor(query.offset / query.limit) + 1, limit: query.limit },
    });
  });

  router.get('/scans/:scanId/issues/:issueId', auth, async (req, res) => {
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const issueId = requiredParam(req.params.issueId, 'issueId');
    await findOwnScan(deps.prisma, accountIdFrom(res), scanId);
    const issue = await findOwnIssue(deps.prisma, accountIdFrom(res), scanId, issueId);
    sendOk(res, toIssueDto(issue));
  });

  router.get('/scans/:scanId/issues/:issueId/evidence', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const issueId = requiredParam(req.params.issueId, 'issueId');
    const scan = await deps.prisma.scan.findFirst({ where: { id: scanId, accountId } });
    if (scan === null) {
      const deleted = await deps.prisma.deletedScan.findUnique({ where: { scanId } });
      if (deleted !== null) {
        throw gone('EVIDENCE_EXPIRED', 'this evidence is no longer available');
      }
      throw notFound('scan not found');
    }
    const issue = await findOwnIssue(deps.prisma, accountId, scanId, issueId);
    sendOk(res, {
      issueId: issue.id,
      targetUrl: issue.targetUrl,
      evidenceType: issue.evidenceType,
      evidenceRef: issue.evidenceRef ?? `issue/${issue.id}`,
      evidenceExcerpt: issue.evidenceExcerpt,
      observedAt: issue.observedAt.toISOString(),
    });
  });

  router.patch('/scans/:scanId/issues/:issueId', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const issueId = requiredParam(req.params.issueId, 'issueId');
    await findOwnScan(deps.prisma, accountId, scanId);
    const input = parseInput(issueStatusUpdateInputSchema, req.body);
    const issue = await findOwnIssue(deps.prisma, accountId, scanId, issueId);
    if (issue.status === 'Resolved' || issue.status === 'Reopened') {
      throw forbidden('ISSUE_STATUS_OWNED_BY_WORKER', 'Resolved and Reopened are scan-derived statuses');
    }
    const updated = await deps.prisma.issue.update({
      where: { id: issue.id },
      data: { status: input.status },
    });
    sendOk(res, toIssueDto(updated));
  });

  return router;
}

async function findOwnIssue(
  prisma: PrismaClient,
  accountId: string,
  scanId: string,
  issueId: string,
): Promise<Issue> {
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, scanId, scan: { accountId } },
  });
  if (issue === null) {
    throw notFound('issue not found');
  }
  return issue;
}

function toIssueDto(issue: Issue): Record<string, unknown> {
  return {
    id: issue.id,
    scanId: issue.scanId,
    ruleId: issue.ruleId,
    module: issue.module,
    fingerprint: issue.fingerprint,
    severity: issue.severity,
    category: issue.category,
    status: issue.status,
    targetKind: issue.targetKind,
    normalizedUrl: issue.normalizedUrl,
    normalizedResource: issue.normalizedResource,
    normalizedSelector: issue.normalizedSelector,
    normalizedParameter: issue.normalizedParameter,
    ruleVariant: issue.ruleVariant,
    targetUrl: issue.targetUrl,
    evidenceType: issue.evidenceType,
    evidenceRef: issue.evidenceRef ?? `issue/${issue.id}`,
    evidenceExcerpt: issue.evidenceExcerpt,
    evidenceGroupId: issue.evidenceGroupId,
    recommendation: issue.recommendation,
    confidence: issue.confidence,
    applicableTargets: issue.applicableTargets,
    affectedTargets: issue.affectedTargets,
    rulePenalty: issue.rulePenalty,
    scoreDelta: issue.scoreDelta,
    observedAt: issue.observedAt.toISOString(),
  };
}
