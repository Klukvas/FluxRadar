// The locked line under the Free AI answer: who the AI recommends instead.
//
// The Free check asks one model one question about the business by name, with
// no web search. For a small business the answer is almost always "I have no
// information", and selling "more of the same question" after it reads as
// paying to hear it twice. What only a paid check shows is the market: the
// questions a customer actually types, asked with web search, and who the AI
// names instead. So the line says that, with an example built from the
// profile (free-market-question.ts), and how many questions each plan asks.
//
// Locked the way the Free report's other paid checks are, with the same 🔒.

import type { GeoEvidence } from './api';
import { Button } from './components';
import { marketQuestionExample } from './free-market-question';
import { freePreviewCopy } from './free-preview-copy';
import { trackUpgradeClicked } from './funnel-analytics';
import type { Language } from './i18n';
import type { PaidPlan } from './plan-modules';
import { BASIC_PRICE } from './tariff-prices';

/** The cheapest plan that asks the market questions. */
const MARKET_UPGRADE_PLAN: PaidPlan = 'Basic';

export function FreeGeoMarketTeaser(props: {
  evidence: GeoEvidence | null;
  language: Language;
  /** Absent where the report has nowhere to send an upgrade. */
  onUpgrade?: (plan: PaidPlan) => void;
}) {
  const t = freePreviewCopy[props.language].preview.market;
  const { onUpgrade } = props;
  return (
    <div className="free-geo-market" data-locked-capability="geo-market-questions">
      <p className="free-geo-market__title">
        <strong>{t.title}</strong>{' '}
        <span className="free-geo-market__lock">
          <span aria-hidden="true">🔒 </span>
          {t.lockedIn}
        </span>
      </p>
      <p>{t.body(marketQuestionExample(props.evidence))}</p>
      <p className="muted free-geo-market__scale">{t.scale}</p>
      {onUpgrade === undefined ? null : (
        <div className="button-row">
          <Button
            onClick={() => {
              trackUpgradeClicked(MARKET_UPGRADE_PLAN, 'free_ai_answer');
              onUpgrade(MARKET_UPGRADE_PLAN);
            }}
          >
            {t.action(BASIC_PRICE)}
          </Button>
        </div>
      )}
    </div>
  );
}
