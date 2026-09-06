import { Button } from './components';
import { copy, type Language } from './i18n';

// The two one-time products live on the home page: there is no separate plans
// screen to navigate to, so everything a buyer needs to choose between Basic
// and Complete has to be readable in one place.

export function PricingCards(props: { language: Language; onChoose: () => void }) {
  const t = copy[props.language].pricing;
  return (
    <div className="home__pricing-grid">
      <article className="home__plan home__plan--basic">
        <span className="home__card-index">{t.cards.basic.eyebrow}</span>
        <h3>{t.cards.basic.title}</h3>
        <div className="home__price">{t.cards.basic.price}</div>
        <p>{t.cards.basic.description}</p>
        <dl className="plan-card__details">
          <div>
            <dt>{t.included}</dt>
            <dd>{t.cards.basic.included}</dd>
          </div>
          <div>
            <dt>{t.bestFor}</dt>
            <dd>{t.cards.basic.bestFor}</dd>
          </div>
          <div>
            <dt>{t.notIncluded}</dt>
            <dd>{t.cards.basic.notIncluded}</dd>
          </div>
          <div>
            <dt>{t.limits}</dt>
            <dd>{t.cards.basic.limits}</dd>
          </div>
        </dl>
        <Button onClick={props.onChoose}>{t.chooseBasic}</Button>
      </article>
      <article className="home__plan home__plan--complete">
        <span className="home__card-index">{t.cards.complete.eyebrow}</span>
        <h3>{t.cards.complete.title}</h3>
        <div className="home__price">{t.cards.complete.price}</div>
        <p>{t.cards.complete.description}</p>
        <dl className="plan-card__details">
          <div>
            <dt>{t.included}</dt>
            <dd>{t.cards.complete.included}</dd>
          </div>
          <div>
            <dt>{t.bestFor}</dt>
            <dd>{t.cards.complete.bestFor}</dd>
          </div>
          <div>
            <dt>{t.limits}</dt>
            <dd>{t.cards.complete.limits}</dd>
          </div>
        </dl>
        <Button variant="primary" onClick={props.onChoose}>
          {t.chooseComplete}
        </Button>
      </article>
    </div>
  );
}

export function PricingExplainer(props: { language: Language }) {
  const t = copy[props.language].pricing;
  return (
    <section className="home__pricing-explainer" aria-labelledby="pricing-explainer-title">
      <div>
        <span className="home__card-index">{t.explainer.kicker}</span>
        <h3 id="pricing-explainer-title">{t.explainer.title}</h3>
      </div>
      <div className="home__pricing-explainer-grid">
        <p>
          <strong>{t.explainer.basic.title}</strong>
          <span>{t.explainer.basic.body}</span>
        </p>
        <p>
          <strong>{t.explainer.complete.title}</strong>
          <span>{t.explainer.complete.body}</span>
        </p>
      </div>
      <p className="home__pricing-note">{t.explainer.footnote}</p>
      <p className="home__pricing-note">{t.startInWorkspace}</p>
      <p className="home__pricing-note">{t.freeNote}</p>
      <p className="home__pricing-links">
        <a href="/checks">{t.coverageLink}</a>
        <a href="/faq">{t.faqLink}</a>
      </p>
    </section>
  );
}
