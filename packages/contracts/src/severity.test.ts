import { describe, expect, it } from 'vitest';

import { SEVERITY_WEIGHTS, severityRank } from './severity.js';

describe('severity weights §15', () => {
  it('matches the fixed penalty scale', () => {
    expect(SEVERITY_WEIGHTS).toEqual({ Critical: 25, High: 10, Medium: 3, Low: 1 });
  });
});

describe('severityRank', () => {
  it('orders by urgency, not alphabetically', () => {
    const ranked = ['Low', 'Medium', 'Critical', 'High'].sort(
      (left, right) => severityRank(left) - severityRank(right),
    );
    expect(ranked).toEqual(['Critical', 'High', 'Medium', 'Low']);
  });

  it('puts an unknown or missing severity after Low', () => {
    expect(severityRank('Informational')).toBe(4);
    expect(severityRank(null)).toBe(4);
  });
});
