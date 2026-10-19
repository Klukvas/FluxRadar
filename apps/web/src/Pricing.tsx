import { EXAMPLE_REPORT_PATH } from './app-routes';
import { Button } from './components';
import { copy, type Language } from './i18n';

// The two one-time products live on the home page: there is no separate plans
// screen to navigate to, so everything a buyer needs to choose between Basic
// and Complete has to be readable in one place.

/** A plan chosen on the pricing cards, carried through sign-up to the scan form. */
export type ChosenPlan = 'Basic' | 'Complete';

type PricingCopy = (typeof copy)[Language]['pricing'];
type PlanCardCopy = PricingCopy['cards'][keyof PricingCopy['cards']];

function PlanCard(props: {
  plan: ChosenPlan;
  card: PlanCardCopy;
  checksTitle: string;
  chooseLabel: string;
  /** The badge text, on the one card a first-time buyer is pointed to. */
  recommended: string | null;
  onChoose: (plan: ChosenPlan) => void;
}) {
  const modifier = props.plan === 'Basic' ? 'basic' : 'complete';
  const checksId = `pricing-${modifier}-checks`;
  return (
    <article className={`home__plan home__plan--${modifier}`}>
      <span className="home__card-index">{props.card.eyebrow}</span>
      {props.recommended === null ? null : (
        <span className="home__plan-badge">{props.recommended}</span>
      )}
      <h3>{props.card.title}</h3>
      <div className="home__price">{props.card.price}</div>
      <p>{props.card.description}</p>
      <p className="home__plan-checks-title" id={checksId}>
        {props.checksTitle}
      </p>
      <ul className="home__plan-checks" aria-labelledby={checksId}>
        {props.card.checks.map((check) => (
          <li key={check}>{check}</li>
        ))}
      </ul>
      <p className="home__plan-limits">{props.card.limits}</p>
      <Button
        variant={props.recommended === null ? 'default' : 'primary'}
        onClick={() => props.onChoose(props.plan)}
      >
        {props.chooseLabel}
      </Button>
    </article>
  );
}

/**
 * Two cards: Basic, the recommended start, and Complete. Each says in one line
 * who it is for and lists what it checks; prices come from the tariff source
 * through the dictionary, never from this file.
 */
export function PricingCards(props: { language: Language; onChoose: (plan: ChosenPlan) => void }) {
  const t = copy[props.language].pricing;
  return (
    <div className="home__pricing-grid">
      <PlanCard
        plan="Basic"
        card={t.cards.basic}
        checksTitle={t.checksTitle}
        chooseLabel={t.chooseBasic}
        recommended={t.recommended}
        onChoose={props.onChoose}
      />
      <PlanCard
        plan="Complete"
        card={t.cards.complete}
        checksTitle={t.checksTitle}
        chooseLabel={t.chooseComplete}
        recommended={null}
        onChoose={props.onChoose}
      />
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
 * The two packages as a table rather than two paragraphs, because the reader's
 * question is a comparison and prose makes them hold all of it in their head.
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
              <th scope="col">{t.explainer.completeColumn}</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map((row) => (
              <tr key={row}>
                <th scope="row">{t.explainer.rows[row].label}</th>
                <td data-label={t.explainer.basicColumn}>{t.explainer.rows[row].basic}</td>
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
        {/* First of the three: somebody choosing between packages is choosing
            between reports, and this is the one place they can read one
            without paying. */}
        <a href={EXAMPLE_REPORT_PATH}>{t.exampleLink}</a>
        <a href="/checks">{t.coverageLink}</a>
        <a href="/faq">{t.faqLink}</a>
      </p>
    </section>
  );
}
