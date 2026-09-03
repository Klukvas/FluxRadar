import { describe, expect, it } from 'vitest';

import { packageName } from './index.js';

describe('@fluxradar/safe-fetch', () => {
  it('exposes the package name placeholder', () => {
    expect(packageName).toBe('@fluxradar/safe-fetch');
  });
});
