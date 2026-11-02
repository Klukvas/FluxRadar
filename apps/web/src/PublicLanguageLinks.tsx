import { languageOptions, type Language } from './i18n';
import { publicPagePath, type PublicPageId } from './public-page-routing';
import './styles/public-language.css';

/**
 * The short label each locale is linked by, and the name of the group.
 *
 * Short, because these are three links side by side in the page header of a
 * public document, not a dropdown: the full names live in `languageOptions`
 * and the workspace switcher uses those.
 */
const LINK_LABELS: Readonly<Record<Language, string>> = { en: 'EN', uk: 'УКР', ru: 'RU' };

const GROUP_LABELS: Readonly<Record<Language, string>> = {
  en: 'Page language',
  uk: 'Мова сторінки',
  ru: 'Язык страницы',
};

export function PublicLanguageLinks({
  page,
  language,
}: {
  readonly page: PublicPageId;
  readonly language: Language;
}) {
  return (
    <span className="public-language-links" aria-label={GROUP_LABELS[language]}>
      {languageOptions.map((option) => (
        <a
          key={option.value}
          href={publicPagePath(page, option.value)}
          hrefLang={option.value}
          lang={option.value}
          aria-current={language === option.value ? 'page' : undefined}
        >
          {LINK_LABELS[option.value]}
        </a>
      ))}
    </span>
  );
}
