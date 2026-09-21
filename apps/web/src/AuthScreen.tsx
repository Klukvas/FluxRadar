// Sign in, create an account, reset a password, confirm an email.
//
// This was the only screen of the app still written in English literals: the
// language switcher changed everything around it and left the first form a new
// owner fills in half-translated. It also drew two password fields when a reset
// link was followed — the sign-in field and "New password", both bound to the
// same value.

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { trackEvent } from './analytics';
import { apiRequest, type Account } from './api';
import { authCopy } from './auth-copy';
import { AlertDialog, Button, Checkbox, Field, Window } from './components';
import { copy, type Language } from './i18n';

export type AuthMode = 'login' | 'register';
export type EmailAction = { readonly kind: 'verify' | 'reset'; readonly token: string };

export function AuthScreen(props: {
  language: Language;
  onAuthed: (account: Account) => Promise<void>;
  error: string | null;
  onError: (value: string | null) => void;
  onBack: () => void;
  initialMode: AuthMode;
  emailAction: EmailAction | null;
  /** The site a visitor typed on the home page, checked once the account exists. */
  pendingSite?: string | null;
}) {
  const t = authCopy[props.language];
  const legal = copy[props.language].legal;
  const [mode, setMode] = useState<AuthMode>(props.initialMode);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'working' | 'verified'>(
    'idle',
  );
  const verificationStarted = useRef(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const isReset = props.emailAction?.kind === 'reset';
  const isVerification = props.emailAction?.kind === 'verify';
  const { onError } = props;

  useEffect(() => {
    if (!isVerification || props.emailAction === null || verificationStarted.current) return;
    verificationStarted.current = true;
    setVerificationStatus('working');
    void apiRequest<{ status: string }>(
      `/auth/verify-email?token=${encodeURIComponent(props.emailAction.token)}`,
    )
      .then(() => setVerificationStatus('verified'))
      .catch((caught) => onError(caught instanceof Error ? caught.message : t.verificationFailed));
  }, [isVerification, props.emailAction, onError, t.verificationFailed]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    props.onError(null);
    try {
      if (forgotPassword) {
        await apiRequest<{ status: string }>('/auth/password-reset/request', {
          method: 'POST',
          body: JSON.stringify({ email }),
        });
        setSent(true);
        return;
      }
      if (isReset && props.emailAction !== null) {
        await apiRequest<{ status: string }>('/auth/password-reset/confirm', {
          method: 'POST',
          body: JSON.stringify({ token: props.emailAction.token, password }),
        });
        setResetDone(true);
        return;
      }
      const account = await apiRequest<Account>(`/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ email, password, rememberMe }),
      });
      // GA4's recommended names, so both land in the standard acquisition reports.
      trackEvent(mode === 'register' ? 'sign_up' : 'login', { method: 'email' });
      await props.onAuthed(account);
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : t.failed);
    } finally {
      setBusy(false);
    }
  };

  const title = isVerification
    ? t.titles.verify
    : isReset
      ? t.titles.reset
      : forgotPassword
        ? t.titles.forgot
        : t.titles[mode];
  const heading = isVerification
    ? verificationStatus === 'verified'
      ? t.headings.verified
      : t.headings.verify
    : isReset
      ? resetDone
        ? t.headings.resetDone
        : t.headings.reset
      : forgotPassword
        ? t.headings.forgot
        : t.headings[mode];
  const lead = isVerification
    ? verificationStatus === 'working'
      ? t.leads.verifying
      : verificationStatus === 'verified'
        ? t.leads.verified
        : t.leads.verifyPending
    : isReset
      ? resetDone
        ? t.leads.resetDone
        : t.leads.reset
      : forgotPassword
        ? sent
          ? t.leads.forgotSent
          : t.leads.forgot
        : mode === 'register'
          ? props.pendingSite
            ? t.leads.registerForSite(props.pendingSite)
            : t.leads.register
          : t.leads.login;
  const signingIn = !isVerification && !isReset && !forgotPassword && !sent;
  const choosingPassword = (signingIn || (isReset && !resetDone)) && !isVerification;
  const passwordType = showPassword ? 'text' : 'password';

  return (
    <Window title={title} className="window--dialog" onClose={props.onBack}>
      <form className="stack" onSubmit={submit}>
        <div>
          <h1 id="auth-title" className="section-heading">
            {heading}
          </h1>
          <p className="muted">{lead}</p>
        </div>
        {!isVerification && !isReset ? (
          <Field
            label={t.email}
            name="email"
            autoComplete={mode === 'login' ? 'username' : 'email'}
            value={email}
            onChange={setEmail}
            type="email"
            placeholder={t.emailPlaceholder}
          />
        ) : null}
        {choosingPassword ? (
          <>
            <Field
              label={isReset ? t.newPassword : t.password}
              name="password"
              autoComplete={mode === 'login' && !isReset ? 'current-password' : 'new-password'}
              value={password}
              onChange={setPassword}
              type={passwordType}
              placeholder={t.passwordPlaceholder}
            />
            <Checkbox
              name="show-password"
              label={t.showPassword}
              checked={showPassword}
              onChange={setShowPassword}
            />
          </>
        ) : null}
        {signingIn ? (
          <>
            <Checkbox
              name="remember-me"
              label={t.rememberMe}
              checked={rememberMe}
              onChange={setRememberMe}
            />
            <p className="muted">
              {mode === 'login' ? t.cookieNote : t.consentNote}
              <a href={`/terms?lang=${props.language}`}>{legal.terms.title}</a>
              {' · '}
              <a href={`/privacy?lang=${props.language}`}>{legal.privacy.title}</a>
              {' · '}
              <a href={`/cookies?lang=${props.language}`}>{legal.cookies.title}</a>
            </p>
          </>
        ) : null}
        <div className="button-row">
          {!isVerification && !sent && !resetDone ? (
            <Button type="submit" variant="primary" disabled={busy}>
              {busy
                ? t.working
                : isReset
                  ? t.submit.reset
                  : forgotPassword
                    ? t.submit.forgot
                    : t.submit[mode]}
            </Button>
          ) : null}
          {isVerification || isReset || resetDone ? null : !forgotPassword ? (
            <Button onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? t.toRegister : t.toLogin}
            </Button>
          ) : (
            <Button
              onClick={() => {
                setForgotPassword(false);
                setSent(false);
              }}
            >
              {t.toLogin}
            </Button>
          )}
          <Button onClick={props.onBack}>
            {isVerification && verificationStatus === 'verified' ? t.toWorkspace : t.toHome}
          </Button>
        </div>
        {mode === 'login' && !forgotPassword && !isVerification && !isReset ? (
          <button
            className="home__text-action"
            type="button"
            onClick={() => {
              setForgotPassword(true);
              props.onError(null);
            }}
          >
            {t.forgotLink}
          </button>
        ) : null}
        {props.error ? (
          <AlertDialog
            message={props.error}
            language={props.language}
            onClose={() => props.onError(null)}
          />
        ) : null}
      </form>
    </Window>
  );
}
