import { useEffect } from 'react';

import { Button, MenuBar } from './components';
import { copy, type Copy, type Language } from './i18n';

type PlanCardKey = 'free' | 'basic' | 'complete';

export function PlanCards(props: { language: Language; onChoose: () => void; compact?: boolean }) {
  const t = copy[props.language];
  const plans: readonly { key: PlanCardKey; data: Copy['plans']['cards'][PlanCardKey] }[] = [
    { key: 'free', data: t.plans.cards.free },
    { key: 'basic', data: t.plans.cards.basic },
    { key: 'complete', data: t.plans.cards.complete },
  ];
  const cta: Record<PlanCardKey, string> = {
    free: t.plans.tryFree,
    basic: t.plans.chooseBasic,
    complete: t.plans.chooseComplete,
  };
  return (
    <div className={`home__pricing-grid ${props.compact ? '' : 'plans-page__cards'}`}>
      {plans.map(({ key, data }) => (
        <article className={`home__plan home__plan--${key}`} key={key}>
          <span className="home__card-index">{data.eyebrow}</span>
          <h3>{data.title}</h3>
          <div className="home__price">{data.price}</div>
          <p>{data.description}</p>
          <dl className="plan-card__details">
            <div>
              <dt>{t.plans.included}</dt>
              <dd>{data.included}</dd>
            </div>
            {key !== 'complete' && (
              <div>
                <dt>{t.plans.notIncluded}</dt>
                <dd>{data.notIncluded}</dd>
              </div>
            )}
            <div>
              <dt>{t.plans.limits}</dt>
              <dd>{data.limits}</dd>
            </div>
          </dl>
          <Button variant={key === 'basic' ? 'primary' : 'default'} onClick={props.onChoose}>
            {cta[key]}
          </Button>
        </article>
      ))}
    </div>
  );
}

export function PlansScreen(props: {
  language: Language;
  onLanguageChange: (language: Language) => void;
  signedIn: boolean;
  onStart: () => void;
  onOpenWorkspace: () => void;
  onNavigate: (screen: string) => void;
}) {
  const t = copy[props.language];
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${t.nav.plans} — FluxRadar`;
    return () => {
      document.title = previousTitle;
    };
  }, [t.nav.plans]);

  return (
    <div className="app-shell legal-shell">
      <MenuBar
        active="plans"
        onNavigate={(next) => {
          if (next === 'home') {
            window.location.assign('/');
            return;
          }
          if (next === 'desktop') {
            if (props.signedIn) props.onOpenWorkspace();
            else window.location.assign('/');
            return;
          }
          props.onNavigate(next);
        }}
        signedIn={props.signedIn}
        language={props.language}
        onLanguageChange={props.onLanguageChange}
      />
      <main className="plans-page" aria-labelledby="plans-title">
        <header className="plans-page__header">
          <div>
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">04</span> {t.plans.kicker}
            </div>
            <h1 id="plans-title">{t.plans.title}</h1>
            <p>{t.plans.lead}</p>
          </div>
          <span className="plans-page__public-note">{t.plans.publicOnly}</span>
        </header>
        <div className="plans-page__notice" role="note">
          <strong>FluxRadar / status</strong>
          <span>{t.plans.honestNote}</span>
        </div>
        <PlanCards language={props.language} onChoose={props.onStart} />
        <section className="plans-page__scope" aria-labelledby="plans-explainer-title">
          <div>
            <span className="home__card-index">{t.plans.explainer.kicker}</span>
            <h2 id="plans-explainer-title">{t.plans.explainer.title}</h2>
          </div>
          <div className="plans-page__scope-grid">
            <p>
              <strong>{t.plans.explainer.free.title}</strong>
              <span>{t.plans.explainer.free.body}</span>
            </p>
            <p>
              <strong>{t.plans.explainer.basic.title}</strong>
              <span>{t.plans.explainer.basic.body}</span>
            </p>
            <p>
              <strong>{t.plans.explainer.complete.title}</strong>
              <span>{t.plans.explainer.complete.body}</span>
            </p>
          </div>
          <p>{t.plans.explainer.footnote}</p>
        </section>
        <section className="plans-page__scope" aria-labelledby="plans-scope-title">
          <div>
            <span className="home__card-index">{t.plans.scopeKicker}</span>
            <h2 id="plans-scope-title">{t.plans.scopeTitle}</h2>
          </div>
          <div className="plans-page__scope-grid">
            <p>
              <strong>{t.plans.included}</strong>
              <span>{t.plans.publicOnly}</span>
            </p>
            <p>
              <strong>{t.plans.notIncluded}</strong>
              <span>{t.plans.privateData}</span>
            </p>
            <p>
              <strong>{t.plans.limits}</strong>
              <span>{t.plans.limitCopy}</span>
            </p>
          </div>
        </section>
        <div className="plans-page__actions">
          <Button variant="primary" onClick={props.onStart}>
            {props.signedIn ? t.plans.openWorkspace : t.plans.createAccountToStart}
          </Button>
          <a href="/checks">{t.plans.coverageLink}</a>
        </div>
      </main>
    </div>
  );
}
