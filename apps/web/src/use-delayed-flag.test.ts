import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDelayedFlag } from './use-delayed-flag';

describe('useDelayedFlag', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays false until the delay has passed, then flips true', () => {
    const { result } = renderHook(() => useDelayedFlag(true));
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });

  it('resets immediately when the flag goes inactive, and counts from zero again', () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useDelayedFlag(active),
      { initialProps: { active: true } },
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(true);
    rerender({ active: false });
    expect(result.current).toBe(false);
    rerender({ active: true });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(true);
  });
});
