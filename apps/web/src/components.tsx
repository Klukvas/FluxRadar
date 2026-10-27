import { PublicLanguageLinks } from './PublicLanguageLinks';
import { publicPagePath, type PublicPageId } from './public-page-routing';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

import { copy, fillCopy, type Language } from './i18n';
import { statusKind } from './status-kind';

export function Window(props: {
  title: string;
  children: ReactNode;
  terminal?: boolean;
  className?: string;
  onClose?: () => void;
  closeLabel?: string;
  /** Persistent workspace panels reserve titlebar balance without a fake close control. */
  showInertClose?: boolean;
}) {
  return (
    <section
      className={`window ${props.terminal ? 'window--terminal' : ''} ${props.className ?? ''}`}
    >
      <div className="window__titlebar">
        {/* Only closable windows make the titlebar box a control. Persistent
            workspace panels omit even the decorative X but keep this grid cell
            so their titles remain centered. */}
        {props.onClose === undefined && props.showInertClose !== false ? (
          <span className="window__box window__box--inert" aria-hidden="true">
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </span>
        ) : props.onClose === undefined ? (
          <div className="window__box-spacer" aria-hidden="true" />
        ) : (
          <button
            className="window__box"
            aria-label={props.closeLabel ?? 'Close window'}
            type="button"
            onClick={props.onClose}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        )}
        <span>{props.title}</span>
      </div>
      <div className="window__content">{props.children}</div>
    </section>
  );
}

export { CreatedByFluxLab, SiteHeader as MenuBar } from './site-chrome';
export type { MenuBarProps } from './site-chrome';
export function Panel(props: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`panel ${props.className ?? ''}`}>
      {props.title ? <div className="panel__label">{props.title}</div> : null}
      {props.children}
    </div>
  );
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  /** Overrides the accessible name when the visible text repeats across rows. */
  'aria-label'?: string;
  /** Points at the text that explains what pressing this button gets you. */
  'aria-describedby'?: string;
  'data-tour-target'?: string;
}) {
  return (
    <button
      className={`button button--${props.variant ?? 'default'}`}
      type={props.type ?? 'button'}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-expanded={props['aria-expanded']}
      aria-controls={props['aria-controls']}
      aria-label={props['aria-label']}
      aria-describedby={props['aria-describedby']}
      data-tour-target={props['data-tour-target']}
    >
      {props.children}
    </button>
  );
}

/**
 * Whether a field holds a technical value — a domain, a URL, a path pattern, a
 * count — and so renders in the monospace face the design reserves for those.
 * Anything a person writes in their own words stays in the UI font.
 */
function controlClass(options: { technical?: boolean; error?: boolean }): string {
  return [
    'control',
    options.technical === true ? 'technical-input' : null,
    options.error === true ? 'control--error' : null,
  ]
    .filter((part) => part !== null)
    .join(' ');
}

export function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  error?: string;
  hint?: string;
  name?: string;
  autoComplete?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number;
  /** Renders the value in monospace; see `controlClass`. */
  technical?: boolean;
  /** Held by something the form is doing — a real `disabled`, not a styled hint. */
  disabled?: boolean;
  'data-tour-target'?: string;
}) {
  // A rejected value was red text and nothing else: a screen reader was told
  // the field was fine and read the message only if its user happened to walk
  // back over the label. `aria-invalid` marks the control the message is about,
  // and `role="alert"` makes the message arrive when it appears — the field is
  // rejected while the owner is already past it, so nothing else announces it.
  //
  // Those two say a message exists and that something is wrong; neither says
  // which message belongs to which control. `aria-describedby` is what ties the
  // two together, so someone who returns to the field afterwards — the moment
  // `role="alert"` has already passed — is read the reason with it. The id comes
  // from `useId`, so it is stable across renders and unique among however many
  // fields share the screen, and it is pointed at only while there is something
  // to point at: a field with no error describes nothing, as before.
  const invalid = props.error !== undefined && props.error !== '';
  const errorId = useId();
  return (
    <label className="field" data-tour-target={props['data-tour-target']}>
      <span className="field__label">{props.label}</span>
      <input
        className={controlClass({ technical: props.technical, error: invalid })}
        type={props.type ?? 'text'}
        name={props.name}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        maxLength={props.maxLength}
        disabled={props.disabled}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? errorId : undefined}
      />
      {props.hint ? <span className="field__hint">{props.hint}</span> : null}
      {invalid ? (
        <span className="field__error" id={errorId} role="alert">
          {props.error}
        </span>
      ) : null}
    </label>
  );
}

