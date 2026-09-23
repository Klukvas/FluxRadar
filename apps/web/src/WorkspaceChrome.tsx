// What surrounds the workspace screens: the frame with the menu bar, the header
// with the owner's address, the banner asking for that address to be confirmed,
// and the footer.

import type { ReactNode } from 'react';

import { apiRequest, type Account } from './api';
import { accountCopy } from './account-copy';
import type { AppModel } from './app-model';
import { Button, CreatedByFluxLab, MenuBar } from './components';
import { copy, type Language } from './i18n';

/**
 * The menu bar over the desktop, which the boot screen and the workspace share.
 * Sharing it keeps the menu bar the same element when the boot hands over to the
 * workspace, instead of drawing it a second time.
 */
export function AppFrame(props: {
  readonly app: Pick<AppModel, 'changeLanguage' | 'language' | 'navigate'>;
  readonly className: string;
  readonly active: string;
  readonly signedIn: boolean;
  readonly children: ReactNode;
}) {
  const { changeLanguage, language, navigate } = props.app;
  return (
    <div className={props.className}>
      <MenuBar
        active={props.active}
        onNavigate={navigate}
        signedIn={props.signedIn}
        language={language}
        onLanguageChange={changeLanguage}
      />
      <div className="desktop">{props.children}</div>
    </div>
  );
}

/** The workspace heading: the owner's address, which opens the account, and sign-out. */
export function WorkspaceHeader({
  app,
  account,
}: {
  readonly app: AppModel;
  readonly account: Account;
}) {
  const { language, navigate, screen, signOutLocally } = app;
  const ac = accountCopy[language];
  return (
    <header className="desktop__intro">
      <div>
        <h1>FluxRadar</h1>
        <p>{copy[language].workspace.intro}</p>
      </div>
      <div className="button-row">
        {/* The address is the way into the account: it is what the owner
            recognises as "me", and the menu bar's width is already spent. */}
        <button
          type="button"
          className={
            screen === 'account'
              ? 'desktop__account-link technical is-active'
              : 'desktop__account-link technical'
          }
          aria-label={`${ac.navLabel}: ${account.email}`}
          aria-current={screen === 'account' ? 'page' : undefined}
          onClick={() => navigate('account')}
        >
          {account.email}
        </button>
        <Button
          onClick={() => {
            void apiRequest<null>('/auth/logout', { method: 'POST' }).then(signOutLocally);
          }}
          variant="danger"
        >
          {copy[language].workspace.logOut}
        </Button>
      </div>
    </header>
  );
}

/** Asks the owner to confirm their address, until they do or dismiss it. */
export function VerifyBanner({
  app,
  account,
}: {
  readonly app: AppModel;
  readonly account: Account;
}) {
  const { language, resendFromBanner, setVerifyBannerHidden } = app;
  const ac = accountCopy[language];
  return (
    <div className="verify-banner" role="status">
      <p>{ac.banner.body(account.email)}</p>
      <div className="button-row">
        <Button onClick={() => void resendFromBanner()}>{ac.banner.resend}</Button>
        <Button onClick={() => setVerifyBannerHidden(true)}>{ac.banner.dismiss}</Button>
      </div>
    </div>
  );
}

/**
 * The site footer, in the one place the workspace has for it. Every public page
 * ends with the brand, the standing links and the studio attribution; a
 * signed-in screen ended with the attribution alone, so a report was the only
 * page on the site with no way out to the coverage page, the policies or the
 * field notes. One element in the shell, shared by every workspace screen — the
 * report does not get a second copy of its own.
 */
export function WorkspaceFooter({ language }: { readonly language: Language }) {
  return (
    <footer className="desktop__footer">
      <span>{copy[language].home.footer.brand}</span>
      <span className="desktop__footer-links">
        <a href="/checks">{copy[language].home.footer.coverageLink}</a>
        <a href="/faq">{copy[language].nav.faq}</a>
        <a href="/privacy">{copy[language].home.footer.privacyLink}</a>
        <a href="/terms">{copy[language].home.footer.termsLink}</a>
        <a href="/terms#terms-paid">{copy[language].home.footer.refundLink}</a>
        <a href="/cookies">{copy[language].legal.cookies.title}</a>
        <a href="/bot">{copy[language].home.footer.crawlerLink}</a>
        <a href="/blog">{copy[language].home.footer.fieldNotes}</a>
      </span>
      <CreatedByFluxLab language={language} />
    </footer>
  );
}
