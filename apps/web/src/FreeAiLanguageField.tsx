// "Language of the AI answer" beside the Free check's AI consent box (D-237).
//
// Drawn only while the box is ticked: without consent no question is asked,
// and a language picker for a question that will not exist would mislead.
// The preselected language is the site's own when its profile names one, else
// the interface language; the hint under the control says which.
//
// Its own markup rather than `SelectField`: there the hint sits inside the
// label and becomes part of the control's name. Here the name is the label
// alone and the hint is the description.

import { useId } from 'react';

import { freeAiLanguageCopy } from './free-ai-language-copy';
import type { Language } from './i18n';
import type { FreeAiLanguage } from './use-free-ai-language';

const ORDER: readonly Language[] = ['uk', 'en'];

export function FreeAiLanguageField(props: { language: Language; aiLanguage: FreeAiLanguage }) {
  const t = freeAiLanguageCopy[props.language];
  const { aiLanguage } = props;
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {t.label}
      </label>
      <select
        id={id}
        className="control"
        name="scan-free-ai-language"
        value={aiLanguage.language}
        aria-describedby={hintId}
        onChange={(event) => {
          const chosen = ORDER.find((code) => code === event.target.value);
          if (chosen !== undefined) aiLanguage.choose(chosen);
        }}
      >
        {ORDER.map((code) => (
          <option key={code} value={code} lang={code}>
            {t.options[code]}
          </option>
        ))}
      </select>
      <span className="field__hint" id={hintId}>
        {aiLanguage.source === 'choice' ? t.chosen : t.hint[aiLanguage.source]}
      </span>
    </div>
  );
}
