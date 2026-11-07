import { useId } from 'react';

import { freeAiLanguageCopy } from './free-ai-language-copy';
import type { Language } from './i18n';
import { AI_LANGUAGES } from './site-language';
import type { FreeAiLanguage } from './use-free-ai-language';

const ORDER = AI_LANGUAGES;

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
        name="scan-ai-language"
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
