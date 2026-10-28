// Ukrainian count agreement for the report's own sentences.
//
// Ukrainian picks one of three noun forms by the last digits of the count:
// 1, 21, 31… take the singular («1 критична проблема»), 2–4, 22–24… the
// paucal («3 критичні проблеми»), and everything else, the teens included, the
// genitive plural («5 критичних проблем», «12 критичних проблем»).

export type UkPluralForm = 'one' | 'few' | 'many';

export interface UkForms {
  readonly one: string;
  readonly few: string;
  readonly many: string;
}

export function ukPluralForm(count: number): UkPluralForm {
  const whole = Math.abs(Math.trunc(count));
  const lastTwo = whole % 100;
  const last = whole % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'many';
  if (last === 1) return 'one';
  if (last >= 2 && last <= 4) return 'few';
  return 'many';
}

/** The form of `forms` that agrees with `count`. */
export function ukPlural(count: number, forms: UkForms): string {
  return forms[ukPluralForm(count)];
}

/**
 * The form after «з N» / «у N»: a count ending in one keeps the singular
 * («з 1 сторінки», «у 21 проблемі»), every other count the plural.
 */
export function ukAfterCount(count: number, singular: string, plural: string): string {
  return ukPluralForm(count) === 'one' ? singular : plural;
}

/**
 * "{open} з {total} знахідок ще відкриті" with both counts agreed: «з 21
 * знахідки», «з 5 знахідок»; «1 … ще відкрита», «2 … ще відкриті».
 */
export function ukStillOpen(open: number, total: number): string {
  const noun = ukAfterCount(total, 'знахідки', 'знахідок');
  const adjective = ukAfterCount(open, 'відкрита', 'відкриті');
  return `${open} з ${total} ${noun} ще ${adjective}`;
}
