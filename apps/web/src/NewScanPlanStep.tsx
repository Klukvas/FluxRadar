import { useId } from 'react';

import type { CheckoutConfig } from './api';
import { Checkbox } from './components';
import { FreeAiConsentField } from './FreeAiConsentField';
import { freeAiInterfaceHint } from './free-ai-language-copy';
import { FreeAiLanguageField } from './FreeAiLanguageField';
import { copy, type Language } from './i18n';
import { newScanCopy } from './new-scan-copy';
import type { NewScanForm } from './new-scan-form';
import { NewScanStep } from './NewScanSteps';
import { PLAN_MODULES, planIncludesActionPlan, type Plan } from './plan-modules';
import { publicPagePath } from './public-page-routing';
import { ScanCallout } from './ScanCallout';
import { PLAN_PRICE } from './tariff-prices';
import { useDelayedFlag } from './use-delayed-flag';

/**
 * What to tell a buyer who cannot pay yet.
 *
 * The server answers with a closed code and never with its configuration, so the
 * distinction the buyer sees is made here: "this deployment does not sell scans"
 * reads differently from "payments are set up and currently broken", and a
 * config we could not read at all says neither.
 */
function paidUnavailableCopy(t: (typeof copy)[Language], config: CheckoutConfig | null): string {
  if (config === null) return t.newScan.paidUnavailable;
  return config.unavailableReason === 'misconfigured'
    ? t.checkout.unavailableTemporary
    : t.checkout.unavailable;
}

/**
 * Step 2: what to check, as one card per plan, and the disclosures that come
 * with the chosen one.
 *
 * Cards rather than a dropdown: four persona reviews could not tell the plans
 * apart from "Basic · $39" alone. Each card is a real radio named `scan-plan`,
 * so the form's choice is still one value, and only the plans the form offers
 * (`planOptions`: Free always, paid ones only where a checkout can sell them)
 * are drawn. Prices come from `tariff-prices.ts`, never from this file.
 */
export function PlanStep(props: {
  form: NewScanForm;
  language: Language;
  internalFreeAccess: boolean;
}) {
  const t = copy[props.language];
  const c = newScanCopy[props.language];
  const {
    checkoutConfig,
    checkoutPending,
    choosePlan,
    freeAiConsent,
    paidAiLanguage,
    offeredOptInAiProviders,
    optInAiProviders,
    paidAvailable,
    paidPlanOptions,
    paidScopeControls,
    plan,
    planOptions,
    freeCheckSpent,
    setFreeAiConsent,
    toggleOptInAiProvider,
  } = props.form;
  // The paid cards reserve their slots the moment the checkout configuration is
  // known to be slow: the skeletons appear after the holdback, so a fast answer
  // never flashes them, and the cards that replace them land on the same grid.
  // Only the paid plans the form actually offers are reserved (the same
  // predicate the real grid draws), and none are reserved while the real paid
  // cards are already on the screen — with internal free access the grid is
  // complete before the configuration answers.
  const showPaidSkeletons = useDelayedFlag(checkoutPending);
  return (
    <NewScanStep number={2} title={c.steps.plan} id="scan-step-plan">
      <div className="plan-cards" role="radiogroup" aria-labelledby="scan-step-plan">
        {planOptions.map((value) => (
          <PlanCard
            key={value}
            plan={value}
            checked={plan === value}
            language={props.language}
            internalFreeAccess={props.internalFreeAccess}
            spent={value === 'Free' && freeCheckSpent}
            onChoose={choosePlan}
          />
        ))}
        {checkoutPending && showPaidSkeletons && !paidAvailable
          ? paidPlanOptions.map((paidPlan) => (
              <div
                className="plan-card plan-card--skeleton"
                key={`plan-skeleton-${paidPlan}`}
                aria-hidden="true"
              >
                <span className="plan-card__skeleton plan-card__skeleton--radio" />
                <span className="plan-card__name">
                  <span className="plan-card__skeleton plan-card__skeleton--name" />
                  {paidPlan === 'Basic' ? (
                    <span className="plan-card__skeleton plan-card__skeleton--badge" />
                  ) : null}
                </span>
                <span className="plan-card__price">
                  <span className="plan-card__skeleton plan-card__skeleton--price" />
                </span>
                <span className="plan-card__line">
                  <span className="plan-card__skeleton plan-card__skeleton--line" />
                  {/* Basic's description wraps to two lines at the card width;
                      the second block reserves that line, keeping the card at
                      its final height. */}
                  {paidPlan === 'Basic' ? (
                    <span className="plan-card__skeleton plan-card__skeleton--line" />
                  ) : null}
                </span>
              </div>
            ))
          : null}
      </div>
      {plan !== 'Free' ? (
        <FreeAiLanguageField language={props.language} aiLanguage={paidAiLanguage} />
      ) : null}
      {paidAvailable ? null : checkoutPending ? (
        <p className="muted">{t.newScan.paidChecking}</p>
      ) : (
        <p className="muted">{paidUnavailableCopy(t, checkoutConfig)}</p>
      )}
      {paidAvailable && checkoutConfig?.mode === 'test' && !props.internalFreeAccess ? (
        <p className="muted">{t.checkout.testMode}</p>
      ) : null}
      {paidScopeControls ? (
        <>
          {/* Every paid plan runs AI SEO / GEO. The versioned notice itself
              lives in the terms; the form keeps who is included and the link. */}
          <TermsNotice
            eyebrow={t.newScan.aiConsentEyebrow}
            mode={t.newScan.aiConsentOptional}
            note={t.newScan.aiConsentNote}
            href={`${publicPagePath('terms', props.language)}#terms-paid-ai`}
            link={t.newScan.aiConsentTerms}
          />
          {/* Separate from the notice above, because it is a choice and that
              one is not. Both providers stay off until one of these is ticked,
              and the body names the recipient first.

              Rendered from the declared list rather than written out twice, and
              only for the recipients this deployment can actually send to: an
              offer it cannot keep would cost the buyer a Partial GEO module on
              a scan they paid for. A deployment with neither key shows no
              optional block at all.

              And only on a plan that runs AI SEO / GEO. These recipients exist
              to answer GEO's discovery and awareness questions; a plan that
              asks none of them would offer a choice with nothing behind it —
              directly under the notice that has just said no such question is
              sent. The request drops the same selections (new-scan-form.ts), so
              the offer and what is sent stay one answer. */}
          {offeredOptInAiProviders.length === 0 ||
          !PLAN_MODULES[plan].includes('AI SEO / GEO') ? null : (
            <>
              <ScanCallout
                eyebrow={t.newScan.aiConsentOptInEyebrow}
                title={t.newScan.aiConsentOptInTitle}
                titleId="ai-consent-opt-in-title"
                mode={t.newScan.aiConsentOptInMode}
                bodyId="ai-consent-opt-in-description"
                defaultOpen
              >
                {t.newScan.aiConsentOptInBody}
              </ScanCallout>
              {offeredOptInAiProviders.map((provider) => (
                <Checkbox
                  key={provider}
                  name={`scan-ai-opt-in-${provider}`}
                  label={t.newScan.aiConsentOptIn[provider]}
                  checked={optInAiProviders.includes(provider)}
                  describedBy="ai-consent-opt-in-description"
                  onChange={(checked) => toggleOptInAiProvider(provider, checked)}
                />
              ))}
            </>
          )}
          {/* Shown on every plan the tariff gives the Action Plan to, Basic
              included. The list of what the button sends is in the terms. */}
          {planIncludesActionPlan(plan) ? (
            <TermsNotice
              eyebrow={t.newScan.actionPlanInfoEyebrow}
              mode={t.newScan.actionPlanInfoMode}
              note={t.newScan.actionPlanNote}
              href={`${publicPagePath('terms', props.language)}#terms-action-plan`}
              link={t.newScan.aiConsentTerms}
            />
          ) : null}
          {PLAN_MODULES[plan].includes('Performance') ? (
            <ScanCallout
              eyebrow={t.newScan.performanceInfoEyebrow}
              title={t.newScan.performanceInfoTitle}
              titleId="performance-info-title"
              mode={t.newScan.performanceInfoMode}
              defaultOpen
            >
              {t.newScan.performanceInfoBody}
            </ScanCallout>
          ) : null}
        </>
      ) : null}
      {plan === 'Free' ? (
        <FreeAiConsentField
          language={props.language}
          checked={freeAiConsent}
          onChange={setFreeAiConsent}
        />
      ) : null}
      {plan === 'Free' && freeAiConsent ? (
        <p className="field__hint">{freeAiInterfaceHint[props.language]}</p>
      ) : null}
    </NewScanStep>
  );
}

