import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';

import { ApiRequestError, apiRequest } from './api';
import { AlertDialog, Button, Field, TextAreaField, Window } from './components';
import type { Language } from './i18n';
import { SUPPORT_LIMITS, supportCopy, type SupportCopy } from './support-copy';
import './styles/support.css';

type SupportWidgetProps = {
  readonly language: Language;
  /** The signed-in account's address, or null for a guest, who is asked for one. */
  readonly accountEmail: string | null;
};

type SubmitState =
  | { readonly kind: 'editing' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'sent'; readonly replyTo: string | null };

type FieldErrors = {
  readonly email?: string;
  readonly subject?: string;
  readonly message?: string;
};

type FormValues = {
  readonly email: string;
  readonly subject: string;
  readonly message: string;
  readonly asksForEmail: boolean;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]';

/** The floating "Support" launcher on every page, and the form it opens. */
export function SupportWidget({
  language,
  accountEmail,
}: SupportWidgetProps): React.JSX.Element | null {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);

  // Hidden until the API says a message would reach someone: a form that can
  // only end in "unavailable" is worse than no form at all.
  useEffect(() => {
    let isCurrent = true;
    apiRequest<{ readonly available: boolean } | null>('/support/status')
      .then((status) => {
        if (isCurrent) setIsAvailable(status?.available === true);
      })
      .catch(() => {
        // An API that cannot be reached cannot deliver a message either, so it
        // reads exactly like a deployment without a support channel.
        if (isCurrent) setIsAvailable(false);
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  if (!isAvailable) return null;
  const text = supportCopy[language];
  return (
    <>
      <button
        className="button support-launcher"
        type="button"
        aria-haspopup="dialog"
        aria-label={text.launcherLabel}
        onClick={() => setIsOpen(true)}
      >
        <svg className="support-launcher__icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1.5 2.5h13v8.5h-7l-3.5 3v-3h-2.5z" />
        </svg>
        <span className="support-launcher__label">{text.launcher}</span>
      </button>
      {isOpen ? (
        <SupportDialog
          text={text}
          language={language}
          accountEmail={accountEmail}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function SupportDialog(props: {
  readonly text: SupportCopy;
  readonly language: Language;
  readonly accountEmail: string | null;
  readonly onClose: () => void;
}) {
  const { text, language, accountEmail, onClose } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  useModalFocus(dialogRef, onClose);

  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  // The API has the last word on who is signed in: a session that expired while
  // the page stayed open turns this into a guest request, which needs an address.
  const [isEmailRequiredByServer, setIsEmailRequiredByServer] = useState(false);
  // Errors wait for the first attempt to send, so an empty form does not open red.
  const [hasTriedToSend, setHasTriedToSend] = useState(false);
  const [state, setState] = useState<SubmitState>({ kind: 'editing' });

  const asksForEmail = accountEmail === null || isEmailRequiredByServer;
  const values: FormValues = { email, subject, message, asksForEmail };
  const errors = hasTriedToSend ? validate(values, text) : {};
  const isSending = state.kind === 'sending';

  useEffect(() => {
    // Sending replaces the form, focused button included; without this, focus
    // falls back to the page behind the modal.
    if (state.kind === 'sent') {
      dialogRef.current?.querySelector<HTMLElement>('.support-sent .button')?.focus();
    }
  }, [state.kind]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSending) return;
    setHasTriedToSend(true);
    if (Object.keys(validate(values, text)).length > 0) return;
    const replyTo = asksForEmail ? email.trim() : accountEmail;
    setState({ kind: 'sending' });
    try {
      await apiRequest<{ readonly status: string }>('/support', {
        method: 'POST',
        body: JSON.stringify({
          subject: subject.trim(),
          message: message.trim(),
          ...(asksForEmail ? { email: email.trim() } : {}),
          // The path only: a query can carry a one-time email token.
          page: window.location.pathname,
          language,
        }),
      });
      setState({ kind: 'sent', replyTo });
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.code === 'SUPPORT_EMAIL_REQUIRED') {
        setIsEmailRequiredByServer(true);
        setState({ kind: 'failed', message: text.errors.emailRequired });
        return;
      }
      setState({ kind: 'failed', message: failureMessage(caught, text) });
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="support-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <Window title={text.windowTitle} className="window--dialog" onClose={onClose}>
          {state.kind === 'sent' ? (
            <div className="stack support-sent">
              <div role="status">
                <h2 id={headingId} className="section-heading">
                  {text.sentHeading}
                </h2>
                <p className="muted">{text.sentBody(state.replyTo)}</p>
              </div>
              <div className="button-row">
                <Button variant="primary" onClick={onClose}>
                  {text.close}
                </Button>
              </div>
            </div>
          ) : (
            <form className="stack" onSubmit={submit} noValidate>
              <div>
                <h2 id={headingId} className="section-heading">
                  {text.heading}
                </h2>
                <p className="muted">{text.intro}</p>
                {!asksForEmail && accountEmail !== null ? (
                  <p className="muted">{text.signedInAs(accountEmail)}</p>
                ) : null}
              </div>
              {asksForEmail ? (
                <Field
                  label={text.email}
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={setEmail}
                  placeholder={text.emailPlaceholder}
                  hint={text.emailHint}
                  error={errors.email ?? ''}
                  maxLength={SUPPORT_LIMITS.emailMax}
                />
              ) : null}
              <Field
                label={text.subject}
                name="subject"
                value={subject}
                onChange={setSubject}
                placeholder={text.subjectPlaceholder}
                error={errors.subject ?? ''}
                maxLength={SUPPORT_LIMITS.subjectMax}
              />
              <TextAreaField
                label={text.message}
                name="message"
                value={message}
                onChange={setMessage}
                placeholder={text.messagePlaceholder}
                error={errors.message ?? ''}
                maxLength={SUPPORT_LIMITS.messageMax}
                rows={6}
              />
              <div className="button-row">
                <Button type="submit" variant="primary" disabled={isSending}>
                  {isSending ? text.sending : text.send}
                </Button>
                <Button onClick={onClose}>{text.cancel}</Button>
              </div>
              {state.kind === 'failed' ? (
                <AlertDialog
                  message={state.message}
                  onClose={() => setState({ kind: 'editing' })}
                />
              ) : null}
            </form>
          )}
        </Window>
      </div>
    </div>
  );
}

function validate(values: FormValues, text: SupportCopy): FieldErrors {
  return {
    ...(values.asksForEmail && !EMAIL_PATTERN.test(values.email.trim())
      ? { email: text.errors.email }
      : {}),
    ...(values.subject.trim().length < SUPPORT_LIMITS.subjectMin
      ? { subject: text.errors.subject }
      : {}),
    ...(values.message.trim().length < SUPPORT_LIMITS.messageMin
      ? { message: text.errors.message }
      : {}),
  };
}

/** The sentence for a failed send, written here from the API's code, not its prose. */
function failureMessage(caught: unknown, text: SupportCopy): string {
  if (!(caught instanceof ApiRequestError)) return text.errors.deliveryFailed;
  if (caught.code === 'SUPPORT_UNAVAILABLE') return text.errors.unavailable;
  if (caught.code === 'SUPPORT_DELIVERY_FAILED') return text.errors.deliveryFailed;
  if (caught.code === 'RATE_LIMITED') return text.errors.rateLimited;
  return caught.message;
}

/**
 * The modal contract the sign-in dialog keeps: Escape closes, Tab stays inside,
 * the page behind does not scroll, and focus returns to whatever opened it.
 */
function useModalFocus(dialogRef: RefObject<HTMLDivElement | null>, onClose: () => void): void {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
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
    // The first field, not the titlebar's close box that comes before it.
    const frame = window.requestAnimationFrame(() =>
      dialogRef.current?.querySelector<HTMLElement>('input, textarea')?.focus(),
    );
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [dialogRef, onClose]);
}
