import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import { copy, languageOptions, type Language } from './i18n';

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
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  const labels = copy[props.language].nav;
  const [isMenuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMenuOpen]);

  const activeLanguageLabel =
    languageOptions.find((option) => option.value === props.language)?.label ?? props.language;

  function navigateAndClose(screen: string) {
    props.onNavigate(screen);
    setMenuOpen(false);
  }

  return (
    <nav className="menubar" aria-label="Application menu">
      <button className="menubar__apple" type="button" onClick={() => navigateAndClose('home')}>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 1h2v2h2V1h2v2h2v2H9v2h2v2H9v2H7V9H5v2H3V9H1V7h2V5H1V3h2z" />
        </svg>
        FluxRadar
      </button>
      <button
        className="menubar__toggle"
        type="button"
        aria-expanded={isMenuOpen}
        aria-controls="menubar-links"
        aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      <div id="menubar-links" className={isMenuOpen ? 'menubar__links is-open' : 'menubar__links'}>
        <div className="menubar__sheet-head">
          <span className="menubar__sheet-brand">
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 1h2v2h2V1h2v2h2v2H9v2h2v2H9v2H7V9H5v2H3V9H1V7h2V5H1V3h2z" />
            </svg>
            FluxRadar
          </span>
          <span className="menubar__sheet-status">{labels.system}</span>
          <button
            className="menubar__close"
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </button>
        </div>
        <div className="menubar__nav">
          <span className="menubar__group-label">Navigate</span>
          <button
            className={props.active === 'home' ? 'menubar__item is-active' : 'menubar__item'}
            type="button"
            onClick={() => navigateAndClose('home')}
          >
            {labels.home}
          </button>
          <button
            className={props.active === 'desktop' ? 'menubar__item is-active' : 'menubar__item'}
            type="button"
            data-tour-target="files-tab"
            title={labels.descriptions.files}
            onClick={() => navigateAndClose('desktop')}
            disabled={!props.signedIn}
          >
            {labels.files}
          </button>
          <button
            className={props.active === 'new-scan' ? 'menubar__item is-active' : 'menubar__item'}
            type="button"
            data-tour-target="scan-tab"
            title={labels.descriptions.scan}
            onClick={() => navigateAndClose('new-scan')}
            disabled={!props.signedIn}
          >
            {labels.scan}
          </button>
          <button
            className={
              props.active === 'results' || props.active === 'issues'
                ? 'menubar__item is-active'
                : 'menubar__item'
            }
            type="button"
            data-tour-target="reports-tab"
            title={labels.descriptions.reports}
            onClick={() => navigateAndClose('results')}
            disabled={!props.signedIn}
          >
            {labels.reports}
          </button>
          <button
            className={
              props.active === 'integrations' ? 'menubar__item is-active' : 'menubar__item'
            }
            type="button"
            data-tour-target="integrations-tab"
            title={labels.descriptions.integrations}
            onClick={() => navigateAndClose('integrations')}
            disabled={!props.signedIn}
          >
            {labels.integrations}
          </button>
          <button
            className={props.active === 'plans' ? 'menubar__item is-active' : 'menubar__item'}
            type="button"
            data-tour-target="plans-tab"
            title={labels.descriptions.plans}
            onClick={() => navigateAndClose('plans')}
          >
            {labels.plans}
          </button>
          <a
            className="menubar__item menubar__blog-link"
            href="/blog"
            onClick={() => setMenuOpen(false)}
          >
            {labels.blog}
          </a>
          <span className="menubar__spacer" />
        </div>
        <div className="menubar__meta">
          <span className="menubar__group-label">System</span>
          <LanguageSwitcher
            label={labels.language}
            language={props.language}
            activeLanguageLabel={activeLanguageLabel}
            onLanguageChange={props.onLanguageChange}
          />
          <span className="menubar__system">{labels.system}</span>
        </div>
      </div>
    </nav>
  );
}

function LanguageSwitcher(props: {
  label: string;
  language: Language;
  activeLanguageLabel: string;
  onLanguageChange: (language: Language) => void;
}) {
  const [isOpen, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      languageOptions.findIndex((option) => option.value === props.language),
    ),
  );
  const listboxId = 'menubar-language-listbox';
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isOpen]);

  function openAt(index: number) {
    setActiveIndex(index);
    setOpen(true);
  }

  function selectOption(index: number) {
    const option = languageOptions[index];
    if (!option) return;
    props.onLanguageChange(option.value);
    setActiveIndex(index);
    setOpen(false);
  }

  function onButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAt(
        isOpen
          ? Math.min(activeIndex + 1, languageOptions.length - 1)
          : languageOptions.findIndex((option) => option.value === props.language),
      );
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAt(Math.max(activeIndex - 1, 0));
    }
  }

  function onOptionKeyDown(event: ReactKeyboardEvent<HTMLLIElement>, index: number) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(Math.min(index + 1, languageOptions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(Math.max(index - 1, 0));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectOption(index);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div className="menubar__language" ref={containerRef}>
      <span id="menubar-language-label">{props.label}</span>
      <button
        type="button"
        role="combobox"
        className="menubar__language-button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-labelledby="menubar-language-label"
        onClick={() => (isOpen ? setOpen(false) : openAt(activeIndex))}
        onKeyDown={onButtonKeyDown}
      >
        {props.activeLanguageLabel}
        <svg viewBox="0 0 10 6" aria-hidden="true" className="menubar__language-caret">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {isOpen ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-labelledby="menubar-language-label"
          className="menubar__language-listbox"
        >
          {languageOptions.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === props.language}
              tabIndex={index === activeIndex ? 0 : -1}
              className={
                index === activeIndex
                  ? 'menubar__language-option is-active'
                  : 'menubar__language-option'
              }
              ref={(node) => {
                if (index === activeIndex) node?.focus();
              }}
              onClick={() => selectOption(index)}
              onKeyDown={(event) => onOptionKeyDown(event, index)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
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
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
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
      data-tour-target={props['data-tour-target']}
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
  hint?: string;
  'data-tour-target'?: string;
}) {
  return (
    <label className="field" data-tour-target={props['data-tour-target']}>
      <span className="field__label">{props.label}</span>
      <input
        className={props.error ? 'control control--error' : 'control'}
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
      />
      {props.hint ? <span className="field__hint">{props.hint}</span> : null}
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

export function StatusChip(props: { status: string; label?: string }) {
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
  return <span className={`status-chip status-chip--${kind}`}>{props.label ?? props.status}</span>;
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
    <div
      className="progress"
      role="progressbar"
      aria-label={props.label ?? 'Progress'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={`${value.toFixed(0)}%`}
    >
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
