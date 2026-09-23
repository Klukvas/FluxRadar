// The checkout's own check on the opt-in AI recipients.
//
// Gemini and Perplexity are offered as a choice, and a choice this deployment
// cannot keep must be refused while it is still free to refuse it: before the
// payment, not after. Without this check a buyer who ticks an unconfigured
// recipient pays in full and gets a Partial GEO module, because the scan builds
// that provider's requests and every one of them fails closed
// (orchestrator/geo.ts → UnconfiguredProvider). The form hides what the
// deployment cannot serve; this is the same rule on the server, where a stale
// tab and a hand-written request meet it too.
//
// Only the provider NAME travels in the refusal. It is a public product fact —
// the pre-purchase notice names both companies — unlike which variable is
// absent, which describes how the deployment is wired and stays in the log.

import type { AiProviderName } from '@fluxradar/ai';
import { isOptInProvider } from '@fluxradar/ai';

import { validationError } from '../http/errors.ts';
import type { AiConsentInput } from './checkout-metadata.ts';

/**
 * Refuses a checkout whose stored consent would name an opt-in recipient this
 * deployment cannot serve. The default providers are never checked here: they
 * are part of the purchased audit, and a missing key for one of them is an
 * operator failure the scan reports as Partial rather than a choice the buyer
 * made.
 */
export function assertOptInProvidersAvailable(
  consent: AiConsentInput | undefined,
  available: readonly AiProviderName[],
): void {
  if (consent === undefined) return;
  const unavailable = consent.providers.filter(
    (provider) => isOptInProvider(provider) && !available.includes(provider),
  );
  if (unavailable.length === 0) return;
  throw validationError(
    `this deployment cannot send scan data to ${unavailable.join(', ')}; ` +
      'remove the optional AI recipient and run the scan again',
  );
}
