import { describe, expect, it } from 'vitest';

import { packageName } from './index.js';

describe('@fluxradar/scoring', () => {
  it('exposes the package name placeholder', () => {
    expect(packageName).toBe('@fluxradar/scoring');
  });
});
