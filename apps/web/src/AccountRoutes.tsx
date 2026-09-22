import { apiRequest, type Account } from './api';
import { AccountScreen } from './AccountScreen';
import { accountCopy } from './account-copy';
import type { AppModel } from './app-model';
import { AuthScreen } from './AuthScreen';

/** The password reset form, for a reset link opened in a browser that is still signed in. */
export function PasswordResetRoute({ app }: { readonly app: AppModel }) {
  const { emailAction, setEmailAction, onAuthed, signOutLocally } = app;
  const { language, navigate, setError } = app;
  return (
    <AuthScreen
      language={language}
      onAuthed={onAuthed}
      error={null}
      onError={setError}
      onBack={() => {
        setEmailAction(null);
        // A reset ends every session, this one included.
        void apiRequest<Account>('/auth/me')
          .then(() => navigate('desktop'))
          .catch(signOutLocally);
      }}
      initialMode="login"
      emailAction={emailAction}
    />
  );
}

/** The account screen. Deleting the account signs this tab out and says so on the home page. */
export function AccountRoute({
  app,
  account,
}: {
  readonly app: AppModel;
  readonly account: Account;
}) {
  const { language, openScanById, setError, setNotice, signOutLocally } = app;
  const ac = accountCopy[language];
  return (
    <AccountScreen
      account={account}
      language={language}
      onOpenScan={(scanId) => void openScanById(scanId)}
      onDeleted={() => {
        signOutLocally();
        setNotice(ac.deletion.deleted);
      }}
      onNotice={setNotice}
      onError={setError}
    />
  );
}
