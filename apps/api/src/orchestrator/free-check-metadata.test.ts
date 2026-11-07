import { FREE_CHECK_RULE_IDS, ruleById } from '@fluxradar/contracts';
import { describe, expect, it } from 'vitest';

import {
  FREE_CHECK_SCORE_SCOPE,
  LEGACY_FREE_CHECK_SCORING_REASON,
  freeCheckMetadata,
} from './free-check.ts';

// The Free module row used to carry the paid SEO module's metadata, so a report
// on a Free check advertised structured-data and social-preview coverage from a
// run that only ever evaluated its homepage rules. The row has to describe the
// run it belongs to. D-237 puts the social preview rule itself among those
// rules, run on the homepage; the paid module's site-wide socialPreview counts
// still do not belong on the row. Since D-236 it also says what its score is a score of: the
// homepage, never the whole site.

describe('Free check module metadata', () => {
  it('names exactly the rules the free check runs, with the registry titles', () => {
    const metadata = freeCheckMetadata();
    expect(metadata.checks).toEqual(
      FREE_CHECK_RULE_IDS.map((ruleId) => ({ ruleId, title: ruleById(ruleId)?.title })),
    );
  });

  it('lists one check per Free rule, so every count is FREE_CHECK_RULE_IDS.length', () => {
    const checks = freeCheckMetadata().checks as readonly unknown[];
    expect(checks).toHaveLength(FREE_CHECK_RULE_IDS.length);
  });

  it('claims none of the paid SEO module checks', () => {
    const metadata = freeCheckMetadata();
    expect(metadata).not.toHaveProperty('structuredData');
    expect(metadata).not.toHaveProperty('socialPreview');
    expect(metadata.scope).toBe('homepage only');
  });

  it('says the score it carries is a homepage score', () => {
    expect(freeCheckMetadata().scoreScope).toBe(FREE_CHECK_SCORE_SCOPE);
    expect(FREE_CHECK_SCORE_SCOPE).toBe('homepage');
  });

  // Intentionally reversed by D-236: the row used to say NotScoredOnFreePlan.
  it('no longer claims the plan carries no score', () => {
    expect(freeCheckMetadata()).not.toHaveProperty('scoring');
    // Old Free rows still carry this literal, and the web app still reads it
    // (apps/web/src/scan-status.ts); changing it would mislabel those reports.
    expect(LEGACY_FREE_CHECK_SCORING_REASON).toBe('NotScoredOnFreePlan');
  });
});
