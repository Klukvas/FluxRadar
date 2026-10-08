import { describe, expect, it } from 'vitest';

import { InFlightReads } from './suggestion-in-flight.ts';

describe('in-flight public reads', () => {
  it('gives the slot to the first caller and refuses an identical one', () => {
    const reads = new InFlightReads();

    expect(reads.tryAcquire('owner|https://example.test')).toBe(true);
    expect(reads.tryAcquire('owner|https://example.test')).toBe(false);
  });

  it('keeps separate slots for different accounts and addresses', () => {
    const reads = new InFlightReads();

    expect(reads.tryAcquire('owner|https://example.test')).toBe(true);
    expect(reads.tryAcquire('owner|https://other.test')).toBe(true);
    expect(reads.tryAcquire('stranger|https://example.test')).toBe(true);
    expect(reads.size).toBe(3);
  });

  it('frees the slot again, so a finished read never blocks the next one', () => {
    const reads = new InFlightReads();
    reads.tryAcquire('owner|https://example.test');

    reads.release('owner|https://example.test');

    expect(reads.size).toBe(0);
    expect(reads.tryAcquire('owner|https://example.test')).toBe(true);
  });

  it('ignores a release for a slot it never held', () => {
    const reads = new InFlightReads();

    reads.release('owner|https://example.test');

    expect(reads.size).toBe(0);
  });
});
