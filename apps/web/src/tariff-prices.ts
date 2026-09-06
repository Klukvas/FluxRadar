// The price of each paid tariff, as one value the whole UI reads.
//
// The authority is `TARIFFS` in `packages/contracts/src/tariffs.ts` — the same
// table the API charges and validates against. This bundle deliberately has no
// workspace dependencies (see apps/web/package.json), so the numbers are
// restated here instead of imported, and `tariff-prices.test.ts` reads the
// contract file and fails if the two ever drift apart. A price that lives in one
// place cannot be raised in the tariff table and left stale in the copy.

export const TARIFF_PRICES_USD = { Basic: 55, Complete: 120 } as const;

export const BASIC_PRICE = `$${TARIFF_PRICES_USD.Basic}`;
export const COMPLETE_PRICE = `$${TARIFF_PRICES_USD.Complete}`;
