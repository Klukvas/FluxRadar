// The web bundle deliberately has no workspace-package dependencies. The API
// contract test reads this declaration and fails if the worker and the notice
// shown before checkout ever drift apart again.
export const AI_PROCESSING_NOTICE_VERSION = 'core-ai-processing-notice-v4';

/**
 * The providers a paid scan asks by default, exactly as the notice names them.
 * The API pins this list against its own `GEO_VISIBILITY_PROVIDERS`.
 */
export const AI_PROCESSING_PROVIDERS = ['anthropic', 'openai'] as const;

/**
 * Providers a customer can add to their own scan, and which receive nothing
 * unless they do. The notice names the recipient before the choice is offered,
 * and the same exclusions apply: no account or payment data, no Google or Bing
 * tokens, no page evidence.
 */
export const AI_PROCESSING_OPT_IN_PROVIDERS = ['google', 'perplexity'] as const;

/** A recipient the owner may add. The form renders one control per name. */
export type AiProcessingOptInProvider = (typeof AI_PROCESSING_OPT_IN_PROVIDERS)[number];

export type AiProcessingProvider =
  (typeof AI_PROCESSING_PROVIDERS)[number] | AiProcessingOptInProvider;

/**
 * The notice shown beside the Action Plan button, sent with the click.
 *
 * Deliberately its own version, not the pre-purchase one: that notice covers
 * the AI work a paid scan does on its own, and this is a separate act the owner
 * asks for afterwards. Sharing a string would let a bump to either one silently
 * re-authorise the other. The API pins this constant and refuses a click whose
 * notice it does not publish.
 */
export const ACTION_PLAN_NOTICE_VERSION = 'action-plan-notice-v1';
