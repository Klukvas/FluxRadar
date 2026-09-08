import { FREE_CHECK_RULE_IDS, ruleById } from '@fluxradar/contracts';
import { describe, expect, it } from 'vitest';

import { FREE_CHECK_SCORING_REASON, freeCheckMetadata } from './free-check.ts';

// The Free module row used to carry the paid SEO module's metadata, so a report
// on a Free check advertised structured-data and social-preview coverage from a
// run that only ever evaluated four homepage rules. The row has to describe the
// run it belongs to, and it has to name why its score is null — Free has no
// tariff score weight, which is not the same thing as unreadable data.

describe('Free check module metadata', () => {
  it('names exactly the rules the free check runs, with the registry titles', () => {
    const metadata = freeCheckMetadata();
    expect(metadata.checks).toEqual(
      FREE_CHECK_RULE_IDS.map((ruleId) => ({ ruleId, title: ruleById(ruleId)?.title })),
    );
  });

  it('claims none of the paid SEO module checks', () => {
    const metadata = freeCheckMetadata();
    expect(metadata).not.toHaveProperty('structuredData');
    expect(metadata).not.toHaveProperty('socialPreview');
    expect(metadata.scope).toBe('homepage only');
  });

  it('records that the missing score is the plan, not missing data', () => {
    expect(freeCheckMetadata().scoring).toBe(FREE_CHECK_SCORING_REASON);
  });

  it('keeps the wire value the report matches on', () => {
    // The web app has no dependency on this package, so it matches the literal
    // (apps/web/src/scan-status.ts). Renaming the constant is free; changing
    // what goes on the wire silently turns the report's explanation back into a
    // bare "No score", which is the exact regression this pins.
    expect(FREE_CHECK_SCORING_REASON).toBe('NotScoredOnFreePlan');
  });
});
