import type { ReactNode } from 'react';

import { MenuBar } from './components';
import { CHECKS_INDEX_RULE_BEFORE, type ChecksBullet } from './checks-copy';
import { copy, type Language } from './i18n';

// Public audit-coverage page (/checks). It shares the document shell of the
// other public pages, so /faq, /privacy, /terms and this page keep one reading
// layout, one sticky index and one set of responsive rules.

export function AuditCoverageScreen(props: {
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  const t = copy[props.language].checks;

  return (
    <div className="app-shell legal-shell">
      <MenuBar
        active="home"
        onNavigate={(next) => {
          if (next === 'home') window.location.assign('/');
        }}
        signedIn={false}
        language={props.language}
        onLanguageChange={props.onLanguageChange}
      />
      <main className="legal-main" aria-labelledby="checks-title">
        <header className="legal-header">
          <div>
            <div className="legal-kicker">
              <span className="legal-kicker__mark">✦</span>
              {t.kicker}
            </div>
            <div className="legal-meta">
              {t.meta.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <h1 id="checks-title">{t.title}</h1>
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
              <ChecksIndexEntry key={section.id} id={section.id} label={section.nav} />
            ))}
          </nav>

          <article className="legal-document" aria-label={t.documentLabel}>
            <div className="legal-document__notice">
              <span>
                <strong>{t.noticeLabel}</strong> · {t.notice}
              </span>
              <span>{t.noticeTag}</span>
            </div>

            {t.sections.map((section) => (
              <section key={section.id} id={`checks-${section.id}`} className="legal-section">
                <span className="legal-section__label">{section.label}</span>
                <h2>{section.title}</h2>
                {section.intro.map((paragraph) => (
                  <p key={paragraph}>{richText(paragraph)}</p>
                ))}
                {section.bullets.length > 0 ? (
                  <ul>
                    {section.bullets.map((bullet) => (
                      <li key={bullet.term}>{bulletContent(bullet)}</li>
                    ))}
                  </ul>
                ) : null}
                {section.outro.map((paragraph) => (
                  <p key={paragraph}>{richText(paragraph)}</p>
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
            <a href="/">{t.footerHome}</a> · <a href="/privacy">{t.footerPrivacy}</a> ·{' '}
            <a href="/terms">{t.footerTerms}</a>
          </span>
        </footer>
      </main>
    </div>
  );
}

function ChecksIndexEntry(props: { id: string; label: string }) {
  return (
    <>
      {props.id === CHECKS_INDEX_RULE_BEFORE ? <div className="legal-index__rule" /> : null}
      <a href={`#checks-${props.id}`}>{props.label}</a>
    </>
  );
}

/**
 * A bullet reads either as "Term — explanation" or as two sentences.
 *
 * Which one it is is visible in the copy itself: a term written as a full
 * sentence already ends in a full stop, and adding a dash after it would read
 * as a typo. Keeping the rule here rather than in the data means a translator
 * writes natural sentences instead of punctuation.
 */
function bulletContent(bullet: ChecksBullet): ReactNode {
  const isSentence = /[.:!?]$/.test(bullet.term);
  return (
    <>
      <strong>{bullet.term}</strong>
      {isSentence ? ' ' : ' — '}
      {richText(bullet.body)}
    </>
  );
}

/** Renders the `code` and **strong** markers the copy is allowed to use. */
function richText(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
