import { FieldRow } from './components';
import type { Language } from './i18n';
import type { AiLanguage } from './site-language';

/** The optional single answer is separate from a paid GEO visibility audit. */
export const freeAiSummaryCopy = {
  en: {
    label: 'Claude answer',
    notRequested: 'not requested',
    answer: { uk: 'one, in Ukrainian', en: 'one, in English', ru: 'one, in Russian' },
    fullGeoExcluded: 'Full GEO audit not included',
  },
  uk: {
    label: 'Відповідь Claude',
    notRequested: 'не запитується',
    answer: { uk: 'одна, українською', en: 'одна, англійською', ru: 'одна, російською' },
    fullGeoExcluded: 'Повна GEO-перевірка не входить',
  },
  ru: {
    label: 'Ответ Claude',
    notRequested: 'не запрашивается',
    answer: { uk: 'один, на украинском', en: 'один, на английском', ru: 'один, на русском' },
    fullGeoExcluded: 'Полная GEO-проверка не входит',
  },
} as const;

export function FreeAiSummary(props: {
  language: Language;
  consent: boolean;
  answerLanguage: AiLanguage;
}) {
  const c = freeAiSummaryCopy[props.language];
  return (
    <FieldRow
      label={c.label}
      value={props.consent ? c.answer[props.answerLanguage] : c.notRequested}
    />
  );
}
