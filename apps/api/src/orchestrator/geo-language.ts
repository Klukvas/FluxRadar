import { brandIsHostname } from '@fluxradar/ai';
import type { GeoAnswerLanguage } from '@fluxradar/ai';

export const GEO_LANGUAGE_NAMES = { en: 'English', uk: 'Ukrainian', ru: 'Russian' } as const;

/** Undefined preserves historical prompts and request identities. */
export function geoAnswerInstructions(base: string, language?: GeoAnswerLanguage): string {
  return language === undefined ? base : `${base} Answer in ${GEO_LANGUAGE_NAMES[language]}.`;
}

export function localizedClosedBookQuestions(
  brand: string,
  siteDomain: string,
  language: 'uk' | 'ru',
): readonly [string, ...string[]] {
  const hostname = brandIsHostname(brand, siteDomain);
  if (language === 'uk') {
    const suffix =
      ' Якщо ви цього не знаєте, скажіть, що не маєте інформації, замість того щоб вгадувати.';
    return hostname
      ? [`Що вам відомо про бізнес, повʼязаний із ${siteDomain}?${suffix}`]
      : [
          `Що вам відомо про ${brand}?${suffix}`,
          `Які незалежно перевірювані факти ви можете повідомити про ${brand}? Назвіть офіційний сайт, якщо знаєте його, та зазначте, що не можете перевірити.${suffix}`,
        ];
  }
  const suffix =
    ' Если вы этого не знаете, скажите, что у вас нет информации, вместо того чтобы угадывать.';
  return hostname
    ? [`Что вам известно о бизнесе, связанном с ${siteDomain}?${suffix}`]
    : [
        `Что вам известно о ${brand}?${suffix}`,
        `Какие независимо проверяемые факты вы можете сообщить о ${brand}? Назовите официальный сайт, если знаете его, и укажите, что не можете проверить.${suffix}`,
      ];
}
