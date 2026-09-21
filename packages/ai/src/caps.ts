// Token caps of one AI request (plan §5). Every request is held to
// AI_REQUEST_CAPS unless it names its own: the prompt builder, the re-cap after
// redaction, both providers and the response contract all read the caps
// through here, so a request's own caps apply at every point that enforces one.

import { AI_REQUEST_CAPS } from '@fluxradar/contracts';

import type { AiRequest, AiRequestCaps } from './types.js';

export const DEFAULT_AI_REQUEST_CAPS: AiRequestCaps = {
  maxInputTokens: AI_REQUEST_CAPS.maxInputTokens,
  maxOutputTokens: AI_REQUEST_CAPS.maxOutputTokens,
};

/** The request's own caps, or the shared §5 caps when it names none. */
export function requestCaps(request: Pick<AiRequest, 'caps'>): AiRequestCaps {
  return request.caps ?? DEFAULT_AI_REQUEST_CAPS;
}
