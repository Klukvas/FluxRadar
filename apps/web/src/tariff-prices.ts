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

// The same prices with the currency spelled out, for the places a buyer decides
// on: the tariff cards and the comparison row. The catalogue is priced in USD,
// but the checkout localises — a buyer outside the US is quoted their own
// currency — so a bare "$" on the marketing page is a figure the checkout may
// not repeat. It also satisfies FastSpring's activation check that the prices
// on the website match the catalogue.
export const BASIC_PRICE_USD = `${BASIC_PRICE} USD`;
export const COMPLETE_PRICE_USD = `${COMPLETE_PRICE} USD`;
