import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { TARIFF_PRICES_USD } from './tariff-prices';

// The pricing copy is what a buyer decides on, and the API charges and validates
// against `TARIFFS` in packages/contracts. This bundle has no workspace
// dependency to import that table from, so the guard is here: the contract file
// is read as text and the two prices it states must be the two prices the UI
// shows. Raising a tariff and forgetting the copy stops being possible silently.

// Resolved from the vitest root (apps/web) rather than `import.meta.url`, which
// Vite serves over http during a test run.
const TARIFFS_SOURCE = resolve(process.cwd(), '../../packages/contracts/src/tariffs.ts');

/** The `priceUsd` the contract states for one plan, read out of its own source. */
function contractPriceUsd(source: string, plan: string): number {
  const block = new RegExp(`plan:\\s*'${plan}'[\\s\\S]*?priceUsd:\\s*(\\d+(?:\\.\\d+)?)`).exec(
    source,
  );
  if (block === null) {
    throw new Error(`no priceUsd found for the ${plan} tariff in ${TARIFFS_SOURCE}`);
  }
  return Number(block[1]);
}

describe('tariff prices', () => {
  const source = readFileSync(TARIFFS_SOURCE, 'utf8');

  it('shows the Basic price the contract charges', () => {
    expect(TARIFF_PRICES_USD.Basic).toBe(contractPriceUsd(source, 'Basic'));
  });

  it('shows the Complete price the contract charges', () => {
    expect(TARIFF_PRICES_USD.Complete).toBe(contractPriceUsd(source, 'Complete'));
  });
});
