// The profile's target languages, picked from a list instead of typed.
//
// See `target-languages.ts` for why the stored text is English names. The list
// opens in place rather than floating over the form: the fields below it move
// down instead of being covered, and nothing has to be dismissed to go on.

import { useId } from 'react';

import { Checkbox } from './components';
import type { Language } from './i18n';
import {
  TARGET_LANGUAGE_NAMES,
  formatTargetLanguages,
  parseTargetLanguages,
  targetLanguageLabel,
} from './target-languages';

export function TargetLanguagesField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  hint: string;
  language: Language;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const summaryId = `${id}-summary`;
  const selected = parseTargetLanguages(props.value);
  // Entries an older free-text value named that the list does not: shown first
  // and ticked, so the owner sees them and can untick them.
  const unlisted = selected.filter((name) => !TARGET_LANGUAGE_NAMES.includes(name));
  const toggle = (name: string, checked: boolean): void =>
    props.onChange(
      formatTargetLanguages(
        checked ? [...selected, name] : selected.filter((entry) => entry !== name),
      ),
    );
  return (
    <div className="field">
      <span className="field__label" id={labelId}>
        {props.label}
      </span>
      <details className="language-picker">
        <summary
          className="control language-picker__summary"
          aria-labelledby={`${labelId} ${summaryId}`}
        >
          <span
            id={summaryId}
            className={selected.length === 0 ? 'language-picker__placeholder' : undefined}
          >
            {selected.length === 0
              ? props.placeholder
              : selected.map((name) => targetLanguageLabel(name, props.language)).join(', ')}
          </span>
        </summary>
        <div className="language-picker__options" role="group" aria-labelledby={labelId}>
          {[...unlisted, ...TARGET_LANGUAGE_NAMES].map((name) => (
            <Checkbox
              key={name}
              name="profile-languages"
              label={targetLanguageLabel(name, props.language)}
              checked={selected.includes(name)}
              onChange={(checked) => toggle(name, checked)}
            />
          ))}
        </div>
      </details>
      <span className="field__hint">{props.hint}</span>
    </div>
  );
}
