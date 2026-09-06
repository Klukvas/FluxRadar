import { scanScopeSchema } from '@fluxradar/contracts';
import { AI_PROVIDER_NAMES } from '@fluxradar/ai';
import { z } from 'zod';

// What a paid checkout carries besides the plan: the crawl scope of the request
// and the per-scan AI consent (§5). Both are captured server-side when the
// checkout starts and are applied atomically with the Scan the payment creates —
// they are never read back from the browser or from a provider payload.

export const aiConsentSchema = z.object({
  providers: z.array(z.enum(AI_PROVIDER_NAMES)).min(1),
  noticeVersion: z.string().min(1),
});
export type AiConsentInput = z.infer<typeof aiConsentSchema>;

export const checkoutMetadataSchema = z.object({
  scope: scanScopeSchema.optional(),
  aiConsent: aiConsentSchema.optional(),
});
export type CheckoutMetadata = z.infer<typeof checkoutMetadataSchema>;