export function TextAreaField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  name?: string;
  autoComplete?: string;
  rows?: number;
  maxLength?: number;
  /** Held by something the form is doing; see `Field`. */
  disabled?: boolean;
}) {
  // The same error contract as `Field`; see the note there.
  const invalid = props.error !== undefined && props.error !== '';
  const errorId = useId();
  return (
    <label className="field">
      <span className="field__label">{props.label}</span>
      <textarea
        className={controlClass({ error: invalid })}
        name={props.name}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
        rows={props.rows ?? 3}
        maxLength={props.maxLength}
        disabled={props.disabled}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? errorId : undefined}
      />
      {props.hint ? <span className="field__hint">{props.hint}</span> : null}
      {invalid ? (
        <span className="field__error" id={errorId} role="alert">
          {props.error}
        </span>
      ) : null}
    </label>
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  name?: string;
  autoComplete?: string;
  /** Says what choosing an option actually means, in the same place `Field` says it. */
  hint?: string;
  /** Renders the options in monospace; see `controlClass`. */
  technical?: boolean;
  /**
   * Why the list has nothing current to choose from. It sits under this control
   * and is tied to it with `aria-describedby`: placed above the label, the same
   * message read as belonging to the field before it. There is no
   * `aria-invalid` — the choice is not wrong, the list behind it was not filled.
   */
  error?: string;
  disabled?: boolean;
}) {
  const errorId = useId();
  const hasError = props.error !== undefined && props.error !== '';
  return (
    <label className="field">
      <span className="field__label">{props.label}</span>
      <select
        className={controlClass({ technical: props.technical })}
        name={props.name}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        autoComplete={props.autoComplete}
        aria-describedby={hasError ? errorId : undefined}
        disabled={props.disabled}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {props.hint ? <span className="field__hint">{props.hint}</span> : null}
      {hasError ? (
        <span className="field__error" id={errorId} role="status">
          {props.error}
        </span>
      ) : null}
    </label>
  );
}

