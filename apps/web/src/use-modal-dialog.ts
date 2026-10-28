import { useEffect, useRef, type RefObject } from 'react';

/**
 * The behavior half of the app's confirm dialogs: initial focus, a Tab trap,
 * Escape-to-close, body scroll lock and focus restore. The markup half
 * (`.modal-backdrop` + `.window--dialog`, `role="dialog"`, `aria-modal`) stays
 * with each call site; this hook only wires the interactions so every dialog
 * behaves like the launch window's discard dialog (NewScanScreen) and the scan
 * cancel dialog (ScanProgress).
 *
 * Attach the returned ref to the dialog `<section>` and pass `open` plus the
 * close action. `onClose` is read through a ref so the trap is not torn down
 * and rebuilt on every render while the dialog is open.
 */
export function useModalDialogBehavior(
  open: boolean,
  onClose: () => void,
): RefObject<HTMLElement | null> {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
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
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    const frame = window.requestAnimationFrame(() =>
      dialogRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus(),
    );
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [open]);
  return dialogRef;
}

const FOCUSABLE = 'button:not([disabled]), a[href]';
