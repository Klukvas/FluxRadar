import { describe, expect, it } from 'vitest';

import {
  PLAN_NOT_READY_POLL_LIMIT,
  planIn,
  planLanguageFromSearch,
  planSearch,
  readActionPlanState,
  shouldPoll,
  type ActionPlanState,
} from './action-plan';

// Reading the API's answer, and deciding from it whether to ask again (D-232).

const ACTION = {
  title: 'Point every page at its own address',
  why: 'Search engines index the wrong address.',
  steps: ['Set the canonical link.', 'Set the canonical link.', 'Check it in the source.'],
  effort: 'small',
  rules: [{ ruleId: 'SEO-TECH-004', openIssues: 1, totalIssues: 1 }],
  openIssues: 1,
  totalIssues: 1,
  settled: false,
};

function answer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    language: 'en',
    availability: 'available',
    languages: ['en'],
    run: null,
    lastFailure: null,
    remaining: { successes: 2, attempts: 5 },
    windowEndsAt: '2026-09-24T11:00:00.000Z',
    plan: {
      language: 'en',
      generatedAt: '2026-09-21T12:00:00.000Z',
      modelId: 'claude-opus-5',
      overview: 'The site works.',
      actions: [ACTION],
      reach: { addressed: 1, open: 1, rules: 1 },
      caveats: [],
    },
    ...overrides,
  };
}

function state(overrides: Record<string, unknown> = {}): ActionPlanState {
  const read = readActionPlanState(answer(overrides));
  if (read === null) throw new Error('the fixture is not a plan state');
  return read;
}

describe('reading the Action Plan answer', () => {
  it('reads nothing from an answer with a value this release does not know', () => {
    expect(readActionPlanState(answer({ availability: 'paused' }))).toBeNull();
    expect(
      readActionPlanState(
        answer({
          plan: { ...(answer().plan as object), actions: [{ ...ACTION, effort: 'huge' }] },
        }),
      ),
    ).toBeNull();
  });

  it('drops a repeated step, so each step is its own key', () => {
    expect(state().plan?.actions[0]?.steps).toEqual([
      'Set the canonical link.',
      'Check it in the source.',
    ]);
  });

  it('gives the plan only to the language it was asked for', () => {
    expect(planIn(state(), 'en')).not.toBeNull();
    expect(planIn(state(), 'uk')).toBeNull();
    expect(planIn(null, 'en')).toBeNull();
  });
});

describe('asking again', () => {
  it('asks while a plan is being written, however long it takes', () => {
    const running = state({ run: { language: 'en', startedAt: '2026-09-21T12:00:00Z' } });

    expect(shouldPoll(running, PLAN_NOT_READY_POLL_LIMIT * 2)).toBe(true);
  });

  it('asks while the scan is not ready, up to a limit', () => {
    const notReady = state({ availability: 'not_ready' });

    expect(shouldPoll(notReady, 1)).toBe(true);
    expect(shouldPoll(notReady, PLAN_NOT_READY_POLL_LIMIT - 1)).toBe(true);
    expect(shouldPoll(notReady, PLAN_NOT_READY_POLL_LIMIT)).toBe(false);
  });

  it('does not ask once there is nothing to wait for', () => {
    expect(shouldPoll(state(), 0)).toBe(false);
    expect(shouldPoll(state({ availability: 'window_closed' }), 0)).toBe(false);
  });
});

describe('the print address', () => {
  it('carries the plan language there and back', () => {
    expect(planSearch('de')).toBe('?plan=de');
    expect(planLanguageFromSearch(planSearch('de'))).toBe('de');
  });

  it('ignores a language the picker does not list', () => {
    expect(planLanguageFromSearch('?plan=xx')).toBeNull();
    expect(planLanguageFromSearch('?plan=')).toBeNull();
    expect(planLanguageFromSearch('')).toBeNull();
  });
});
