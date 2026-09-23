// The seam between the AI lane's Action Plan and the platform lane's PDF.
//
// Both halves were built and reviewed separately, against a shape neither could
// run: the exporter declared a slot and left it empty, and the plan was written
// for the web report. What is checked here is the join — that the document gets
// the plan's own language, that nothing the projection deliberately withholds
// can appear in it, and that a plan which is not there is simply absent rather
// than an error.

import { describe, expect, it } from 'vitest';

import { toPdfProjection } from './pdf-loader.ts';
import type { ProjectedActionPlan } from './projection.ts';

function projected(overrides: Partial<ProjectedActionPlan> = {}): ProjectedActionPlan {
  return {
    language: 'uk',
    overview: 'Спершу три речі.',
    actions: [
      {
        title: 'Додати заголовки сторінок',
        why: 'Шість сторінок їх не мають.',
        steps: ['Напишіть заголовок для кожної сторінки.'],
        effort: 'small',
        ruleIds: ['SEO-ONPAGE-001'],
        openIssues: 4,
        totalIssues: 6,
        settled: false,
      },
    ],
    reach: { share: 0.4, addressedOpenIssues: 4, totalOpenIssues: 10, rules: 1 },
    caveats: ['Analytics не виконувався.'],
    generatedAt: '2026-09-22T11:30:00.000Z',
    modelId: 'claude-test',
    noticeVersion: 'notice-v1',
    ...overrides,
  };
}

describe('the plan as the PDF renderer asks for it', () => {
  it('carries the content, the reach and the caveats across unchanged', () => {
    const plan = toPdfProjection(projected());

    expect(plan.overview).toBe('Спершу три речі.');
    expect(plan.reach).toEqual({
      share: 0.4,
      addressedOpenIssues: 4,
      totalOpenIssues: 10,
      rules: 1,
    });
    // The report says what the scan could not see; a document that dropped it
    // would read as the more confident of the two for no reason.
    expect(plan.caveats).toEqual(['Analytics не виконувався.']);
    expect(plan.actions).toEqual([
      {
        title: 'Додати заголовки сторінок',
        why: 'Шість сторінок їх не мають.',
        steps: ['Напишіть заголовок для кожної сторінки.'],
        effort: 'small',
        ruleIds: ['SEO-ONPAGE-001'],
        openIssues: 4,
        totalIssues: 6,
        settled: false,
      },
    ]);
  });

  it('gives the document no field a prompt or a token bill could travel in', () => {
    const plan = toPdfProjection(projected());

    expect(Object.keys(plan)).toEqual(['overview', 'caveats', 'actions', 'reach', 'metadata']);
    expect(Object.keys(plan.metadata)).toEqual([
      'modelId',
      'promptVersion',
      'noticeVersion',
      'generatedAt',
    ]);
    // Neither is in `ProjectedActionPlan` to begin with, which is what makes
    // this structural rather than a habit the next edit can break.
    expect(JSON.stringify(plan)).not.toContain('promptText');
    expect(JSON.stringify(plan)).not.toContain('usage');
  });

  it('names an effort the document can render, and never invents one', () => {
    const readable = toPdfProjection(
      projected({
        actions: [{ ...projected().actions[0]!, effort: 'large' }],
      }),
    );
    expect(readable.actions[0]?.effort).toBe('large');

    // A plan written by an older release, or by a model that answered with a
    // word this document has no phrase for, still has to render: the middle
    // effort is the honest default, and it is the one case where the mapping
    // chooses rather than copies.
    const unknown = toPdfProjection(
      projected({
        actions: [{ ...projected().actions[0]!, effort: 'colossal' }],
      }),
    );
    expect(unknown.actions[0]?.effort).toBe('medium');
  });
});
