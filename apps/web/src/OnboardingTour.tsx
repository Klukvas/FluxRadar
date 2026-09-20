import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Button } from './components';
import { copy, type Language } from './i18n';
import { tourSteps } from './tour-steps';
import { resolveTourTarget } from './tour-targets';

// Breathing room the spotlight adds around its target, in CSS pixels.
const SPOTLIGHT_PADDING = 6;
// Smallest spotlight the overlay draws, so a target that is not laid out yet
// (or an environment without layout) still shows where the tour is pointing.
const MIN_SPOTLIGHT_SIZE = 24;
/**
 * Room kept free above the docked dialog. A step whose target would sit under
 * the dialog is scrolled up past it.
 */
const DOCK_CLEARANCE = 280;

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
  /** Name of the `data-tour-target` the spotlight resolved to, for diagnostics. */
  target: string | null;
}

export function OnboardingTour(props: {
  language: Language;
  onFinish: () => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const t = copy[props.language];
  const steps = tourSteps;
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const currentStep = steps[stepIndex] ?? steps[0];
  const currentCopy = currentStep === undefined ? undefined : t.tour.steps[currentStep.id];

  const runAction = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  // Keep the current skip request in a ref so the keydown listener can be
  // registered once for the life of the dialog while still invoking the
  // latest handler (and the current busy guard). This keeps the focus-trap
  // effect off the render cycle, so a parent re-render no longer yanks focus.
  const requestSkip = useRef<() => void>(() => undefined);
  useEffect(() => {
    requestSkip.current = () => void runAction(props.onSkip);
  });

  useLayoutEffect(() => {
    const targets = currentStep?.targets;
    if (targets === undefined) return undefined;

    const updatePosition = () => {
      // Re-resolve on every update: which element carries the spotlight depends
      // on the viewport (desktop tab strip, mobile burger, open mobile sheet)
      // and on targets that mount after the step opens.
      const target = resolveTourTarget(targets);
      if (target === null) {
        setSpotlight(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      const top = Math.max(0, rect.top - SPOTLIGHT_PADDING);
      const left = Math.max(0, rect.left - SPOTLIGHT_PADDING);
      const right = Math.min(window.innerWidth, rect.right + SPOTLIGHT_PADDING);
      const bottom = Math.min(window.innerHeight, rect.bottom + SPOTLIGHT_PADDING);
      const width = Math.max(right - left, MIN_SPOTLIGHT_SIZE);
      const height = Math.max(bottom - top, MIN_SPOTLIGHT_SIZE);
      setSpotlight({
        top,
        left,
        width,
        height,
        target: target.dataset.tourTarget ?? null,
      });
    };

    const target = resolveTourTarget(targets);
    // Only scroll when the target is out of view: the header is already on
    // screen, and scrolling it "into view" would jump the page for no reason.
    if (target !== null && typeof target.scrollIntoView === 'function') {
      const rect = target.getBoundingClientRect();
      // The dialog is docked at the bottom of the viewport, so "on screen"
      // means clear of it, not merely inside the window.
      const isOnScreen = rect.top >= 0 && rect.bottom <= window.innerHeight - DOCK_CLEARANCE;
      if (!isOnScreen) target.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
    // Keyed on the step itself: two steps can share a target list, so the list's
    // identity is not a reliable signal that the step changed.
  }, [currentStep]);

  // Scroll-lock and focus capture/restore run exactly once per open dialog.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() =>
      dialogRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus(),
    );
    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(frame);
      previousFocus?.focus();
    };
  }, []);

  // Escape-to-skip and the Tab focus trap register once; the handler reads
  // live DOM (dialogRef) and the latest skip request (requestSkip).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestSkip.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], select:not([disabled])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (currentStep === undefined || currentCopy === undefined) return null;
  const isLast = stepIndex === steps.length - 1;
  const spotlightRight = spotlight ? spotlight.left + spotlight.width : 0;
  const spotlightBottom = spotlight ? spotlight.top + spotlight.height : 0;
  return (
    <div
      className="tour-overlay"
      data-tour-step-id={currentStep.id}
      data-tour-active-target={spotlight?.target ?? currentStep.targets[0]}
      data-tour-step={stepIndex + 1}
    >
      {spotlight ? (
        <>
          <div
            className="tour-overlay__scrim tour-overlay__scrim--top"
            aria-hidden="true"
            style={{ height: spotlight.top }}
          />
          <div
            className="tour-overlay__scrim tour-overlay__scrim--left"
            aria-hidden="true"
            style={{
              top: spotlight.top,
              width: spotlight.left,
              height: spotlight.height,
            }}
          />
          <div
            className="tour-overlay__scrim tour-overlay__scrim--right"
            aria-hidden="true"
            style={{
              top: spotlight.top,
              left: spotlightRight,
              height: spotlight.height,
            }}
          />
          <div
            className="tour-overlay__scrim tour-overlay__scrim--bottom"
            aria-hidden="true"
            style={{ top: spotlightBottom }}
          />
          <div
            className="tour-overlay__spotlight"
            aria-hidden="true"
            style={{
              top: spotlight.top,
              left: spotlight.left,
              width: spotlight.width,
              height: spotlight.height,
            }}
          />
        </>
      ) : (
        <div className="tour-overlay__scrim tour-overlay__scrim--full" aria-hidden="true" />
      )}
      <div
        ref={dialogRef}
        // Docked in one place for every step. It used to follow each step's
        // target, so Next, Back and Skip landed somewhere new after every click.
        className="tour-dialog tour-dialog--docked"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-description"
      >
        <div className="tour-dialog__kicker">
          <span>{t.tour.label}</span>
          <span>{t.tour.step(stepIndex + 1, steps.length)}</span>
        </div>
        <h2 id="tour-title">{currentCopy.title}</h2>
        <p id="tour-description">{currentCopy.body}</p>
        <div className="tour-dialog__actions">
          <Button onClick={() => void runAction(props.onSkip)} disabled={busy}>
            {t.tour.skip}
          </Button>
          <span className="tour-dialog__spacer" />
          {stepIndex > 0 ? (
            <Button onClick={() => setStepIndex((value) => value - 1)} disabled={busy}>
              {t.tour.back}
            </Button>
          ) : null}
          <Button
            variant="primary"
            onClick={() => {
              if (isLast) void runAction(props.onFinish);
              else setStepIndex((value) => value + 1);
            }}
            disabled={busy}
          >
            {isLast ? t.tour.finish : t.tour.next}
          </Button>
        </div>
      </div>
    </div>
  );
}
