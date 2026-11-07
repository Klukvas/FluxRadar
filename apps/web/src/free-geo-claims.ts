// Pure rules behind the Free report's AI block (FreeGeoClaims.tsx, D-237):
// which sentence leads it, how many claims fall in each state, and the order
// they are listed in. Kept apart from the markup so they are tested as rules.

import type { GeoClaimVerdict, GeoEvaluatedClaim, GeoEvaluation, ScanModule } from './api';
import type { Language } from './i18n';
import type { AiLanguage } from './site-language';

/** Contradictions first: they are the one thing an owner may need to act on. */
export const CLAIM_ORDER: readonly GeoClaimVerdict[] = ['contradicted', 'matched', 'unverified'];

export type ClaimCounts = Readonly<Record<GeoClaimVerdict, number>>;

/** The headline the block leads with — one per state, never more than the list says. */
export type FreeGeoHeadline =
  'mismatch' | 'confirmed' | 'partial' | 'unconfirmed' | 'nothing-checkable' | 'not-checked';

export function claimCounts(claims: readonly GeoEvaluatedClaim[]): ClaimCounts {
  return {
    contradicted: claims.filter((claim) => claim.verdict === 'contradicted').length,
    matched: claims.filter((claim) => claim.verdict === 'matched').length,
    unverified: claims.filter((claim) => claim.verdict === 'unverified').length,
  };
}

/** A new list, contradicted → matched → unverified, keeping the order within each. */
export function orderedClaims(claims: readonly GeoEvaluatedClaim[]): GeoEvaluatedClaim[] {
  return CLAIM_ORDER.flatMap((verdict) => claims.filter((claim) => claim.verdict === verdict));
}

/**
 * Derived from the claims on screen, like the paid badge (shownVerdict): the
 * headline must never claim more than the list printed under it.
 */
export function freeGeoHeadline(evaluation: GeoEvaluation | null): FreeGeoHeadline {
  if (evaluation === null || evaluation.status === 'Unavailable') return 'not-checked';
  const counts = claimCounts(evaluation.claims);
  if (evaluation.claims.length === 0) return 'nothing-checkable';
  if (counts.contradicted > 0) return 'mismatch';
  if (counts.matched === evaluation.claims.length) return 'confirmed';
  return counts.matched > 0 ? 'partial' : 'unconfirmed';
}

/**
 * The language the AI question was asked in, from the GEO row's metadata
 * (`language`, written by the API since W1/D-237) — or null for a row that
 * predates it or holds anything else. Never guessed from the text.
 */
export function aiAnswerLanguage(module: ScanModule | undefined): AiLanguage | null {
  const language = module?.metadata?.language;
  return language === 'uk' || language === 'en' || language === 'ru' ? language : null;
}

/**
 * The `lang` attribute for model-written text, so a screen reader voices a
 * Ukrainian answer in Ukrainian on an English report; nothing when unknown.
 */
export function aiTextLang(answerLanguage: AiLanguage | null): { lang?: AiLanguage } {
  return answerLanguage === null ? {} : { lang: answerLanguage };
}

/**
 * The API names profile evidence in English (packages/ai geo-evidence
 * PROFILE_FIELDS). These are the only labels it ever gives a profile source,
 * so a Ukrainian reader gets them in Ukrainian; anything else — page titles,
 * which are the site's own text — is left as it came.
 */
export const PROFILE_LABELS_UK: Readonly<Record<string, string>> = {
  'Brand name': 'Назва бренду',
  'Business description': 'Опис бізнесу',
  'Services or products': 'Послуги або товари',
  'Industry or site type': 'Галузь або тип сайту',
  'Operating region': 'Регіон роботи',
  'Target audience': 'Цільова аудиторія',
  'Primary language': 'Основна мова',
  'Target languages': 'Цільові мови',
};

/** The same labels for the Russian interface, worded as the Ukrainian ones are. */
export const PROFILE_LABELS_RU: Readonly<Record<string, string>> = {
  'Brand name': 'Название бренда',
  'Business description': 'Описание бизнеса',
  'Services or products': 'Услуги или товары',
  'Industry or site type': 'Отрасль или тип сайта',
  'Operating region': 'Регион работы',
  'Target audience': 'Целевая аудитория',
  'Primary language': 'Основной язык',
  'Target languages': 'Целевые языки',
};

const PROFILE_LABELS: Readonly<Record<Language, Readonly<Record<string, string>> | null>> = {
  en: null,
  uk: PROFILE_LABELS_UK,
  ru: PROFILE_LABELS_RU,
};

export function evidenceLabel(kind: string, label: string, language: Language): string {
  const names = PROFILE_LABELS[language];
  if (names === null || kind !== 'profile') return label;
  return names[label] ?? label;
}
