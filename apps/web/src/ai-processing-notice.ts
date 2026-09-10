// The web bundle deliberately has no workspace-package dependencies. The API
// contract test reads this declaration and fails if the worker and the notice
// shown before checkout ever drift apart again.
export const AI_PROCESSING_NOTICE_VERSION = 'core-ai-processing-notice-v3';
