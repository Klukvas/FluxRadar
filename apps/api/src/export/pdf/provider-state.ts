// Why a search provider produced no figures, in the document's language.
//
// Both snapshots carry a `state` from a closed vocabulary
// (`integrations/google/types.ts`, `integrations/bing/types.ts`) and an English
// `detail` sentence written when the scan ran. The document printed the sentence,
// so the most ordinary configuration there is — nothing connected — produced a
// Ukrainian report that stated the same fact twice, once in Ukrainian in the
// Sections table and once in English under the Search data heading.
//
// The STATE is the stable part; the sentence is written here, per state, in both
// languages. The stored `detail` is still used, as the quote for a state this
// build has no copy for: naming the fact in the provider's own words is worse
// than reading it in the reader's language, and better than guessing at it.
//
// The browser report has done exactly this since `GoogleDataPanel.tsx` and
// `BingDataPanel.tsx`; the wording here follows theirs so one scan does not say
// two different things in two deliverables.

import type { FindingLanguage } from '@fluxradar/rules';

import type { BingDataState } from '../../integrations/bing/types.ts';
import type { GoogleDataState } from '../../integrations/google/types.ts';

type StateCopy<State extends string> = Readonly<Record<State, string>>;

const GOOGLE_EN: StateCopy<GoogleDataState> = {
  // Reached only when Google answered and the summary still carries no figures.
  // Stated as that rather than as "data received", which would be a claim the
  // empty section beside it contradicts.
  connected: 'Google answered for this period but stated no figures for it.',
  not_connected: 'Google is not connected for this workspace.',
  no_property_selected: 'No Google property is linked to this profile yet.',
  needs_reconnect: 'Google access has expired or was revoked. Reconnect Google to continue.',
  no_access: 'This Google account cannot read the selected property.',
  no_data: 'Google has no data for this site in the selected period.',
  request_failed: 'Google did not respond in time. The rest of the report is unaffected.',
};

const GOOGLE_UK: StateCopy<GoogleDataState> = {
  connected: 'Google відповів за цей період, але не надав жодних значень.',
  not_connected: 'Google не підключено для цього робочого простору.',
  no_property_selected: 'Із цим профілем ще не звʼязано жодного ресурсу Google.',
  needs_reconnect:
    'Доступ до Google минув або його відкликано. Підключіть Google заново, щоб продовжити.',
  no_access: 'Цей акаунт Google не може читати вибраний ресурс.',
  no_data: 'Google не має даних про цей сайт за вибраний період.',
  request_failed: 'Google не відповів вчасно. На решту звіту це не впливає.',
};

const BING_EN: StateCopy<BingDataState> = {
  connected: 'Bing answered for this period but stated no figures for it.',
  not_connected: 'Bing Webmaster Tools is not connected for this workspace.',
  no_property_selected: 'No Bing site is linked to this profile yet.',
  needs_reconnect:
    'Bing access has expired or was revoked. Reconnect Bing Webmaster Tools to continue.',
  no_access: 'This Bing account cannot read the selected site.',
  no_data: 'Bing has no data for this site in the selected period.',
  not_verified: 'Bing has not verified ownership of this site yet.',
  request_failed:
    'Bing did not answer, or answered with data FluxRadar could not read. The rest of the ' +
    'report is unaffected.',
};

const BING_UK: StateCopy<BingDataState> = {
  connected: 'Bing відповів за цей період, але не надав жодних значень.',
  not_connected: 'Bing Webmaster Tools не підключено для цього робочого простору.',
  no_property_selected: 'До цього профілю ще не привʼязано сайт Bing.',
  needs_reconnect:
    'Доступ до Bing закінчився або його відкликано. Перепідключіть Bing Webmaster Tools.',
  no_access: 'Цей акаунт Bing не може читати вибраний сайт.',
  no_data: 'Bing не має даних для цього сайту за вибраний період.',
  not_verified: 'Bing ще не підтвердив право власності на цей сайт.',
  request_failed:
    'Bing не відповів або відповів даними, які FluxRadar не зміг прочитати. Решту звіту це не ' +
    'змінює.',
};

const GOOGLE_STATE_COPY: Readonly<Record<FindingLanguage, StateCopy<GoogleDataState>>> = {
  en: GOOGLE_EN,
  uk: GOOGLE_UK,
};

const BING_STATE_COPY: Readonly<Record<FindingLanguage, StateCopy<BingDataState>>> = {
  en: BING_EN,
  uk: BING_UK,
};

/** One service result, as either snapshot stores it. */
export interface ProviderServiceState {
  readonly state: string;
  /** The English sentence the scan stored. Used only as the unknown-state quote. */
  readonly detail: string;
}

function stated(
  catalogue: Readonly<Record<string, string | undefined>>,
  service: ProviderServiceState,
): string {
  return catalogue[service.state] ?? service.detail;
}

/** Why Search Console or Analytics 4 has no figures here, in the reader's language. */
export function googleStateText(service: ProviderServiceState, language: FindingLanguage): string {
  return stated(GOOGLE_STATE_COPY[language], service);
}

/** Why the Bing section has no figures here, in the reader's language. */
export function bingStateText(service: ProviderServiceState, language: FindingLanguage): string {
  return stated(BING_STATE_COPY[language], service);
}
