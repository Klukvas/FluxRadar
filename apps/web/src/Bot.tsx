import { type ReactNode } from 'react';

import { MenuBar, CreatedByFluxLab } from './components';
import type { BotBullet, BotSection } from './bot-copy';
import { copy, type Language } from './i18n';

// Public crawler page (/bot). It shares the document shell of the other public
// pages, so /faq, /checks, /privacy, /terms and this page keep one reading
// layout, one sticky index and one set of responsive rules.
//
// Its reader is not a customer. It is somebody who found
// `FluxRadarBot/0.1 (+https://fluxradar.net/bot)` in an access log, or who was
// told by a scan report that their site refused us, and who wants to decide
// within about a minute whether to allow it. So the page states the address and
// the user agent early, and carries the rules to paste rather than describing
// them.

export function BotScreen(props: {
  language: Language;
  onLanguageChange: (language: Language) => void;
  /** Whether the reader has a session; false until the app knows. See `MenuBar`. */
  signedIn?: boolean;
}) {
  const t = copy[props.language].bot;

  return (
    <div className="app-shell legal-shell">
      <MenuBar
        variant="public"
        active="bot"
        signedIn={props.signedIn}
        language={props.language}
        onLanguageChange={props.onLanguageChange}
      />
      <main className="legal-main" aria-labelledby="bot-title">
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
            <h1 id="bot-title">{t.title}</h1>
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
              <a key={section.id} href={`#bot-${section.id}`}>
                {section.nav}
              </a>
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
              <BotSectionBlock key={section.id} section={section} />
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
            <a href="/terms">{t.footerTerms}</a> ·{' '}
            <a href={`/cookies?lang=${props.language}`}>
              {copy[props.language].legal.cookies.title}
            </a>
          </span>
          <CreatedByFluxLab language={props.language} />
        </footer>
      </main>
    </div>
  );
}

function BotSectionBlock(props: { section: BotSection }) {
  const { section } = props;
  return (
    <section id={`bot-${section.id}`} className="legal-section">
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
      {section.snippet === undefined ? null : (
        <figure className="legal-snippet">
          <figcaption>{section.snippet.caption}</figcaption>
          {/* Rendered verbatim, and selectable: this is meant to be copied into
              somebody else's configuration, so reformatting it would be a bug. */}
          <pre>
            <code>{section.snippet.body}</code>
          </pre>
        </figure>
      )}
      {section.outro.map((paragraph) => (
        <p key={paragraph}>{richText(paragraph)}</p>
      ))}
    </section>
  );
}

/** A bullet reads as "Term — explanation"; see the same rule in `Checks.tsx`. */
function bulletContent(bullet: BotBullet): ReactNode {
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
