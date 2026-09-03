import { describe, expect, it } from 'vitest';

import { packageName } from './index.js';

describe('@fluxradar/crawler', () => {
  it('exposes the package name placeholder', () => {
    expect(packageName).toBe('@fluxradar/crawler');
  });
});
