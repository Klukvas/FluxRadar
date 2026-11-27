// What a paid check needs to ask the AI about the site's market.
//
// The paid AI SEO / GEO section asks two kinds of question: about the business
// by name, and about its market — "dental implants, Kyiv", the thing a customer
// types — with web search. The market questions are written from the profile's
// services and industry (apps/api orchestrator/geo.ts, `neutralContext`); with
// both empty none is written, and the section quietly comes back as "the AI
// does not know you", the one thing the Free check already said. A check sold
// on "who the AI recommends instead of you" must not be sold that way.
//
// So a paid launch for such a site asks for one of the two right above the pay
// button, and sends it in the same profile write the form already makes before
// checkout: a separate write would move the profile's configuration version
// and the form's own write would then be refused as stale.

import { useState } from 'react';

import type { SiteProfile } from './api';
import { PLAN_MODULES, type Plan } from './plan-modules';

const GEO_MODULE = 'AI SEO / GEO';

/** The API's limits (packages/contracts siteProfileInputSchema). */
export const OFFERINGS_MAX_LENGTH = 1200;
export const INDUSTRY_MAX_LENGTH = 64;

export interface MarketContextGate {
  /** The plan asks market questions and the site has nothing to write them from. */
  readonly missing: boolean;
  /** Missing, and nothing typed yet: the pay button waits. */
  readonly blocking: boolean;
  readonly offerings: string;
  readonly industry: string;
  readonly setOfferings: (value: string) => void;
  readonly setIndustry: (value: string) => void;
  /** The fields to add to the profile write before checkout; empty when none. */
  readonly patch: { readonly offerings?: string; readonly industry?: string };
}

function isBlank(value: string | null | undefined): boolean {
  return (value ?? '').trim() === '';
}

export function asksMarketQuestions(plan: Plan): boolean {
  return PLAN_MODULES[plan].includes(GEO_MODULE);
}

export function useMarketContextGate(
  profile: SiteProfile | undefined,
  plan: Plan,
): MarketContextGate {
  // Keyed on the site: what was typed for one site is not carried to another.
  const [typed, setTyped] = useState({ profileId: '', offerings: '', industry: '' });
  const profileId = profile?.id ?? '';
  const current = typed.profileId === profileId ? typed : { offerings: '', industry: '' };
  const missing =
    profile !== undefined &&
    asksMarketQuestions(plan) &&
    isBlank(profile.offerings) &&
    isBlank(profile.industry);
  const offerings = current.offerings.trim();
  const industry = current.industry.trim();
  return {
    missing,
    blocking: missing && offerings === '' && industry === '',
    offerings: current.offerings,
    industry: current.industry,
    setOfferings: (value) => setTyped({ ...current, profileId, offerings: value }),
    setIndustry: (value) => setTyped({ ...current, profileId, industry: value }),
    patch: missing
      ? {
          ...(offerings === '' ? {} : { offerings }),
          ...(industry === '' ? {} : { industry }),
        }
      : {},
  };
}
