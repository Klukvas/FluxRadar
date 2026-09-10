import { useEffect } from 'react';
import type { JSX, MouseEvent } from 'react';

import { CreatedByFluxLab, MenuBar } from './components';
import { CookiePolicy } from './legal/CookiePolicy';
import { PrivacyPolicy } from './legal/PrivacyPolicy';
import { SupportLink } from './legal/SharedLegal';
import { TermsOfService } from './legal/TermsOfService';
import { copy, type Language } from './i18n';

export type LegalDocumentKind = 'privacy' | 'terms' | 'cookies';

export type LegalDocumentScreenProps = {
  readonly kind: LegalDocumentKind;
  readonly language: Language;
  readonly onLanguageChange: (language: Language) => void;
  readonly onHome?: () => void;
};

const DOCUMENT_MARKS: Readonly<Record<LegalDocumentKind, string>> = {
  privacy: 'P',
  terms: 'T',
  cookies: 'C',
};

const DOCUMENT_PATHS: Readonly<Record<LegalDocumentKind, string>> = {
  privacy: '/privacy',
  terms: '/terms',
  cookies: '/cookies',
};

function LegalBody(props: {
  readonly kind: LegalDocumentKind;
  readonly language: Language;
}): JSX.Element {
  if (props.kind === 'privacy') return <PrivacyPolicy language={props.language} />;
  if (props.kind === 'terms') return <TermsOfService language={props.language} />;
  return <CookiePolicy language={props.language} />;
}

export function LegalDocumentScreen(props: LegalDocumentScreenProps): JSX.Element {
  const t = copy[props.language].legal;
  const documentCopy = t[props.kind];
  const goHome = (): void => {
    if (props.onHome) props.onHome();
    else window.location.assign('/');
  };
  const handleHomeClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (
      !props.onHome ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    props.onHome();
  };

  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id !== '') document.getElementById(id)?.scrollIntoView();
  }, [props.kind]);

  return (
    <div className="app-shell legal-shell">
      <MenuBar
        active="home"
        onNavigate={(next) => {
          if (next === 'home') goHome();
        }}
        signedIn={false}
        language={props.language}
        onLanguageChange={props.onLanguageChange}
      />
      <main className="legal-main">
        <header className="legal-header">
          <div>
            <div className="legal-kicker">
              <span className="legal-kicker__mark">{DOCUMENT_MARKS[props.kind]}</span>
              {t.kicker}
            </div>
            <div className="legal-meta">
              {t.meta.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <h1>{documentCopy.title}</h1>
            <p className="legal-lede">{documentCopy.lede}</p>
          </div>
          <a className="legal-back" href="/" onClick={handleHomeClick}>
            {t.back}
          </a>
        </header>
        <div className="legal-layout">
          <nav className="legal-index" aria-label={t.contentsLabel}>
            <div className="legal-index__label">{t.contents}</div>
            {documentCopy.sections.map((section) => (
              <a key={section.id} href={`#${section.id}`}>
                {section.label}
              </a>
            ))}
            <div className="legal-index__rule" />
            {(['privacy', 'terms', 'cookies'] as const)
              .filter((kind) => kind !== props.kind)
              .map((kind) => (
                <a key={kind} href={`${DOCUMENT_PATHS[kind]}?lang=${props.language}`}>
                  {t[kind].crossLink}
                </a>
              ))}
          </nav>
          <div className="legal-document-column">
            <p className="legal-language-notice" lang={props.language}>
              {t.languageNotice}
            </p>
            <LegalBody kind={props.kind} language={props.language} />
          </div>
        </div>
        <footer className="legal-footer">
          <span>{t.footerBrand}</span>
          <span>
            {t.questions} <SupportLink />
          </span>
          <CreatedByFluxLab language={props.language} />
        </footer>
      </main>
    </div>
  );
}
