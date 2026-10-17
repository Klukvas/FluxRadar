// What the tests of the new-scan screen share for picking a plan.
//
// The plan used to be a `<select name="scan-plan">` that tests changed by
// value. It is a group of radio cards now, still named `scan-plan` and still
// carrying the plan identifier as each radio's value, so the tests keep
// choosing by identifier — the visible name differs by language ("Free" /
// "Безкоштовно") and would tie every caller to one of them.
//
// Not a test file: the name ends in `-support`, so vitest's own `*.test.*`
// pattern does not collect it.

import { fireEvent } from '@testing-library/react';

/** The radio for one plan, or null while the form does not offer it. */
export function queryPlanRadio(
  plan: string,
  container: ParentNode = document,
): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>(`input[name="scan-plan"][value="${plan}"]`);
}

/** The radio for one plan; throws when the form does not offer it. */
export function planRadio(plan: string, container: ParentNode = document): HTMLInputElement {
  const radio = queryPlanRadio(plan, container);
  if (radio === null) throw new Error(`the plan card for ${plan} is not on screen`);
  return radio;
}

/** Chooses a plan the way a buyer does: by clicking its card. */
export function choosePlanCard(plan: string, container: ParentNode = document): void {
  fireEvent.click(planRadio(plan, container));
}

/** The identifier of the chosen plan, or null when no card is chosen. */
export function checkedPlan(container: ParentNode = document): string | null {
  return (
    container.querySelector<HTMLInputElement>('input[name="scan-plan"]:checked')?.value ?? null
  );
}

/** Every plan the form offers right now, in the order the cards are drawn. */
export function offeredPlans(container: ParentNode = document): readonly string[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('input[name="scan-plan"]'),
    (radio) => radio.value,
  );
}
