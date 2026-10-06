import type { PublicDocumentScreen } from './app-routes';
import { BotScreen } from './Bot';
import { AuditCoverageScreen } from './Checks';
import { ExampleReportScreen } from './ExampleReportPage';
import { FaqScreen } from './Faq';
import type { Language } from './i18n';
import { LegalDocumentScreen } from './LegalDocuments';

/**
 * The pages anyone can read. They are drawn before the session is known, and
 * `signedIn` changes nothing but the workspace links in their header.
 */
export function PublicDocument({
  screen,
  language,
  onLanguageChange,
  signedIn,
}: {
  readonly screen: PublicDocumentScreen;
  readonly language: Language;
  readonly onLanguageChange: (language: Language) => void;
  readonly signedIn: boolean;
}) {
  if (screen === 'privacy' || screen === 'terms' || screen === 'cookies') {
    return (
      <LegalDocumentScreen
        kind={screen}
        language={language}
        onLanguageChange={onLanguageChange}
        signedIn={signedIn}
      />
    );
  }
  if (screen === 'checks') {
    return (
      <AuditCoverageScreen
        language={language}
        onLanguageChange={onLanguageChange}
        signedIn={signedIn}
      />
    );
  }
  if (screen === 'faq') {
    return (
      <FaqScreen language={language} onLanguageChange={onLanguageChange} signedIn={signedIn} />
    );
  }
  if (screen === 'example-report') {
    return (
      <ExampleReportScreen
        language={language}
        onLanguageChange={onLanguageChange}
        signedIn={signedIn}
      />
    );
  }
  return <BotScreen language={language} onLanguageChange={onLanguageChange} signedIn={signedIn} />;
}
