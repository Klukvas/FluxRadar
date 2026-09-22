import type { Account } from './api';
import type { AppModel } from './app-model';
import { HomeScreen } from './HomeScreen';
import type { ChosenPlan } from './Pricing';

/**
 * The home page, for a visitor or for a signed-in owner. Both are the same
 * HomeScreen element with different props, as they were when the shell drew
 * them itself, so a sign-in that lands while the page is showing updates the
 * page instead of drawing it again.
 */
export function HomeRoute({ app }: { readonly app: AppModel }) {
  return app.account === null ? visitorHome(app) : ownerHome(app, app.account);
}

/** Every call to action a visitor has opens the sign-in dialog over the page. */
function visitorHandlers({ navigate, setAuthMode, setEmailAction, setError, setIntent }: AppModel) {
  return {
    onStart: () => {
      // A new owner starting a free check needs an account first, so the
      // "run a free homepage check" CTA opens registration (not sign in).
      setError(null);
      setIntent(null);
      setAuthMode('register');
      navigate('auth');
    },
    onStartSite: (site: string | null) => {
      setError(null);
      setIntent(site === null ? null : { site, plan: null });
      setAuthMode('register');
      navigate('auth');
    },
    onChoosePlan: (plan: ChosenPlan) => {
      setError(null);
      setIntent({ site: null, plan });
      setAuthMode('register');
      navigate('auth');
    },
    onLogin: () => {
      setError(null);
      setAuthMode('login');
      navigate('auth');
    },
    onRegister: () => {
      setError(null);
      setAuthMode('register');
      navigate('auth');
    },
    onCloseAuth: () => {
      setError(null);
      setEmailAction(null);
      setIntent(null);
      navigate('home');
    },
  };
}

function visitorHome(app: AppModel) {
  const { authMode, changeLanguage, emailAction, entryRoute, error, intent } = app;
  const { language, onAuthed, screen, setError } = app;
  const handlers = visitorHandlers(app);
  return (
    <HomeScreen
      signedIn={false}
      onStart={handlers.onStart}
      onStartSite={handlers.onStartSite}
      onChoosePlan={handlers.onChoosePlan}
      pendingSite={intent?.site ?? null}
      onLogin={handlers.onLogin}
      onRegister={handlers.onRegister}
      onOpenWorkspace={() => undefined}
      scrollTo={entryRoute.scrollTo}
      language={language}
      onLanguageChange={changeLanguage}
      authOpen={screen === 'auth'}
      authAction={emailAction}
      authMode={authMode}
      authError={error}
      onAuthError={setError}
      onAuthed={onAuthed}
      onCloseAuth={handlers.onCloseAuth}
    />
  );
}

function ownerHome(app: AppModel, account: Account) {
  const { changeLanguage, entryRoute, followIntent, language, navigate, onAuthed } = app;
  const { setError, setNewScanPlan } = app;
  return (
    <HomeScreen
      signedIn
      accountEmail={account.email}
      onStart={() => navigate('desktop')}
      onStartSite={(site) => {
        if (site === null) {
          navigate('desktop');
          return;
        }
        void followIntent({ site, plan: null });
      }}
      onChoosePlan={(plan) => {
        setNewScanPlan(plan);
        navigate('new-scan');
      }}
      onLogin={() => undefined}
      onRegister={() => undefined}
      onOpenWorkspace={() => navigate('desktop')}
      onOpenScreen={navigate}
      scrollTo={entryRoute.scrollTo}
      language={language}
      onLanguageChange={changeLanguage}
      authOpen={false}
      authAction={null}
      authMode="login"
      authError={null}
      onAuthError={setError}
      onAuthed={onAuthed}
      onCloseAuth={() => navigate('home')}
    />
  );
}
