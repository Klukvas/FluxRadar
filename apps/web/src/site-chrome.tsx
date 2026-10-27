import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { FLUXLAB_URL, SUPPORT_EMAIL, createdByFluxLab } from './brand';
import type { Language } from './i18n';
import { chromeCopy, languageOptions } from './chrome-copy';
import { tourTargets } from './tour-targets';
import { WORKSPACE_PATHS, type WorkspaceTabScreen } from './workspace-paths';

/**
 * Footer attribution shared by every screen that has a footer. It sits on its
 * own row so the brand/links row above it keeps the layout it already had, and
 * it opens the studio site in a new tab — which is why it carries the
 * `noopener noreferrer` pair and says so to a screen reader.
 *
 * The label is wrapped rather than written straight into the link because the
 * shimmer that travels across it paints the *text*, and painting text means a
 * clipped background on an element of its own. The link keeps its own declared
 * colour, so a browser without `background-clip: text` — and a reader who asked
 * for less motion — still reads a plain, legible line.
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
        aria-label={`${label} (${props.language === 'uk' ? 'відкривається в новій вкладці' : 'opens in a new tab'})`}
      >
        <span className="powered-by__mark" aria-hidden="true">
          ◈
        </span>
        <span className="powered-by__label">{label}</span>
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

const MENU_LABELS: Record<Language, { site: string; app: string; open: string; close: string }> = {
  en: { site: 'Site menu', app: 'Application menu', open: 'Open menu', close: 'Close menu' },
  uk: { site: 'Меню сайту', app: 'Меню застосунку', open: 'Відкрити меню', close: 'Закрити меню' },
};

export function SiteHeader(props: MenuBarProps) {
  const isPublic = props.variant === 'public';
  // A public page learns about a session after it renders; until it does, its
  // workspace tabs look the way they do for a signed-out visitor on the home page.
  const isSignedIn = props.variant === 'public' ? (props.signedIn ?? false) : props.signedIn;
  const labels = chromeCopy[props.language].nav;
  const menuLabels = MENU_LABELS[props.language];
  const [isMenuOpen, setMenuOpen] = useState(false);
  const [isEnhanced, setEnhanced] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => setEnhanced(true), []);
  function closeMenu() {
    setMenuOpen(false);
    toggleRef.current?.focus();
  }
  useEffect(() => {
    if (isMenuOpen) closeRef.current?.focus();
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        toggleRef.current?.focus();
      } else if (event.key === 'Tab') {
        // The open sheet is modal: keep focus cycling inside it rather than
        // letting a keyboard reader walk into the page behind the menu.
        const focusables = menuRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables === undefined || focusables.length === 0) return;
        const list = Array.from(focusables);
        const first = list[0];
        const last = list[list.length - 1];
        if (first === undefined || last === undefined) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
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
      className={isEnhanced ? 'menubar is-enhanced' : 'menubar'}
      aria-label={isPublic ? menuLabels.site : menuLabels.app}
      data-tour-target={tourTargets.workspaceHeader}
    >
      {isPublic ? (
        <a
          className="menubar__apple"
          href={`/?lang=${props.language}`}
          onClick={() => setMenuOpen(false)}
        >
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
        ref={toggleRef}
        className="menubar__toggle"
        type="button"
        aria-expanded={isMenuOpen}
        aria-controls="menubar-links"
        aria-label={isMenuOpen ? menuLabels.close : menuLabels.open}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      <div
        ref={menuRef}
        id="menubar-links"
        className={isMenuOpen ? 'menubar__links is-open' : 'menubar__links'}
        role={isMenuOpen ? 'dialog' : undefined}
        aria-modal={isMenuOpen ? 'true' : undefined}
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
            ref={closeRef}
            className="menubar__close"
            type="button"
            aria-label={menuLabels.close}
            onClick={closeMenu}
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
              href={`/?lang=${props.language}`}
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
            const isActive = tab.matches.includes(props.active);
            const className = isActive ? 'menubar__item is-active' : 'menubar__item';
            // A public page cannot switch the app's screen, so a signed-in reader
            // gets a plain link; the workspace boots there with the session. The
            // language rides along, since it is only stored with consent.
            return isPublic && isSignedIn ? (
              <a
                key={tab.screen}
                className={className}
                href={`${WORKSPACE_PATHS[tab.screen]}?lang=${props.language}`}
                title={labels.descriptions[tab.label]}
                aria-current={isActive ? 'page' : undefined}
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
                aria-current={isActive ? 'page' : undefined}
                onClick={() => navigateAndClose(tab.screen)}
                disabled={!isSignedIn}
              >
                {labels[tab.label]}
              </button>
            );
          })}
          <a
            className={props.active === 'faq' ? 'menubar__item is-active' : 'menubar__item'}
            href={`/faq?lang=${props.language}`}
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
            href={`/blog?lang=${props.language}`}
            aria-current={props.active === 'blog' ? 'page' : undefined}
            onClick={() => setMenuOpen(false)}
          >
            {labels.blog}
          </a>
          <a
            className={
              props.active === 'knowledge-base' ? 'menubar__item is-active' : 'menubar__item'
            }
            aria-current={props.active === 'knowledge-base' ? 'page' : undefined}
            href="/knowledge-base"
            onClick={() => setMenuOpen(false)}
          >
            {labels.knowledgeBase}
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
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
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
    buttonRef.current?.focus();
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
      <span id="menubar-language-label" className="menubar__language-label">
        {props.label}
      </span>
      <button
        type="button"
        ref={buttonRef}
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

export function SiteFooter({ language }: { readonly language: Language }) {
  const { nav, footer } = chromeCopy[language];
  const links = [
    ['/checks', footer.coverageLink],
    ['/faq', nav.faq],
    ['/privacy', footer.privacyLink],
    ['/terms', footer.termsLink],
    ['/terms#terms-paid', footer.refundLink],
    ['/cookies', footer.cookies],
    ['/bot', footer.crawlerLink],
    ['/blog', footer.fieldNotes],
    ['/knowledge-base', nav.knowledgeBase],
  ] as const;
  return (
    <footer className="site-footer">
      <a href={`/?lang=${language}`} aria-label={`${nav.home} — ${footer.brand}`}>
        {footer.brand}
      </a>
      <span className="site-footer__links">
        {links.map(([path, label]) => {
          const [pathname, hash] = path.split('#');
          const href =
            pathname === '/knowledge-base'
              ? path
              : `${pathname}?lang=${language}${hash ? `#${hash}` : ''}`;
          return (
            <a key={path} href={href}>
              {label}
            </a>
          );
        })}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </span>
      <CreatedByFluxLab language={language} />
    </footer>
  );
}
