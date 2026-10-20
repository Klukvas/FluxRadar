import type { CheckoutConfig } from './api';
import { Button, FieldRow } from './components';
import { formatCount } from './format-count';
import { copy, type Language } from './i18n';
import { newScanCopy } from './new-scan-copy';
import type { NewScanForm } from './new-scan-form';
import { PLAN_URL_LIMIT, type Plan } from './plan-modules';
import { publicPagePath } from './public-page-routing';
import { RobotsConfirmation } from './RobotsConfirmation';
import { siteAddress } from './site-address';
import { PLAN_PRICE } from './tariff-prices';

/**
 * Who takes the payment, for the note beside the pay button.
 *
 * Creem is the only provider this deployment sells through. With no config
 * yet, the note closes on the policies instead of naming a merchant nothing
 * has confirmed.
 */
function purchaseTermsMerchant(
  t: (typeof copy)[Language],
  config: CheckoutConfig | null,
): string | null {
  return config === null ? null : t.newScan.purchaseTermsMerchant;
}

/** "all, up to 5,000", "up to 200" or "homepage only", in the reader's language. */
function pagesValue(plan: Plan, maxPages: string, language: Language): string {
  const c = newScanCopy[language].summary;
  if (plan === 'Free') return c.pagesHomepage;
  const count = (pages: number): string => formatCount(pages, language);
  const owner = Number(maxPages.trim());
  // The owner's own limit, when it is a real one, is what the scan will obey;
  // an invalid entry is the field's to complain about, not this row's.
  if (maxPages.trim() !== '' && Number.isInteger(owner) && owner > 0)
    return c.pagesOwner(count(owner));
  return c.pagesAll(count(PLAN_URL_LIMIT[plan]));
}

/**
 * The right column: the order in plain words, its price, and the one button.
 *
 * Not an `aside`: a complementary landmark is content beside the page, and
 * this column carries the form's own submit. Everything technical about the
 * crawl is in "For advanced users"; this is what a buyer reads before paying.
 */
export function OrderSummary(props: {
  form: NewScanForm;
  language: Language;
  internalFreeAccess: boolean;
}) {
  const c = newScanCopy[props.language];
  const { plan, scope, targetLabel, usingSavedProfile, showsPurchaseTerms } = props.form;
  const total =
    plan === 'Free'
      ? c.summary.totalFree
      : props.internalFreeAccess
        ? c.summary.totalInternal
        : PLAN_PRICE[plan];
  return (
    <section className="launch-form__launch order-summary" aria-labelledby="order-summary-title">
      {/* The part that may scroll inside the pinned column, so the actions below
          it cannot be pushed off a short viewport. */}
      <div className="launch-form__review">
        <h2 className="order-summary__title" id="order-summary-title">
          {c.summary.title}
        </h2>
        <div className="launch-summary">
          <FieldRow
            label={c.summary.site}
            value={usingSavedProfile ? siteAddress(targetLabel) : c.noSiteChosen}
            technical
          />
          <FieldRow label={c.summary.plan} value={c.planCards[plan].name} />
          <FieldRow
            label={c.summary.pages}
            value={pagesValue(plan, scope.maxPages, props.language)}
          />
          <FieldRow label={c.summary.checks} value={c.summary.checksByPlan[plan]} />
        </div>
        <p className="order-summary__total">
          <span>{c.summary.total}</span>
          <strong>{total}</strong>
        </p>
      </div>
      <div className="launch-form__actions">
        <LaunchActions form={props.form} language={props.language} />
        {showsPurchaseTerms ? (
          <>
            <p className="muted order-summary__note">{c.summary.noSubscription}</p>
            <PurchaseTerms form={props.form} language={props.language} />
          </>
        ) : null}
      </div>
    </section>
  );
}

/** Warning, the two ways out, the reason the button is held, then the button. */
function LaunchActions(props: { form: NewScanForm; language: Language }) {
  const t = copy[props.language];
  const c = newScanCopy[props.language];
  const {
    canLaunch,
    egressBlocked,
    launchLabel,
    paidScopeControls,
    robotsOverrideStale,
    robotsUnconfirmed,
    scope,
    updateScope,
  } = props.form;
  return (
    <>
      <RobotsConfirmation
        language={props.language}
        ignoresRobots={paidScopeControls && !scope.respectRobots}
        stale={robotsOverrideStale}
        confirmed={scope.robotsOverrideConfirmed}
        onChange={updateScope}
      />
      {robotsUnconfirmed ? (
        <p className="muted launch-form__blocked" id="launch-blocked" role="note">
          {robotsOverrideStale ? c.blockedByRobotsStale : c.blockedByRobots}
        </p>
      ) : egressBlocked ? (
        <p className="muted launch-form__blocked" id="launch-blocked" role="note">
          {t.newScan.blockedByEgress}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="primary"
        {...(robotsUnconfirmed || egressBlocked ? { 'aria-describedby': 'launch-blocked' } : {})}
        disabled={!canLaunch}
      >
        {launchLabel}
      </Button>
    </>
  );
}

/** The terms the buyer accepts by pressing the button, and who takes the money. */
function PurchaseTerms(props: { form: NewScanForm; language: Language }) {
  const t = copy[props.language];
  const { checkoutConfig, plan } = props.form;
  const merchant = purchaseTermsMerchant(t, checkoutConfig);
  return (
    <p className="muted checkout-legal-note" role="note" aria-label={t.newScan.purchaseTermsLabel}>
      {t.newScan.purchaseTermsPrefix(plan)}{' '}
      <a href={publicPagePath('terms', props.language)}>{t.newScan.aiConsentTerms}</a>{' '}
      {t.newScan.purchaseTermsJoin}{' '}
      <a href={publicPagePath('privacy', props.language)}>{t.newScan.aiConsentPrivacy}</a>
      {' · '}
      <a href={publicPagePath('cookies', props.language)}>{t.legal.cookies.title}</a>
      {'.'}
      {merchant === null ? null : ` ${merchant}`}
    </p>
  );
}
