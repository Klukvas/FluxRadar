import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SkeletonFieldRows, SkeletonRows } from './components';

/** Renders and lets any scheduled placeholder timer fire. */
function renderSkeleton(ui: Parameters<typeof render>[0]): ReturnType<typeof render> {
  const utils = render(ui);
  act(() => {
    vi.advanceTimersByTime(0);
  });
  return utils;
}

describe('SkeletonRows', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('holds back for the delay before rendering', () => {
    const { container } = render(<SkeletonRows />);
    expect(container.querySelector('.skeleton-row')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(container.querySelectorAll('.skeleton-row')).toHaveLength(3);
  });

  it('applies columns and rowHeight to every row', () => {
    const { container } = renderSkeleton(
      <SkeletonRows delay={0} rows={2} columns={['1fr', '2fr']} rowHeight={48} />,
    );
    const rows = container.querySelectorAll<HTMLElement>('.skeleton-row');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.style.gridTemplateColumns).toBe('1fr 2fr');
      expect(row.style.minHeight).toBe('48px');
      expect(row.querySelectorAll('span')).toHaveLength(2);
    }
  });

  it('keeps the legacy three-cell shape when no props are passed', () => {
    const { container } = renderSkeleton(<SkeletonRows delay={0} />);
    const row = container.querySelector<HTMLElement>('.skeleton-row');
    expect(row?.style.gridTemplateColumns).toBe('90px 1fr 28%');
    expect(row?.querySelectorAll('span')).toHaveLength(3);
  });
});

describe('SkeletonFieldRows', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('draws field-row-shaped placeholders in the requested count', () => {
    const { container } = render(<SkeletonFieldRows rows={7} />);
    expect(container.querySelector('.skeleton-field-row')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(container.querySelectorAll('.skeleton-field-row')).toHaveLength(7);
    expect(screen.getAllByLabelText('Loading results')).toHaveLength(1);
  });
});
