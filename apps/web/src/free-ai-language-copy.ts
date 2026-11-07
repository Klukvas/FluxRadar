// The Free check's "Language of the AI answer" selector (D-237, owner decision).
//
// Kept apart from i18n.ts and free-preview-copy.ts: the selector is one small
// control beside the AI consent box, and its words belong with it.

import type { Language } from './i18n';
import type { AiLanguageSource } from './site-language';

export interface FreeAiLanguageCopy {
  readonly label: string;
  /** Each option names its language in that language, as a language menu does. */
  readonly options: Readonly<Record<Language, string>>;
  /** One line under the selector: why this language was preselected. */
  readonly hint: Readonly<Record<AiLanguageSource, string>>;
  /** Shown instead when the owner picked the language themselves. */
  readonly chosen: string;
}

const OPTIONS: Readonly<Record<Language, string>> = { uk: 'Українська', en: 'English' };

export const freeAiLanguageCopy: Readonly<Record<Language, FreeAiLanguageCopy>> = {
  en: {
    label: 'Language of the AI answer',
    options: OPTIONS,
    hint: {
      site: 'Preselected from your site’s language.',
      interface: 'Preselected from the language you use FluxRadar in.',
    },
    chosen: 'The AI is asked and answers in the language you chose.',
  },
  uk: {
    label: 'Мова відповіді ШІ',
    options: OPTIONS,
    hint: {
      site: 'Вибрано за мовою вашого сайту.',
      interface: 'Вибрано за мовою, якою ви користуєтеся FluxRadar.',
    },
    chosen: 'ШІ запитають і він відповість мовою, яку ви вибрали.',
  },
};
