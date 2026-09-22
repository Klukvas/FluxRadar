import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  gatedProvider,
  planAnswer,
  planApp,
  planProvider,
  plannableScan,
  postPlan,
  settledRun,
} from '../test-utils/action-plan-fixtures.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import { formatPromptPreview, previewActionPlanPrompt } from './print-prompt.ts';

// The dry run the quality gate starts from (D-232): the prompt a generation
// would send, printed instead of sent.

const ISSUES = [
  { ruleId: 'SEO-TECH-004', evidenceExcerpt: 'SECRET-EVIDENCE-EXCERPT' },
  { ruleId: 'SEC-PASSIVE-003', module: 'Security', severity: 'High' },
  {
    ruleId: 'ANALYTICS-SC-002',
    module: 'Analytics',
    evidenceExcerpt: 'Google showed it 900 times',
  },
];

describe('the Action Plan dry run', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('prints the exact prompt a generation sends, with no evidence and no Analytics', async () => {
    const gated = gatedProvider(planProvider(planAnswer([{ ruleIds: ['SEO-TECH-004'] }])));
    const app = planApp(db.prisma, { provider: gated.provider });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'dry-run@example.com', {
      issues: ISSUES,
    });

    const preview = await previewActionPlanPrompt(db.prisma, scanId, 'en');
    await postPlan(owner, scanId, 'en');
    await vi.waitFor(() => expect(gated.calls()).toBe(1));
    gated.release();
    await settledRun(db.prisma, scanId);

    expect(preview.promptText).toBe(gated.prompts()[0]);
    const printed = formatPromptPreview(preview);
    expect(printed).toContain('=== system instructions ===');
    expect(printed).toContain('SEC-PASSIVE-003');
    for (const excluded of [
      'SECRET-EVIDENCE-EXCERPT',
      'evidence_excerpt',
      'ANALYTICS-SC-002',
      'Google showed',
    ]) {
      expect(printed).not.toContain(excluded);
    }
  });

  it('says so when there is nothing to plan', async () => {
    const app = planApp(db.prisma, { provider: null });
    const { scanId } = await plannableScan(db.prisma, app, 'dry-run-empty@example.com', {
      issues: [{ ruleId: 'ANALYTICS-SC-002', module: 'Analytics' }],
    });

    await expect(previewActionPlanPrompt(db.prisma, scanId, 'en')).rejects.toThrow(
      /nothing to plan/,
    );
  });
});
