import { useEffect, useRef } from 'react';

import type { Account } from './api';
import { AuthScreen } from './AuthScreen';
import { Button, CreatedByFluxLab, MenuBar, StatusChip, Terminal } from './components';
import { CoverageTicker } from './CoverageTicker';
import { HeroSiteForm } from './HeroSiteForm';
import { HeroTitle } from './HeroTitle';
import { copy, type Language } from './i18n';
import { PricingCards, PricingExplainer, type ChosenPlan } from './Pricing';

export function HomeScreen(props: {
  signedIn: boolean;
  accountEmail?: string;
  onStart: () => void;
  /** The hero form: the site the visitor typed, or null for an empty field. */
  onStartSite: (site: string | null) => void;
  onChoosePlan: (plan: ChosenPlan) => void;
  /** The site the visitor typed, named in the registration dialog. */
  pendingSite?: string | null;
  onLogin: () => void;
  onRegister: () => void;
  onOpenWorkspace: () => void;
  /**
   * Opens the workspace screen a header tab names. The header enables all four
   * tabs for a signed-in reader, so each of them needs somewhere to go.
   */
  onOpenScreen?: (screen: string) => void;
  /** Section to reveal on entry when an old link pointed at a folded-in page. */
  scrollTo?: 'pricing' | null;
  language: Language;
  onLanguageChange: (language: Language) => void;
  authOpen: boolean;
  authAction: { readonly kind: 'verify' | 'reset'; readonly token: string } | null;
  authMode: 'login' | 'register';
  authError: string | null;
  onAuthError: (value: string | null) => void;
  onAuthed: (account: Account) => Promise<void>;
  onCloseAuth: () => void;
}) {
  const authDialogRef = useRef<HTMLDivElement>(null);
  const t = copy[props.language];
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start' });
  const entrySection = props.scrollTo ?? null;
  // A visitor arriving from an old /plans link should land on the pricing block
  // and keep a clean URL, not stay on a path the app no longer serves.
  useEffect(() => {
    if (entrySection === null) return;
    if (window.location.pathname !== '/') window.history.replaceState(null, '', '/');
    document.getElementById(entrySection)?.scrollIntoView({ block: 'start' });
  }, [entrySection]);
  useEffect(() => {
    if (!props.authOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onCloseAuth();
      if (event.key !== 'Tab') return;
      const focusable = authDialogRef.current?.querySelectorAll<HTMLElement>(
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
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    window.requestAnimationFrame(() =>
      authDialogRef.current?.querySelector<HTMLElement>('input, button')?.focus(),
    );
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [props.authOpen, props.onCloseAuth]);
  return (
    <div className="app-shell home-shell">
      <MenuBar
        active="home"
        onNavigate={(next) => (next === 'home' ? scrollTo('top') : props.onOpenScreen?.(next))}
        signedIn={props.signedIn}
        language={props.language}
        onLanguageChange={props.onLanguageChange}
      />
      <main className="home" id="top">
        <div className="home__account-bar">
          <span className="home__account-label">{t.home.accountBar}</span>
          {props.signedIn ? (
            <div className="home__account-actions">
              <span className="home__account-email technical">{props.accountEmail}</span>
              <Button variant="primary" onClick={props.onOpenWorkspace}>
                {t.home.openWorkspace}
              </Button>
            </div>
          ) : (
            <div className="home__account-actions">
              <Button onClick={props.onLogin}>{t.home.signIn}</Button>
              <Button variant="primary" onClick={props.onRegister}>
                {t.home.createAccount}
              </Button>
            </div>
          )}
        </div>
        <section className="home__hero" aria-labelledby="home-title">
          <div className="home__hero-copy">
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">01</span> {t.home.hero.eyebrow}
            </div>
            {/* Keyed by language so a switch retypes the new title from the
                start instead of leaving half of it already revealed. */}
            <HeroTitle
              key={props.language}
              id="home-title"
              line={t.home.hero.titleLine1}
              emphasis={t.home.hero.titleEm}
            />
            <p className="home__lede">{t.home.hero.lede}</p>
            <HeroSiteForm
              language={props.language}
              submitLabel={t.home.freeCta}
              onStart={props.onStartSite}
            />
            <div className="home__actions">
              <button
                className="home__text-action"
                type="button"
                onClick={() => scrollTo('pricing')}
              >
                {t.home.seePricing} <span aria-hidden="true">↓</span>
              </button>
            </div>
            <div className="home__proof" aria-label={t.home.hero.proofAriaLabel}>
              <span>
                <strong>01</strong> {t.home.hero.proofScan}
              </span>
              <span>
                <strong>06</strong> {t.home.hero.proofSignals}
              </span>
              <span>
                <strong>02</strong> {t.home.hero.proofTiers}
              </span>
            </div>
          </div>
          <div className="home__instrument" aria-label={t.home.instrument.previewAriaLabel}>
            <div className="home__instrument-bar">
              <span className="home__live-dot" /> {t.home.instrument.live}{' '}
              <span className="home__instrument-mode">{t.home.instrument.mode}</span>
            </div>
            <div className="home__instrument-body">
              <div className="home__origin">
                <span className="home__label">{t.home.instrument.originLabel}</span>
                <strong className="technical">https://your-site.com</strong>
                <StatusChip status="Running" label={t.home.instrument.statusRunning} />
              </div>
              <div className="home__readout">
                <div className="home__readout-cell">
                  <span className="home__label">{t.home.instrument.signalScore}</span>
                  <strong>—</strong>
                  <small>{t.home.instrument.signalScoreHint}</small>
                </div>
                <div className="home__readout-cell">
                  <span className="home__label">{t.home.instrument.coverage}</span>
                  <strong>—</strong>
                  <small>{t.home.instrument.coverageHint}</small>
                </div>
                <div className="home__readout-cell">
                  <span className="home__label">{t.home.instrument.findings}</span>
                  <strong>—</strong>
                  <small>{t.home.instrument.findingsHint}</small>
                </div>
              </div>
              <Terminal lines={[...t.home.instrument.terminalLines]} active />
              <div className="home__module-list" aria-label={t.home.instrument.modulesAriaLabel}>
                <span>
                  <i className="home__module-mark home__module-mark--green" />{' '}
                  {t.home.instrument.moduleSeo}
                </span>
                <span>
                  <i className="home__module-mark home__module-mark--cyan" />{' '}
                  {t.home.instrument.moduleAiSeo}
                </span>
                <span>
                  <i className="home__module-mark home__module-mark--amber" />{' '}
                  {t.home.instrument.moduleSecurity}
                </span>
                <span>
                  <i className="home__module-mark home__module-mark--dim" />{' '}
                  {t.home.instrument.moduleMore}
                </span>
              </div>
            </div>
          </div>
        </section>

        <CoverageTicker
          label={t.home.ticker.ariaLabel}
          items={[
            t.home.ticker.seo,
            t.home.ticker.aiSeo,
            t.home.ticker.security,
            t.home.ticker.accessibility,
            t.home.ticker.reliability,
            t.home.ticker.privacy,
          ]}
        />

        <section className="home__section" id="capabilities" aria-labelledby="capabilities-title">
          <div className="home__section-head">
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">02</span> {t.home.capabilities.eyebrow}
            </div>
            <h2 id="capabilities-title">{t.home.capabilities.title}</h2>
            <p>{t.home.capabilities.lead}</p>
          </div>
          <div className="home__capability-grid">
            <article className="home__capability home__capability--green">
              <span className="home__card-index">{t.home.capabilities.seo.index}</span>
              <h3>{t.home.capabilities.seo.title}</h3>
              <p>{t.home.capabilities.seo.body}</p>
              <span className="home__card-foot">{t.home.capabilities.seo.foot}</span>
            </article>
            <article className="home__capability home__capability--cyan">
              <span className="home__card-index">{t.home.capabilities.ai.index}</span>
              <h3>{t.home.capabilities.ai.title}</h3>
              <p>{t.home.capabilities.ai.body}</p>
              <span className="home__card-foot">{t.home.capabilities.ai.foot}</span>
            </article>
            <article className="home__capability home__capability--amber">
              <span className="home__card-index">{t.home.capabilities.integrity.index}</span>
              <h3>{t.home.capabilities.integrity.title}</h3>
              <p>{t.home.capabilities.integrity.body}</p>
              <span className="home__card-foot">{t.home.capabilities.integrity.foot}</span>
            </article>
          </div>
        </section>

        <section className="home__coverage-entry" aria-labelledby="coverage-entry-title">
          <div className="home__coverage-entry-inner">
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">02b</span> {t.home.coverageEntry.eyebrow}
            </div>
            <h2 id="coverage-entry-title">{t.home.coverageEntry.title}</h2>
            <p>{t.home.coverageEntry.body}</p>
            <a className="home__coverage-link" href="/checks">
              {t.pricing.coverageLink}
            </a>
          </div>
        </section>

        <section className="home__workflow" aria-labelledby="workflow-title">
          <div className="home__workflow-copy">
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">03</span> {t.home.workflow.eyebrow}
            </div>
            <h2 id="workflow-title">{t.home.workflow.title}</h2>
            <p>{t.home.workflow.lead}</p>
            <Button onClick={props.onStart}>{t.home.startPublicSite}</Button>
          </div>
          <div className="home__steps">
            <div className="home__step">
              <strong>01</strong>
              <div>
                <h3>{t.home.workflow.step1Title}</h3>
                <p>{t.home.workflow.step1Body}</p>
              </div>
            </div>
            <div className="home__step">
              <strong>02</strong>
              <div>
                <h3>{t.home.workflow.step2Title}</h3>
                <p>{t.home.workflow.step2Body}</p>
              </div>
            </div>
            <div className="home__step">
              <strong>03</strong>
              <div>
                <h3>{t.home.workflow.step3Title}</h3>
                <p>{t.home.workflow.step3Body}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="home__pricing" id="pricing" aria-labelledby="pricing-title">
          <div className="home__section-head">
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">04</span> {t.home.pricingEyebrow}
            </div>
            <h2 id="pricing-title">{t.home.pricingTitle}</h2>
            <p>{t.home.pricingLead}</p>
            <span className="home__pricing-note home__pricing-note--public">
              {t.pricing.publicOnly}
            </span>
          </div>
          <PricingCards language={props.language} onChoose={props.onChoosePlan} />
          <PricingExplainer language={props.language} />
        </section>

        <section className="home__last-call" aria-labelledby="last-call-title">
          <div>
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">05</span> {t.home.lastCall.eyebrow}
            </div>
            <h2 id="last-call-title">
              {t.home.lastCall.titleLine1}
              <br />
              <em>{t.home.lastCall.titleEm}</em>
            </h2>
          </div>
          <Button variant="primary" onClick={props.onStart}>
            {t.home.lastCall.cta} <span aria-hidden="true">→</span>
          </Button>
        </section>
        <footer className="home__footer">
          <span>{t.home.footer.brand}</span>
          <span className="home__footer-links">
            <a href="/checks">{t.home.footer.coverageLink}</a>
            <a href="/faq">{t.nav.faq}</a>
            <a href="/privacy">{t.home.footer.privacyLink}</a>
            <a href="/terms">{t.home.footer.termsLink}</a>
            <a href="/terms#terms-paid">{t.home.footer.refundLink}</a>
            <a href="/cookies">{t.legal.cookies.title}</a>
            <a href="/bot">{t.home.footer.crawlerLink}</a>
            <a href="/blog">{t.home.footer.fieldNotes}</a>
            <span>{t.nav.system}</span>
          </span>
          <CreatedByFluxLab language={props.language} />
        </footer>
      </main>
      {props.authOpen ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) props.onCloseAuth();
          }}
        >
          <div
            ref={authDialogRef}
            className="auth-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-title"
          >
            <AuthScreen
              language={props.language}
              onAuthed={props.onAuthed}
              error={props.authError}
              onError={props.onAuthError}
              onBack={props.onCloseAuth}
              initialMode={props.authMode}
              emailAction={props.authAction}
              pendingSite={props.pendingSite ? new URL(props.pendingSite).hostname : null}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