export function Checkbox(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  name?: string;
  describedBy?: string;
  className?: string;
  /**
   * A master box over boxes that disagree: neither on nor off.
   *
   * There is no attribute for it — `indeterminate` is a property of the DOM
   * node — so it is written through a ref on every render, and the mixed state
   * is announced through `aria-checked` for a reader who never sees the dash.
   */
  indeterminate?: boolean;
}) {
  const box = useRef<HTMLInputElement>(null);
  const mixed = props.indeterminate === true && !props.checked;
  useEffect(() => {
    if (box.current !== null) box.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <label className={props.className === undefined ? 'checkbox' : `checkbox ${props.className}`}>
      <span className="checkbox__control">
        <input
          ref={box}
          type="checkbox"
          name={props.name}
          checked={props.checked}
          {...(mixed ? { 'aria-checked': 'mixed' as const } : {})}
          {...(props.describedBy === undefined ? {} : { 'aria-describedby': props.describedBy })}
          onChange={(event) => props.onChange(event.target.checked)}
        />
        <span aria-hidden="true" className="checkbox__mark">
          <svg viewBox="0 0 12 12">
            <path d="M2 6l2 2 6-6" />
          </svg>
        </span>
      </span>
      <span>{props.label}</span>
    </label>
  );
}

export function StatusChip(props: { status: string; label?: string }) {
  return (
    <span className={`status-chip status-chip--${statusKind(props.status)}`}>
      {props.label ?? props.status}
    </span>
  );
}

/**
 * The report's headline number, and the three things written around it.
 *
 * All four were English literals, so the one part of a Ukrainian report a reader
 * looks at first stayed in English. The label under the number used to be the
 * scoring model's identifier, `score-v1` — a version nothing on the screen
 * explains, in place of the word for what the number is. It now says what the
 * report's own legend calls it.
 *
 * The verdict is still matched on the API's vocabulary and translated for
 * display only: `StatusChip` picks its colour from the machine word, so a
 * translated label must change what is read, never what the colour means.
 */
export function ScoreDial(props: {
  score: number | null;
  language: Language;
  verdict?: string;
  coverage?: number;
}) {
  const t = copy[props.language].report;
  const score = props.score === null ? '—' : props.score.toFixed(2);
  const verdictLabel =
    props.score === null
      ? t.insufficientData
      : props.verdict === 'normal'
        ? t.verdictNormal
        : props.verdict === 'provisional'
          ? t.verdictProvisional
          : props.verdict === 'insufficient_data'
            ? t.insufficientData
            : props.verdict === 'unavailable'
              ? t.verdictUnavailable
              : props.verdict;
  const chipStatus = props.score === null ? 'Insufficient data' : (props.verdict ?? '');
  return (
    <div
      className="score-dial"
      aria-label={
        props.score === null ? t.insufficientData : fillCopy(t.scoreValueLabel, { score })
      }
    >
      <div className="score-dial__number">{score}</div>
      <div className="score-dial__label">
        {props.score === null ? t.insufficientData : t.helpScoreTerm}
      </div>
      {verdictLabel ? <StatusChip status={chipStatus} label={verdictLabel} /> : null}
      {props.coverage !== undefined ? (
        <div className="score-dial__coverage">
          {fillCopy(t.coverageValue, { percent: (props.coverage * 100).toFixed(0) })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A bar with a percentage beside it.
 *
 * `variant` is what the bar is *about*, and it is not decoration. The default
 * `live` bar is the design system's zebra (§7): diagonal stripes, the classic
 * "this is still going" texture. A finished report has no such thing — its bars
 * are measurements of a run that ended — and a striped one at 100% next to a
 * `Completed` chip was read as a section still loading. `result` draws the same
 * geometry as one flat filled trough, and `caption` puts the word for what is
 * being measured in front of it, so the number is never a bare percentage the
 * reader has to assign a meaning to.
 *
 * The role follows the same distinction for a screen reader, which cannot see
 * the texture: `progressbar` announces a task still advancing toward its end,
 * which is a lie on a report that has already finished. `meter` is the role for
 * a static reading inside a known range, so a completed section's coverage is
 * announced as the measurement it is. Both carry the same value semantics.
 */
/**
 * `label` is required, not defaulted: the fallback used to be the literal
 * "Progress", which is the accessible name a screen reader announces — and the
 * one string on this control a Ukrainian reader would have heard in English.
 * Every caller already passes a localized one.
 */
export function ProgressBar(props: {
  value: number;
  label: string;
  variant?: 'live' | 'result';
  caption?: string;
}) {
  const value = Math.max(0, Math.min(100, props.value));
  return (
    <div
      className={props.variant === 'result' ? 'progress progress--result' : 'progress'}
      role={props.variant === 'result' ? 'meter' : 'progressbar'}
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={`${value.toFixed(0)}%`}
    >
      {props.caption === undefined ? null : (
        <span className="progress__caption">{props.caption}</span>
      )}
      <div className="progress__track">
        <div className="progress__fill" style={{ width: `${value}%` }} />
      </div>
      <span className="progress__value">{value.toFixed(0)}%</span>
    </div>
  );
}

export function Terminal(props: { lines: readonly string[]; active?: boolean }) {
  return (
    <div className="terminal" aria-live="polite">
      {props.lines.map((line, index) => (
        <div className="terminal__line" key={`${line}-${index}`}>
          <span className="terminal__prompt">fluxradar&gt;</span> {line}
        </div>
      ))}
      {props.active ? <div className="terminal__line terminal__cursor">fluxradar&gt; ▮</div> : null}
    </div>
  );
}

const ALERT_COPY: Record<Language, { title: string; close: string; details: string }> = {
  en: { title: 'FluxRadar alert', close: 'OK', details: 'Technical details' },
  uk: { title: 'Повідомлення FluxRadar', close: 'Гаразд', details: 'Технічні подробиці' },
};

export function AlertDialog(props: {
  message: string;
  details?: string;
  onClose?: () => void;
  language?: Language;
  /**
   * Pinned to the viewport and focused on arrival. The workspace's alert used to
   * render at the top of the document, so a failure answering a button at the
   * bottom of a long form appeared out of view and the click looked ignored.
   */
  floating?: boolean;
}) {
  const t = ALERT_COPY[props.language ?? 'en'];
  const closeRef = useRef<HTMLButtonElement>(null);
  const { floating, message } = props;
  useEffect(() => {
    if (floating === true) closeRef.current?.focus();
  }, [floating, message]);
  return (
    <div className={floating === true ? 'alert alert--floating' : 'alert'} role="alert">
      <div className="alert__icon">
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M5 1h2v7H5zM5 10h2v2H5z" />
        </svg>
      </div>
      <div className="alert__body">
        <strong>{t.title}</strong>
        <p>{props.message}</p>
        {props.details ? (
          <details>
            <summary>{t.details}</summary>
            <Terminal lines={[props.details]} />
          </details>
        ) : null}
        <div className="alert__actions">
          <button
            ref={closeRef}
            className="button button--primary"
            type="button"
            onClick={props.onClose}
          >
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}

/** How long a confirmation stays up before it clears itself. */
export const NOTICE_TIMEOUT_MS = 5000;

/**
 * A confirmation that something worked — "Password changed", "Status saved".
 * Pinned to the viewport for the same reason as a floating alert, announced
 * politely rather than interrupting, and gone on its own after a few seconds —
 * unless the pointer or keyboard focus is on it, which holds it for as long as
 * someone is reading it (WCAG 2.2.1); leaving restarts the full timeout.
 */
export function Notice(props: { message: string; onClose: () => void; closeLabel: string }) {
  const { message, onClose } = props;
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return undefined;
    const timer = window.setTimeout(onClose, NOTICE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [message, onClose, held]);
  return (
    <div
      className="notice"
      role="status"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <p>{message}</p>
      <button className="button" type="button" onClick={onClose}>
        {props.closeLabel}
      </button>
    </div>
  );
}

export function EmptyState(props: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M2 6h8l2 3h10v11H2zM2 6V4h7l2 3" />
        </svg>
      </div>
      <strong>{props.title}</strong>
      {props.description ? <p className="empty__description">{props.description}</p> : null}
      {props.action ? <div className="empty__action">{props.action}</div> : null}
    </div>
  );
}

export function SkeletonRows(props: { rows?: number }) {
  return (
    <div className="skeleton-list" aria-label="Loading results">
      {Array.from({ length: props.rows ?? 3 }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="loading">
      <Terminal lines={['loading…']} active />
    </div>
  );
}

export function FieldRow(props: { label: string; value: ReactNode; technical?: boolean }) {
  return (
    <div className="field-row">
      <span>{props.label}</span>
      <strong className={props.technical ? 'technical' : ''}>{props.value}</strong>
    </div>
  );
}

export function DataTable(props: { children: ReactNode }) {
  return (
    <div className="table-wrap">
      <table className="data-table">{props.children}</table>
    </div>
  );
}
