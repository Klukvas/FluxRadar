import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Button } from './components';
import { copy, type Language } from './i18n';

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
  popoverTop: number;
  popoverLeft: number;
}

export function OnboardingTour(props: {
  language: Language;
  onFinish: () => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const t = copy[props.language];
  const steps = t.tour.steps;
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const currentStep = steps[stepIndex] ?? steps[0];

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
    if (currentStep === undefined) return undefined;
    const target = document.querySelector<HTMLElement>(
      `[data-tour-target="${currentStep.target}"]`,
    );
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
    }

    const updatePosition = () => {
      if (!target) {
        setSpotlight(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      const width = Math.max(rect.width, 24);
      const height = Math.max(rect.height, 24);
      const left = Math.max(8, Math.min(rect.left - 6, window.innerWidth - width - 8));
      const top = Math.max(8, Math.min(rect.top - 6, window.innerHeight - height - 8));
      const popoverWidth = Math.min(380, window.innerWidth - 32);
      const estimatedHeight = 230;
      const popoverTop =
        rect.bottom + 18 + estimatedHeight <= window.innerHeight
          ? rect.bottom + 18
          : Math.max(16, rect.top - estimatedHeight - 18);
      const popoverLeft = Math.max(
        16,
        Math.min(rect.left, window.innerWidth - popoverWidth - 16),
      );
      setSpotlight({
        top,
        left,
        width: width + 12,
        height: height + 12,
        popoverTop,
        popoverLeft,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
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

  if (currentStep === undefined) return null;
  const isLast = stepIndex === steps.length - 1;
  const spotlightRight = spotlight ? spotlight.left + spotlight.width : 0;
  const spotlightBottom = spotlight ? spotlight.top + spotlight.height : 0;
  return (
    <div
      className="tour-overlay"
      data-tour-active-target={currentStep.target}
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
        className="tour-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-description"
        style={
          spotlight
            ? { top: spotlight.popoverTop, left: spotlight.popoverLeft }
            : undefined
        }
      >
        <div className="tour-dialog__kicker">
          <span>{t.tour.label}</span>
          <span>{t.tour.step(stepIndex + 1, steps.length)}</span>
        </div>
        <h2 id="tour-title">{currentStep.title}</h2>
        <p id="tour-description">{currentStep.body}</p>
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
