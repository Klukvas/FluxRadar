import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

import { FLUXLAB_URL, createdByFluxLab } from './brand';
import { copy, fillCopy, languageOptions, type Language } from './i18n';
import { statusKind } from './status-kind';
import { tourTargets } from './tour-targets';
import { WORKSPACE_PATHS, type WorkspaceTabScreen } from './workspace-paths';

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
        {/* The titlebar box is part of the desktop look, but only the windows
            that can actually be closed offer it as a control: a focusable button
            that does nothing is a promise the screen does not keep, and a
            keyboard user meets it before anything else on the screen. */}
        {props.onClose === undefined ? (
          <span className="window__box window__box--inert" aria-hidden="true">
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </span>
        ) : (
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
        )}
        <span>{props.title}</span>
      </div>
      <div className="window__content">{props.children}</div>
    </section>
  );
}

/**
 * Footer attribution shared by every screen that has a footer. It sits on its
 * own row so the brand/links row above it keeps the layout it already had, and
 * it opens the studio site in a new tab — which is why it carries the
 * `noopener noreferrer` pair and says so to a screen reader.
 */
export function CreatedByFluxLab(props: { language: Language }) {
  const label = createdByFluxLab[props.language];
  return (
    <span className="powered-by">
      <a
        className="powered-by__link"
        href={FLUXLAB_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${label} (opens in a new tab)`}
      >
        <span className="powered-by__mark" aria-hidden="true">
          ◈
        </span>
        {label}
      </a>
    </span>
  );
}

/**
 * The workspace destinations, in the order the header lists them.
 *
 * `matches` is wider than one screen for the reports tab because a report, its
 * issue list and a running scan are all reached from it, and the reader is
 * still "in reports" on each of them.
 */
const WORKSPACE_TABS: readonly {
  readonly screen: WorkspaceTabScreen;
  readonly label: 'profiles' | 'scan' | 'reports' | 'integrations';
  readonly matches: readonly string[];
}[] = [
  { screen: 'desktop', label: 'profiles', matches: ['desktop'] },
  { screen: 'new-scan', label: 'scan', matches: ['new-scan'] },
  { screen: 'reports', label: 'reports', matches: ['reports', 'results', 'issues', 'scan'] },
  { screen: 'integrations', label: 'integrations', matches: ['integrations'] },
];

/**
 * The one header the whole site ships, with one row of destinations everywhere:
 * FluxRadar, Home, the four workspace tabs, FAQ, Blog, the language switch and
 * the station line. A reader who moves between the home page, a public document
 * and the blog must not watch the navigation grow and shrink under them.
 *
 * `variant` decides how those destinations are wired, not which of them exist.
 * The `app` variant lives inside the running SPA, so it navigates through
 * `onNavigate` and enables the workspace tabs once there is a session. The
 * `public` variant is for the public documents — /faq, /checks, /privacy,
 * /terms, /cookies — and for the static blog pages that hand-write this same
 * markup, so it links out with plain `href`s. Its workspace tabs are disabled
 * for a visitor and become links into the workspace once the page learns the
 * reader has a session. The static blog never learns it and stays signed-out.
 *
 * The full row needs about 900px in English and 980px in Ukrainian, so the
 * burger takes over below 1000px (`base.css` and `public/blog/blog.css`), not
 * at the 700px phone breakpoint. Below it the row used to overflow the bar and
 * hide FAQ and Blog behind a scrollbar. A new destination or a longer label has
 * to fit that width, or the breakpoint moves in both stylesheets at once.
 */
export type MenuBarProps =
  | {
      variant: 'public';
      active: string;
      /**
       * Whether the reader has a session. A public document renders before it
       * knows, so this starts false and turns true when the session answers.
       */
      signedIn?: boolean;
      language: Language;
      onLanguageChange: (language: Language) => void;
    }
  | {
      variant?: 'app';
      active: string;
      onNavigate: (screen: string) => void;
      signedIn: boolean;
      language: Language;
      onLanguageChange: (language: Language) => void;
    };

export function MenuBar(props: MenuBarProps) {
  const isPublic = props.variant === 'public';
  // A public page learns about a session after it renders; until it does, its
  // workspace tabs look the way they do for a signed-out visitor on the home page.
  const isSignedIn = props.variant === 'public' ? (props.signedIn ?? false) : props.signedIn;
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
    if (props.variant !== 'public') props.onNavigate(screen);
    setMenuOpen(false);
  }

  return (
    <nav
      className="menubar"
      aria-label={isPublic ? 'Site menu' : 'Application menu'}
      data-tour-target={tourTargets.workspaceHeader}
    >
      {isPublic ? (
        <a className="menubar__apple" href="/" onClick={() => setMenuOpen(false)}>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 1h2v2h2V1h2v2h2v2H9v2h2v2H9v2H7V9H5v2H3V9H1V7h2V5H1V3h2z" />
          </svg>
          FluxRadar
        </a>
      ) : (
        <button className="menubar__apple" type="button" onClick={() => navigateAndClose('home')}>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 1h2v2h2V1h2v2h2v2H9v2h2v2H9v2H7V9H5v2H3V9H1V7h2V5H1V3h2z" />
          </svg>
          FluxRadar
        </button>
      )}
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
      <div
        id="menubar-links"
        className={isMenuOpen ? 'menubar__links is-open' : 'menubar__links'}
        data-tour-target={tourTargets.workspaceTabs}
      >
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
          <span className="menubar__group-label">{labels.navigateGroup}</span>
          {isPublic ? (
            <a
              className={props.active === 'home' ? 'menubar__item is-active' : 'menubar__item'}
              href="/"
              aria-current={props.active === 'home' ? 'page' : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {labels.home}
            </a>
          ) : (
            <button
              className={props.active === 'home' ? 'menubar__item is-active' : 'menubar__item'}
              type="button"
              onClick={() => navigateAndClose('home')}
            >
              {labels.home}
            </button>
          )}
          {WORKSPACE_TABS.map((tab) => {
            const className = tab.matches.includes(props.active)
              ? 'menubar__item is-active'
              : 'menubar__item';
            // A public page cannot switch the app's screen, so a signed-in reader
            // gets a plain link; the workspace boots there with the session. The
            // language rides along, since it is only stored with consent.
            return isPublic && isSignedIn ? (
              <a
                key={tab.screen}
                className={className}
                href={`${WORKSPACE_PATHS[tab.screen]}?lang=${props.language}`}
                title={labels.descriptions[tab.label]}
                onClick={() => setMenuOpen(false)}
              >
                {labels[tab.label]}
              </a>
            ) : (
              <button
                key={tab.screen}
                className={className}
                type="button"
                title={labels.descriptions[tab.label]}
                onClick={() => navigateAndClose(tab.screen)}
                disabled={!isSignedIn}
              >
                {labels[tab.label]}
              </button>
            );
          })}
          <a
            className={props.active === 'faq' ? 'menubar__item is-active' : 'menubar__item'}
            href="/faq"
            title={labels.descriptions.faq}
            aria-current={props.active === 'faq' ? 'page' : undefined}
            onClick={() => setMenuOpen(false)}
          >
            {labels.faq}
          </a>
          <a
            className={
              props.active === 'blog'
                ? 'menubar__item menubar__blog-link is-active'
                : 'menubar__item menubar__blog-link'
            }
            href="/blog"
            aria-current={props.active === 'blog' ? 'page' : undefined}
            onClick={() => setMenuOpen(false)}
          >
            {labels.blog}
          </a>
          <span className="menubar__spacer" />
        </div>
        <div className="menubar__meta">
          <span className="menubar__group-label">{labels.systemGroup}</span>
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
  /** Renders the value in monospace; see `controlClass`. */
  technical?: boolean;
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
  hint?: string;
  name?: string;
  autoComplete?: string;
  rows?: number;
}) {
  return (
    <label className="field">
      <span className="field__label">{props.label}</span>
      <textarea
        className="control"
        name={props.name}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
        rows={props.rows ?? 3}
      />
      {props.hint ? <span className="field__hint">{props.hint}</span> : null}
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
}) {
  return (
    <label className={props.className === undefined ? 'checkbox' : `checkbox ${props.className}`}>
      <span className="checkbox__control">
        <input
          type="checkbox"
          name={props.name}
          checked={props.checked}
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
