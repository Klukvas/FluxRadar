// The web bundle deliberately has no workspace-package dependencies. The API
// contract test reads these declarations and fails if the worker and the notice
// shown before checkout ever drift apart again.
export const AI_PROCESSING_NOTICE_VERSION = 'core-ai-processing-notice-v4';

/** The AI providers the pre-purchase notice names, in the order it names them. */
export const AI_PROCESSING_PROVIDERS = ['anthropic', 'openai'] as const;
