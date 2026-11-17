// The Free check's consent to its one-question AI preview (D-236).
//
// A checkbox rather than the paid plans' included disclosure: the owner can
// still turn the AI step off. It starts ticked (new-scan-form.ts), and an
// unticked box sends no record at all (new-scan-request.ts), so a Free check
// whose owner unticks it reaches no AI service. The body says exactly what the
// API's Free record authorises — Anthropic, one question, one evaluation.

import { Checkbox } from './components';
import { freePreviewCopy } from './free-preview-copy';
import { copy, type Language } from './i18n';
import { publicPagePath } from './public-page-routing';
import { ScanCallout } from './ScanCallout';

const BODY_ID = 'free-ai-consent-description';

export function FreeAiConsentField(props: {
  language: Language;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const c = freePreviewCopy[props.language].consent;
  const t = copy[props.language].newScan;
  return (
    <>
      <ScanCallout
        eyebrow={c.eyebrow}
        title={c.title}
        titleId="free-ai-consent-title"
        mode={c.mode}
        lead={c.lead}
        bodyId={BODY_ID}
        defaultOpen
      >
        {c.body} <a href={publicPagePath('privacy', props.language)}>{t.aiConsentPrivacy}</a>
        {' · '}
        <a href={publicPagePath('terms', props.language)}>{t.aiConsentTerms}</a>
      </ScanCallout>
      <Checkbox
        name="scan-free-ai-consent"
        label={c.checkbox}
        checked={props.checked}
        describedBy={BODY_ID}
        onChange={props.onChange}
      />
    </>
  );
}
