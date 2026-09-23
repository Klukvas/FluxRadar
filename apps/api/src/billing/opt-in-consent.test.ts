import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from '@fluxradar/ai';
import { describe, expect, it } from 'vitest';

import { assertOptInProvidersAvailable } from './opt-in-consent.ts';
import type { AiConsentInput } from './checkout-metadata.ts';

function consentOf(providers: AiConsentInput['providers']): AiConsentInput {
  return { providers, noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION };
}

describe('assertOptInProvidersAvailable', () => {
  it('accepts a scan that names no optional recipient', () => {
    expect(() =>
      assertOptInProvidersAvailable(consentOf(['anthropic', 'openai']), []),
    ).not.toThrow();
  });

  it('accepts an optional recipient this deployment can serve', () => {
    expect(() =>
      assertOptInProvidersAvailable(consentOf(['anthropic', 'openai', 'google']), ['google']),
    ).not.toThrow();
  });

  it('refuses an optional recipient this deployment cannot serve, naming it', () => {
    expect(() =>
      assertOptInProvidersAvailable(consentOf(['anthropic', 'openai', 'google']), ['perplexity']),
    ).toThrow(/google/);
  });

  it('names every unavailable recipient at once', () => {
    expect(() =>
      assertOptInProvidersAvailable(consentOf(['anthropic', 'google', 'perplexity']), []),
    ).toThrow(/google, perplexity/);
  });

  // The defaults are part of the purchased audit, not a choice the buyer made.
  // A missing key for one of them is an operator failure the scan reports as
  // Partial — refusing the whole checkout over it would help nobody.
  it('never refuses a checkout over a default provider', () => {
    expect(() =>
      assertOptInProvidersAvailable(consentOf(['anthropic', 'openai']), []),
    ).not.toThrow();
  });

  it('accepts a request that carries no consent at all', () => {
    expect(() => assertOptInProvidersAvailable(undefined, [])).not.toThrow();
  });
});
