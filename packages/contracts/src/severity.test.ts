import { describe, expect, it } from 'vitest';

import { SEVERITY_WEIGHTS } from './severity.js';

describe('severity weights §15', () => {
  it('matches the fixed penalty scale', () => {
    expect(SEVERITY_WEIGHTS).toEqual({ Critical: 25, High: 10, Medium: 3, Low: 1 });
  });
});
