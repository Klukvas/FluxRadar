// The Free check's consent to its one-question AI preview (D-236).
//
// The box starts ticked. Unticking it sends no record at all
// (new-scan-request.ts). The long account of what that question sends lives
// in the terms, at #terms-free-ai; this block only keeps the choice, the
// default, and the link. The highlight stays, because the choice is easy to miss.

import { Checkbox } from './components';
import { freePreviewCopy } from './free-preview-copy';
import { copy, type Language } from './i18n';
import { publicPagePath } from './public-page-routing';

const NOTE_ID = 'free-ai-consent-note';

export function FreeAiConsentField(props: {
  language: Language;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const c = freePreviewCopy[props.language].consent;
  const t = copy[props.language].newScan;
  return (
    <div className="free-ai-consent">
      <span className="status-chip status-chip--neutral">{c.mode}</span>
      <Checkbox
        className="free-ai-consent__choice"
        name="scan-free-ai-consent"
        label={c.checkbox}
        checked={props.checked}
        describedBy={NOTE_ID}
        onChange={props.onChange}
      />
      <p id={NOTE_ID} className="free-ai-consent__note">
        {c.note}{' '}
        <a href={`${publicPagePath('terms', props.language)}#terms-free-ai`}>{t.aiConsentTerms}</a>
      </p>
    </div>
  );
}
