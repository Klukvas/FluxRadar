// What an AI provider is called in the report, per language.
//
// Shared by the answer groups and the summary above them, so one assistant is
// never named two ways on the same screen.

import { copy, type Language } from './i18n';

export function geoProviderLabel(provider: string | null, language: Language): string {
  const t = copy[language].report;
  const names: Readonly<Record<string, string>> = {
    openai: t.geoProviderOpenai,
    anthropic: t.geoProviderAnthropic,
    google: t.geoProviderGoogle,
    perplexity: t.geoProviderPerplexity,
  };
  if (provider === null) return t.geoProviderUnknown;
  // An unknown name is shown as recorded rather than translated into a guess.
  return names[provider] ?? provider;
}
