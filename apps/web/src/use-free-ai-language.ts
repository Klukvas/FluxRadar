// Paid GEO choice remains part of the draft across site, plan and UI switches.
import { useState } from 'react';

import type { SiteProfile } from './api';
import type { Language } from './i18n';
import { defaultAiLanguage, type AiLanguage, type AiLanguageSource } from './site-language';

export interface FreeAiLanguage {
  /** The language the question will be asked in. */
  readonly language: AiLanguage;
  /** The interface default or the explicit paid GEO choice. */
  readonly source: AiLanguageSource | 'choice';
  readonly choose: (language: AiLanguage) => void;
}

export function useFreeAiLanguage(
  profile: SiteProfile | null,
  interfaceLanguage: Language,
): FreeAiLanguage {
  const [choice, setChoice] = useState<AiLanguage | null>(null);
  const fallback = defaultAiLanguage(profile, interfaceLanguage);
  return choice === null
    ? { language: fallback.language, source: fallback.source, choose: setChoice }
    : { language: choice, source: 'choice', choose: setChoice };
}
