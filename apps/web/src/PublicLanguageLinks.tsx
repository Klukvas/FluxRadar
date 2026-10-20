import type { Language } from './i18n';
import { publicPagePath, type PublicPageId } from './public-page-routing';
import './styles/public-language.css';

export function PublicLanguageLinks({
  page,
  language,
}: {
  readonly page: PublicPageId;
  readonly language: Language;
}) {
  return (
    <span
      className="public-language-links"
      aria-label={language === 'uk' ? 'Мова сторінки' : 'Page language'}
    >
      <a
        href={publicPagePath(page, 'en')}
        hrefLang="en"
        lang="en"
        aria-current={language === 'en' ? 'page' : undefined}
      >
        EN
      </a>
      <a
        href={publicPagePath(page, 'uk')}
        hrefLang="uk"
        lang="uk"
        aria-current={language === 'uk' ? 'page' : undefined}
      >
        УКР
      </a>
    </span>
  );
}
