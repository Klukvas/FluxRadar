import type { ReactNode } from 'react';

export function Window(props: {
  title: string;
  children: ReactNode;
  terminal?: boolean;
  className?: string;
  onClose?: () => void;
}) {
  return (
    <section
      className={`window ${props.terminal ? 'window--terminal' : ''} ${props.className ?? ''}`}
    >
      <div className="window__titlebar">
        <button
          className="window__box"
          aria-label="Close window"
          type="button"
          onClick={props.onClose}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
        <span>{props.title}</span>
      </div>
      <div className="window__content">{props.children}</div>
    </section>
  );
}

export function MenuBar(props: {
  active: string;
  onNavigate: (screen: string) => void;
  signedIn: boolean;
}) {
  return (
    <nav className="menubar" aria-label="Application menu">
      <button className="menubar__apple" type="button" onClick={() => props.onNavigate('home')}>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 1h2v2h2V1h2v2h2v2H9v2h2v2H9v2H7V9H5v2H3V9H1V7h2V5H1V3h2z" />
        </svg>
        FluxRadar
      </button>
      <button
        className={props.active === 'home' ? 'menubar__item is-active' : 'menubar__item'}
        type="button"
        onClick={() => props.onNavigate('home')}
      >
        Home
      </button>
      <button
        className={props.active === 'desktop' ? 'menubar__item is-active' : 'menubar__item'}
        type="button"
        onClick={() => props.onNavigate(props.signedIn ? 'desktop' : 'home')}
      >
        File
      </button>
      <button
        className={props.active === 'new-scan' ? 'menubar__item is-active' : 'menubar__item'}
        type="button"
        onClick={() => props.onNavigate('new-scan')}
        disabled={!props.signedIn}
      >
        Scan
      </button>
      <button
        className={
          props.active === 'results' || props.active === 'issues'
            ? 'menubar__item is-active'
            : 'menubar__item'
        }
        type="button"
        onClick={() => props.onNavigate('results')}
        disabled={!props.signedIn}
      >
        Reports
      </button>
      <button
        className={props.active === 'integrations' ? 'menubar__item is-active' : 'menubar__item'}
        type="button"
        onClick={() => props.onNavigate('integrations')}
        disabled={!props.signedIn}
      >
        Integrations
      </button>
      <span className="menubar__spacer" />
      <span className="menubar__system">PUBLIC WEB AUDIT STATION · v0.1</span>
    </nav>
  );
}

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
}) {
  return (
    <button
      className={`button button--${props.variant ?? 'default'}`}
      type={props.type ?? 'button'}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  error?: string;
}) {
  return (
    <label className="field">
      <span className="field__label">{props.label}</span>
      <input
        className={props.error ? 'control control--error' : 'control'}
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
      />
      {props.error ? <span className="field__error">{props.error}</span> : null}
    </label>
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <label className="field">
      <span className="field__label">{props.label}</span>
      <select
        className="control"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Checkbox(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="checkbox">
      <span className="checkbox__control">
        <input
          type="checkbox"
          checked={props.checked}
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

export function StatusChip(props: { status: string }) {
  const kind = /failed|critical|error/i.test(props.status)
    ? 'error'
    : /high/i.test(props.status)
      ? 'high'
      : /partial|warning|medium|provisional/i.test(props.status)
        ? 'warning'
        : /completed|pass|ok|low/i.test(props.status)
          ? 'ok'
          : /running|queued|info/i.test(props.status)
            ? 'info'
            : 'neutral';
  return <span className={`status-chip status-chip--${kind}`}>{props.status}</span>;
}

export function ScoreDial(props: { score: number | null; verdict?: string; coverage?: number }) {
  const score = props.score === null ? '—' : props.score.toFixed(2);
  const verdict =
    props.score === null
      ? 'Insufficient data'
      : props.verdict === 'normal'
        ? 'Completed'
        : props.verdict === 'provisional'
          ? 'Provisional'
          : props.verdict === 'insufficient_data'
            ? 'Insufficient data'
            : props.verdict === 'unavailable'
              ? 'Unavailable'
              : props.verdict;
  return (
    <div
      className="score-dial"
      aria-label={props.score === null ? 'Insufficient data' : `Score ${score}`}
    >
      <div className="score-dial__number">{score}</div>
      <div className="score-dial__label">
        {props.score === null ? 'Insufficient data' : 'score-v1'}
      </div>
      {verdict ? <StatusChip status={verdict} /> : null}
      {props.coverage !== undefined ? (
        <div className="score-dial__coverage">coverage {(props.coverage * 100).toFixed(0)}%</div>
      ) : null}
    </div>
  );
}

export function ProgressBar(props: { value: number; label?: string }) {
  const value = Math.max(0, Math.min(100, props.value));
  return (
    <div className="progress" aria-label={props.label ?? 'Progress'}>
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

export function AlertDialog(props: { message: string; details?: string; onClose?: () => void }) {
  return (
    <div className="alert" role="alert">
      <div className="alert__icon">
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M5 1h2v7H5zM5 10h2v2H5z" />
        </svg>
      </div>
      <div className="alert__body">
        <strong>FluxRadar alert</strong>
        <p>{props.message}</p>
        {props.details ? (
          <details>
            <summary>Technical details</summary>
            <Terminal lines={[props.details]} />
          </details>
        ) : null}
        <div className="alert__actions">
          <Button variant="primary" onClick={props.onClose}>
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}

export function EmptyState(props: { title: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M2 6h8l2 3h10v11H2zM2 6V4h7l2 3" />
        </svg>
      </div>
      <strong>{props.title}</strong>
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
