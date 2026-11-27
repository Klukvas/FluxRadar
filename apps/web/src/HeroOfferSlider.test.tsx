// The home page slider as a visitor drives it: five labelled tabs, a slider
// that moves on by itself only while nobody is using it, stops for good once
// someone does, and never moves for a reader who asked for reduced motion.

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HeroOfferSlider } from './HeroOfferSlider';
import { heroOfferCopy, OFFER_SLIDE_IDS } from './hero-offer-copy';
import { copy } from './i18n';
import { SLIDE_INTERVAL_MS } from './use-slide-autoplay';

const t = heroOfferCopy.en;
const LABELS = OFFER_SLIDE_IDS.map((slide) => t.tabs[slide]);

function mockReducedMotion(isReduced: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: isReduced && query.includes('reduce'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function renderSlider(): HTMLElement {
  render(<HeroOfferSlider language="en" />);
  return screen.getByRole('region', { name: t.windowTitle });
}

function selectedLabel(): string | null {
  return screen.getByRole('tab', { selected: true }).textContent;
}

/** The panel of the selected tab: every panel is in the markup, one is shown. */
function activePanel(): HTMLElement {
  const id = screen.getByRole('tab', { selected: true }).getAttribute('aria-controls') ?? '';
  const panel = document.getElementById(id);
  if (panel === null) throw new Error('the selected tab controls no panel');
  return panel;
}

/** Lets the slide's timer run its full course. */
function advanceOneSlide(): void {
  act(() => {
    vi.advanceTimersByTime(SLIDE_INTERVAL_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mockReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('home slider tabs', () => {
  it('names every topic in a tablist, the first one selected', () => {
    renderSlider();
    const tablist = screen.getByRole('tablist', { name: t.tablistLabel });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(LABELS);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
    // Roving tabindex: one tab in the tab order, the selected one.
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1, -1]);
  });

  it('ties each tab to its panel and keeps the hidden panels out of reach', () => {
    renderSlider();
    const tabs = screen.getAllByRole('tab');
    tabs.forEach((tab, index) => {
      const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
      expect(panel).toHaveAttribute('role', 'tabpanel');
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
      expect(panel?.hasAttribute('inert')).toBe(index !== 0);
    });
  });

  it('moves with the arrow keys, wraps, and jumps with Home and End', () => {
    renderSlider();
    const tablist = screen.getByRole('tablist');
    const first = screen.getByRole('tab', { name: t.tabs.report });
    first.focus();
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(selectedLabel()).toBe(t.tabs.ai);
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: t.tabs.ai }));
    fireEvent.keyDown(tablist, { key: 'End' });
    expect(selectedLabel()).toBe(t.tabs.developer);
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(selectedLabel()).toBe(t.tabs.report);
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(selectedLabel()).toBe(t.tabs.developer);
    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(selectedLabel()).toBe(t.tabs.report);
    expect(screen.getByRole('tab', { selected: true }).tabIndex).toBe(0);
  });

  it('switches by tab click and by the arrows, and says where it is', () => {
    renderSlider();
    fireEvent.click(screen.getByRole('tab', { name: t.tabs.security }));
    expect(selectedLabel()).toBe(t.tabs.security);
    expect(screen.getByText(t.position(3, 5))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.next }));
    expect(selectedLabel()).toBe(t.tabs.plan);
    fireEvent.click(screen.getByRole('button', { name: t.previous }));
    fireEvent.click(screen.getByRole('button', { name: t.previous }));
    expect(selectedLabel()).toBe(t.tabs.ai);
  });

  it('follows a sideways swipe, and ignores a vertical scroll', () => {
    renderSlider();
    const viewport = activePanel().parentElement as HTMLElement;
    fireEvent.touchStart(viewport, { changedTouches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchEnd(viewport, { changedTouches: [{ clientX: 120, clientY: 110 }] });
    expect(selectedLabel()).toBe(t.tabs.ai);
    fireEvent.touchStart(viewport, { changedTouches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchEnd(viewport, { changedTouches: [{ clientX: 150, clientY: 300 }] });
    expect(selectedLabel()).toBe(t.tabs.ai);
  });
});

describe('home slider panels and foot', () => {
  it('makes every panel a focus stop', () => {
    renderSlider();
    for (const tab of screen.getAllByRole('tab')) {
      const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
      expect(panel).toHaveAttribute('tabindex', '0');
    }
  });

  // The full example has the report and the developer message, and no AI
  // answers, Security section or action plan.
  it('offers the full example only under the slides it shows', () => {
    const window = renderSlider();
    const link = within(window).getByText(copy.en.home.hero.example.link).closest('a');
    const offered: Record<string, boolean> = {};
    for (const slide of OFFER_SLIDE_IDS) {
      fireEvent.click(screen.getByRole('tab', { name: t.tabs[slide] }));
      offered[slide] = link?.getAttribute('aria-hidden') !== 'true' && link?.tabIndex !== -1;
    }
    expect(offered).toEqual({
      report: true,
      ai: false,
      security: false,
      plan: false,
      developer: true,
    });
  });
});

describe('home slider tab strip on a narrow screen', () => {
  function box(left: number, width: number): DOMRect {
    return {
      left,
      right: left + width,
      width,
      top: 0,
      bottom: 40,
      height: 40,
      x: left,
      y: 0,
    } as DOMRect;
  }

  it('scrolls the strip, not the page, to a selected tab past its edge', () => {
    const window = renderSlider();
    const strip = within(window).getByRole('tablist');
    const scrollTo = vi.fn();
    Object.assign(strip, { scrollTo });
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(box(0, 300));
    screen.getAllByRole('tab').forEach((tab, index) => {
      vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue(box(index * 100, 100));
    });
    fireEvent.click(screen.getByRole('tab', { name: t.tabs.ai }));
    // Fully visible: left alone.
    expect(scrollTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: t.tabs.developer }));
    // Tab 5 spans 400–500 in a 300-wide strip: centred, it starts at 100.
    expect(scrollTo).toHaveBeenCalledWith({ left: 300, behavior: 'smooth' });
  });

  it('jumps rather than glides under reduced motion', () => {
    mockReducedMotion(true);
    const window = renderSlider();
    const strip = within(window).getByRole('tablist');
    const scrollTo = vi.fn();
    Object.assign(strip, { scrollTo });
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(box(0, 300));
    screen.getAllByRole('tab').forEach((tab, index) => {
      vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue(box(index * 100, 100));
    });
    fireEvent.click(screen.getByRole('tab', { name: t.tabs.developer }));
    expect(scrollTo).toHaveBeenCalledWith({ left: 300, behavior: 'auto' });
  });
});

describe('home slider auto-advance', () => {
  it('moves on every interval, back to the first after the last', () => {
    renderSlider();
    advanceOneSlide();
    expect(selectedLabel()).toBe(t.tabs.ai);
    for (let step = 0; step < OFFER_SLIDE_IDS.length - 1; step += 1) advanceOneSlide();
    expect(selectedLabel()).toBe(t.tabs.report);
  });

  it('stays silent for a screen reader while it moves by itself', () => {
    const window = renderSlider();
    const viewport = activePanel().parentElement as HTMLElement;
    expect(viewport).toHaveAttribute('aria-live', 'off');
    fireEvent.click(within(window).getByRole('tab', { name: t.tabs.plan }));
    expect(viewport).toHaveAttribute('aria-live', 'polite');
  });

  it('holds while a mouse is over it, keeping the time already spent', () => {
    const window = renderSlider();
    act(() => {
      vi.advanceTimersByTime(SLIDE_INTERVAL_MS / 2);
    });
    fireEvent.pointerEnter(window, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(SLIDE_INTERVAL_MS * 3);
    });
    expect(selectedLabel()).toBe(t.tabs.report);
    expect(window).toHaveClass('is-held');
    fireEvent.pointerLeave(window, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(SLIDE_INTERVAL_MS / 2);
    });
    expect(selectedLabel()).toBe(t.tabs.ai);
  });

  it('holds while focus is inside it, and goes on when focus leaves', () => {
    renderSlider();
    const outside = document.createElement('button');
    document.body.append(outside);
    act(() => {
      screen.getByRole('button', { name: t.next }).focus();
    });
    act(() => {
      vi.advanceTimersByTime(SLIDE_INTERVAL_MS * 2);
    });
    expect(selectedLabel()).toBe(t.tabs.report);
    act(() => {
      outside.focus();
    });
    advanceOneSlide();
    expect(selectedLabel()).toBe(t.tabs.ai);
    outside.remove();
  });

  it.each<[string, (window: HTMLElement) => void]>([
    ['a tab click', () => fireEvent.click(screen.getByRole('tab', { name: t.tabs.ai }))],
    ['an arrow button', () => fireEvent.click(screen.getByRole('button', { name: t.next }))],
    ['a key press', () => fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })],
    ['a click on a slide', () => fireEvent.click(activePanel())],
    [
      'a swipe',
      () => {
        const viewport = activePanel().parentElement as HTMLElement;
        fireEvent.touchStart(viewport, { changedTouches: [{ clientX: 200, clientY: 0 }] });
        fireEvent.touchEnd(viewport, { changedTouches: [{ clientX: 100, clientY: 0 }] });
      },
    ],
  ])('stops for good after %s', (_, interact) => {
    const window = renderSlider();
    interact(window);
    const chosen = selectedLabel();
    act(() => {
      vi.advanceTimersByTime(SLIDE_INTERVAL_MS * 4);
    });
    expect(selectedLabel()).toBe(chosen);
    expect(window).not.toHaveClass('is-auto');
    expect(screen.getByRole('button', { name: t.resume })).toBeInTheDocument();
  });

  // A mouse press focuses the button it lands on. The slider holds for
  // keyboard focus only, so "Play automatically" pressed with a mouse moves on
  // with the focus still on it.
  it('stops and resumes from its own control, pressed with a mouse', () => {
    renderSlider();
    const pressWithMouse = (button: HTMLElement): void => {
      fireEvent.pointerDown(button, { pointerType: 'mouse' });
      act(() => {
        button.focus();
      });
      fireEvent.pointerUp(button, { pointerType: 'mouse' });
      fireEvent.click(button);
    };
    pressWithMouse(screen.getByRole('button', { name: t.stop }));
    act(() => {
      vi.advanceTimersByTime(SLIDE_INTERVAL_MS * 2);
    });
    expect(selectedLabel()).toBe(t.tabs.report);
    const resume = screen.getByRole('button', { name: t.resume });
    pressWithMouse(resume);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: t.stop }));
    advanceOneSlide();
    expect(selectedLabel()).toBe(t.tabs.ai);
  });

  it('keeps moving after a lone Shift, as in Shift+Tab back through it', () => {
    const window = renderSlider();
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'Tab']) {
      fireEvent.keyDown(window, { key });
    }
    expect(window).toHaveClass('is-auto');
    advanceOneSlide();
    expect(selectedLabel()).toBe(t.tabs.ai);
  });

  // On touch, pointerup comes before the focus it causes, so `:focus-visible`
  // is the only thing telling that focus from the keyboard's.
  it('does not hold for focus the browser does not show as keyboard focus', () => {
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
      this: Element,
      selector: string,
    ) {
      return selector === ':focus-visible' ? false : matches.call(this, selector);
    });
    const window = renderSlider();
    act(() => {
      screen.getByRole('button', { name: t.next }).focus();
    });
    expect(window).not.toHaveClass('is-held');
    advanceOneSlide();
    expect(selectedLabel()).toBe(t.tabs.ai);
  });

  it('holds for keyboard focus after a press released outside the window', () => {
    const window = renderSlider();
    fireEvent.pointerDown(activePanel(), { pointerType: 'mouse' });
    // Released over the page, not the slider.
    fireEvent.pointerUp(document.body, { pointerType: 'mouse' });
    act(() => {
      screen.getByRole('button', { name: t.next }).focus();
    });
    expect(window).toHaveClass('is-held');
  });

  it('still holds for keyboard focus on its own control', () => {
    renderSlider();
    act(() => {
      screen.getByRole('button', { name: t.stop }).focus();
    });
    act(() => {
      vi.advanceTimersByTime(SLIDE_INTERVAL_MS * 2);
    });
    expect(selectedLabel()).toBe(t.tabs.report);
  });

  it('never moves, and offers no stop control, under reduced motion', () => {
    mockReducedMotion(true);
    const window = renderSlider();
    act(() => {
      vi.advanceTimersByTime(SLIDE_INTERVAL_MS * 5);
    });
    expect(selectedLabel()).toBe(t.tabs.report);
    expect(window).not.toHaveClass('is-auto');
    expect(screen.queryByRole('button', { name: t.stop })).toBeNull();
    expect(screen.queryByRole('button', { name: t.resume })).toBeNull();
  });

  it('runs the progress strip on the same constant as the clock', () => {
    const window = renderSlider();
    expect(window.style.getPropertyValue('--hero-offer-slide-ms')).toBe(`${SLIDE_INTERVAL_MS}ms`);
  });
});
