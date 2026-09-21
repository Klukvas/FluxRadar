import { describe, expect, it } from 'vitest';

import {
  ACTION_PLAN_ANTHROPIC_MODEL,
  DEFAULT_ANTHROPIC_MODEL,
  isRetiredAnthropicModel,
} from './anthropic-config.ts';

describe('Anthropic models', () => {
  // A retired identifier fails every request at the API, and for the Action
  // Plan that would read as "AI unavailable" on every click.
  it('writes Action Plans with Claude Opus 5, which is not retired', () => {
    expect(ACTION_PLAN_ANTHROPIC_MODEL).toBe('claude-opus-5');
    expect(isRetiredAnthropicModel(ACTION_PLAN_ANTHROPIC_MODEL)).toBe(false);
  });

  it('keeps the default model of the scan checks off the retired list', () => {
    expect(isRetiredAnthropicModel(DEFAULT_ANTHROPIC_MODEL)).toBe(false);
  });
});