/** The paid-audit notices: who is involved, and a link to the full text. */
function TermsNotice(props: {
  eyebrow: string;
  mode: string;
  note: string;
  href: string;
  link: string;
}) {
  return (
    <div className="scan-notice">
      <div className="scan-notice__header">
        <span className="scan-notice__eyebrow">{props.eyebrow}</span>
        <span className="status-chip status-chip--neutral">{props.mode}</span>
      </div>
      <p className="scan-notice__note">
        {props.note} <a href={props.href}>{props.link}</a>
      </p>
    </div>
  );
}

function PlanCard(props: {
  plan: Plan;
  checked: boolean;
  language: Language;
  internalFreeAccess: boolean;
  /** The plan cannot be chosen again; the card says why instead of vanishing. */
  spent: boolean;
  onChoose: (plan: Plan) => void;
}) {
  const c = newScanCopy[props.language];
  const card = c.planCards[props.plan];
  const price =
    props.internalFreeAccess && props.plan !== 'Free'
      ? c.planInternalPrice
      : PLAN_PRICE[props.plan];
  const id = useId();
  const recommended = props.plan === 'Basic';
  // Named "Basic $39 recommended" and described by its line, rather than
  // named by everything the label wraps: a screen reader read the badge in
  // capitals and the whole sentence as the option's name.
  const labelledBy = [`${id}-name`, `${id}-price`, ...(recommended ? [`${id}-recommended`] : [])];
  return (
    <label
      className={`plan-card${props.checked ? ' plan-card--checked' : ''}${props.spent ? ' plan-card--spent' : ''}`}
    >
      <input
        className="plan-card__radio"
        type="radio"
        name="scan-plan"
        value={props.plan}
        checked={props.checked}
        disabled={props.spent}
        aria-labelledby={labelledBy.join(' ')}
        aria-describedby={`${id}-line`}
        onChange={() => props.onChoose(props.plan)}
      />
      <span className="plan-card__name">
        <span id={`${id}-name`}>{card.name}</span>
        {recommended ? (
          <>
            <span className="plan-card__badge" aria-hidden="true">
              {c.planRecommended}
            </span>
            <span className="sr-only" id={`${id}-recommended`}>
              {c.planRecommendedSpoken}
            </span>
          </>
        ) : null}
      </span>
      <span className="plan-card__price" id={`${id}-price`}>
        {price}
      </span>
      <span className="plan-card__line" id={`${id}-line`}>
        {props.spent ? c.freeCheckSpent : card.line}
      </span>
    </label>
  );
}
