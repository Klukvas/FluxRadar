import { Button } from './components';
import { copy, type Language } from './i18n';

// The three one-time products live on the home page: there is no separate plans
// screen to navigate to, so everything a buyer needs to choose between Basic,
// Website Audit and Complete has to be readable in one place.

/** A plan chosen on the pricing cards, carried through sign-up to the scan form. */
export type ChosenPlan = 'Basic' | 'WebsiteAudit' | 'Complete';

export function PricingCards(props: { language: Language; onChoose: (plan: ChosenPlan) => void }) {
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
        <Button onClick={() => props.onChoose('Basic')}>{t.chooseBasic}</Button>
      </article>
      <article className="home__plan home__plan--website-audit">
        <span className="home__card-index">{t.cards.websiteAudit.eyebrow}</span>
        <h3>{t.cards.websiteAudit.title}</h3>
        <div className="home__price">{t.cards.websiteAudit.price}</div>
        <p>{t.cards.websiteAudit.description}</p>
        <dl className="plan-card__details">
          <div>
            <dt>{t.included}</dt>
            <dd>{t.cards.websiteAudit.included}</dd>
          </div>
          <div>
            <dt>{t.bestFor}</dt>
            <dd>{t.cards.websiteAudit.bestFor}</dd>
          </div>
          <div>
            <dt>{t.notIncluded}</dt>
            <dd>{t.cards.websiteAudit.notIncluded}</dd>
          </div>
          <div>
            <dt>{t.limits}</dt>
            <dd>{t.cards.websiteAudit.limits}</dd>
          </div>
        </dl>
        <Button onClick={() => props.onChoose('WebsiteAudit')}>{t.chooseWebsiteAudit}</Button>
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
        <Button variant="primary" onClick={() => props.onChoose('Complete')}>
          {t.chooseComplete}
        </Button>
      </article>
    </div>
  );
}

/**
 * The rows of the comparison, in the order a buyer meets the question: what am
 * I asking, what do I get, what do I not get, when do I take it, what does it
 * cost, and what is the difference in one line.
 */
const COMPARISON_ROWS = [
  'question',
  'included',
  'notIncluded',
  'chooseWhen',
  'price',
  'difference',
] as const;

/**
 * The three packages as a table rather than three paragraphs, because the
 * reader's question is a comparison and prose makes them hold all of it in their
 * head.
 *
 * It stays a real table — caption, column headers, a row header per question —
 * so the relationship survives being read out. Below the phone breakpoint the
 * stylesheet stacks the rows and each cell names its own plan from `data-label`,
 * the way `.data-table` already does, so nothing scrolls sideways.
 */
export function PricingExplainer(props: { language: Language }) {
  const t = copy[props.language].pricing;
  return (
    <section className="home__pricing-explainer" aria-labelledby="pricing-explainer-title">
      <div>
        <span className="home__card-index">{t.explainer.kicker}</span>
        <h3 id="pricing-explainer-title">{t.explainer.title}</h3>
      </div>
      <div className="plan-compare-wrap">
        <table className="plan-compare">
          <caption>{t.explainer.tableCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.explainer.aspect}</th>
              <th scope="col">{t.explainer.basicColumn}</th>
              <th scope="col">{t.explainer.websiteAuditColumn}</th>
              <th scope="col">{t.explainer.completeColumn}</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map((row) => (
              <tr key={row}>
                <th scope="row">{t.explainer.rows[row].label}</th>
                <td data-label={t.explainer.basicColumn}>{t.explainer.rows[row].basic}</td>
                <td data-label={t.explainer.websiteAuditColumn}>
                  {t.explainer.rows[row].websiteAudit}
                </td>
                <td data-label={t.explainer.completeColumn}>{t.explainer.rows[row].complete}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
