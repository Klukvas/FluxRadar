import { useEffect } from 'react';

import { MenuBar } from './components';
import { copy, type Language } from './i18n';

// Public FAQ page (/faq). It reuses the document shell of the other public
// pages, so the reading layout, the sticky index and the responsive rules stay
// identical across /checks, /privacy, /terms and this page.

export function FaqScreen(props: {
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  const t = copy[props.language].faq;
  useEffect(() => {
    const previousTitle = document.title;
    document.title = t.documentTitle;
    return () => {
      document.title = previousTitle;
    };
  }, [t.documentTitle]);

  return (
    <div className="app-shell legal-shell">
      <MenuBar
        active="faq"
        onNavigate={(next) => {
          if (next === 'home') window.location.assign('/');
        }}
        signedIn={false}
        language={props.language}
        onLanguageChange={props.onLanguageChange}
      />
      <main className="legal-main" aria-labelledby="faq-title">
        <header className="legal-header">
          <div>
            <div className="legal-kicker">
              <span className="legal-kicker__mark">?</span>
              {t.kicker}
            </div>
            <div className="legal-meta">
              {t.meta.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <h1 id="faq-title">{t.title}</h1>
            <p className="legal-lede">{t.lede}</p>
          </div>
          <a className="legal-back" href="/">
            {t.back}
          </a>
        </header>

        <div className="legal-layout">
          <nav className="legal-index" aria-label={t.contents}>
            <span className="legal-index__label">{t.contents}</span>
            {t.sections.map((section) => (
              <a key={section.id} href={`#faq-${section.id}`}>
                {section.nav}
              </a>
            ))}
          </nav>

          <article className="legal-document" aria-label={t.title}>
            <div className="legal-document__notice">
              <span>
                <strong>{t.noticeLabel}</strong> · {t.notice}
              </span>
              <span>{t.noticeTag}</span>
            </div>

            {t.sections.map((section) => (
              <section key={section.id} id={`faq-${section.id}`} className="legal-section">
                <span className="legal-section__label">{section.label}</span>
                <h2>{section.title}</h2>
                {section.entries.map((entry) => (
                  <div className="faq-entry" key={entry.question}>
                    <h3>{entry.question}</h3>
                    {entry.answer.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                ))}
              </section>
            ))}

            <section className="legal-section">
              <p>
                {t.contact} <a href={`mailto:${t.contactEmail}`}>{t.contactEmail}</a>
              </p>
            </section>
          </article>
        </div>

        <footer className="legal-footer">
          <span>{t.footerBrand}</span>
          <span>
            <a href="/">{t.footerHome}</a> · <a href="/checks">{t.footerCoverage}</a> ·{' '}
            <a href="/privacy">{t.footerPrivacy}</a> · <a href="/terms">{t.footerTerms}</a>
          </span>
        </footer>
      </main>
    </div>
  );
}
