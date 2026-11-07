// The Free check's AI-answer language, as the new-scan form holds it (D-237).
//
// The default follows the site being checked, so the owner's explicit choice is
// dropped when they switch to another site: the next site's own language is
// the better guess, and a choice made for one business is not carried to another.

import { useEffect, useState } from 'react';

import type { SiteProfile } from './api';
import type { Language } from './i18n';
import { defaultAiLanguage, type AiLanguageSource } from './site-language';

export interface FreeAiLanguage {
  /** The language the question will be asked in. */
  readonly language: Language;
  /** Why: the site's language, the interface language, or the owner's choice. */
  readonly source: AiLanguageSource | 'choice';
  readonly choose: (language: Language) => void;
}

export function useFreeAiLanguage(
  profile: SiteProfile | null,
  interfaceLanguage: Language,
): FreeAiLanguage {
  const [choice, setChoice] = useState<Language | null>(null);
  const profileId = profile?.id ?? null;
  useEffect(() => {
    setChoice(null);
  }, [profileId]);
  const fallback = defaultAiLanguage(profile, interfaceLanguage);
  return choice === null
    ? { language: fallback.language, source: fallback.source, choose: setChoice }
    : { language: choice, source: 'choice', choose: setChoice };
}
