// The AI-processing record a Free check may carry (D-236).
//
// The Free GEO preview sends one closed-book question about the business to
// Anthropic and has Anthropic check that answer against the homepage evidence.
// The launch form sends this record while its box is ticked (the default), and
// a finished Free report whose box was unticked sends it from its "Add the AI
// answer" button, shown beside the same disclosure (late-free-preview.ts).
// It is deliberately narrower than the paid one (billing/checkout-metadata.ts):
// Anthropic and nobody else, and only the notice this release shows — both
// screens show the current notice, so an older accepted notice cannot describe
// what the owner was just shown. Anything else is refused at the boundary
// rather than narrowed, so a client cannot record consent it never displayed.

import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from '@fluxradar/ai';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

export const freeAiConsentSchema = z
  .object({
    providers: z.tuple([z.literal('anthropic')]),
    noticeVersion: z.literal(CURRENT_AI_PROCESSING_NOTICE_VERSION),
  })
  .strict();

export type FreeAiConsentInput = z.infer<typeof freeAiConsentSchema>;

/**
 * Writes the record in the transaction that creates the Free scan, or in the
 * one that claims its late preview (late-free-preview.ts).
 */
export async function recordFreeAiConsent(
  tx: Prisma.TransactionClient,
  params: {
    readonly accountId: string;
    readonly scanId: string;
    readonly consent: FreeAiConsentInput;
  },
): Promise<void> {
  await tx.aiConsent.create({
    data: {
      accountId: params.accountId,
      scanId: params.scanId,
      providersJson: JSON.stringify(params.consent.providers),
      noticeVersion: params.consent.noticeVersion,
    },
  });
}
