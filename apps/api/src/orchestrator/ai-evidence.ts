import { redact, type AiResponseOutcome } from '@fluxradar/ai';
import type { Prisma, PrismaClient } from '@prisma/client';

/** Works both on the root client and inside a `$transaction` callback. */
type DbClient = PrismaClient | Prisma.TransactionClient;

/** Private scan data uses the same fail-closed redaction as provider input. */
export function redactEvidence(value: unknown): unknown {
  if (typeof value === 'string') return redact(value).text;
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactEvidence(entry)]),
    );
  }
  return value;
}

export async function persistAiResponse(
  prisma: DbClient,
  scanId: string,
  module: 'AI SEO / GEO' | 'UX/Conversion',
  outcome: AiResponseOutcome,
): Promise<void> {
  const { response, request } = outcome;
  await prisma.aiResponseRecord.upsert({
    where: { aiRequestKey: outcome.aiRequestKey },
    create: {
      scanId,
      module,
      provider: response.provider,
      apiVersion: response.apiVersion,
      modelId: response.modelId,
      promptVersion: request.promptVersion,
      promptText: outcome.promptText,
      requestId: response.requestId,
      requestIdSource: response.requestIdSource,
      aiRequestKey: outcome.aiRequestKey,
      usageJson: JSON.stringify(response.usage),
      usageSource: response.usageSource,
      tokenizerVersion: response.tokenizerVersion ?? null,
      rawText: redact(response.rawText).text,
      citationsJson: JSON.stringify(response.citations.map((citation) => redact(citation).text)),
      finishReason: response.finishReason,
      deletionEvidenceRef: `ai-001/deletion/${outcome.aiRequestKey}`,
      createdAt: new Date(response.createdAt),
    },
    update: {},
  });
}
