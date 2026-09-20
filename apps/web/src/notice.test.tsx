// A confirmation clears itself, but not while someone is reading it (WCAG 2.2.1).

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Notice, NOTICE_TIMEOUT_MS } from './components';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a notice', () => {
  it('closes itself after the timeout', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Notice message="Status saved." onClose={onClose} closeLabel="Hide" />);

    act(() => vi.advanceTimersByTime(NOTICE_TIMEOUT_MS));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays while the pointer is on it and restarts the full timeout on leaving', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Notice message="Status saved." onClose={onClose} closeLabel="Hide" />);
    const notice = screen.getByRole('status');

    fireEvent.mouseEnter(notice);
    act(() => vi.advanceTimersByTime(NOTICE_TIMEOUT_MS * 3));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseLeave(notice);
    act(() => vi.advanceTimersByTime(NOTICE_TIMEOUT_MS - 1));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
