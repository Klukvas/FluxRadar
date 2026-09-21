// Dry run of an Action Plan prompt for a stored scan (D-232).
//
// Builds the input exactly as a generation would and prints the system
// instructions and the prompt text a provider would receive — after redaction
// and the caps — without sending anything anywhere. The quality gate starts
// here: read what Claude would read before paying for what it writes.
//
//   cd apps/api
//   node --env-file-if-exists=../../.env src/action-plan/print-prompt.ts <scanId> <language>
//
// DATABASE_URL picks the database. Only the scan's id, domain, sections and
// issues are read, so a database that has not taken the Action Plan migration
// works too.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  UnavailableError,
  buildActionPlanRequest,
  runActionPlan,
  type AiProvider,
} from '@fluxradar/ai';
import { actionPlanLanguageSchema, type ActionPlanLanguage } from '@fluxradar/contracts';
import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../db.ts';
import { buildActionPlanInput } from './input.ts';

export interface PromptPreview {
  readonly systemInstructions: string;
  /** Exactly what the provider would receive as the user turn. */
  readonly promptText: string;
}

/** Records the prompt it is handed and refuses it: nothing leaves the process. */
function capturingProvider(): {
  readonly provider: AiProvider;
  readonly sent: () => string | null;
} {
  let captured: string | null = null;
  return {
    provider: {
      config: {
        provider: 'anthropic',
        apiVersion: 'dry-run',
        modelId: 'dry-run',
        timeoutMs: 1,
        maxRetries: 1,
      },
      send: async (_request, promptText) => {
        captured = promptText;
        throw new UnavailableError('dry run: the prompt is printed, not sent');
      },
    },
    sent: () => captured,
  };
}

export async function previewActionPlanPrompt(
  prisma: PrismaClient,
  scanId: string,
  language: ActionPlanLanguage,
): Promise<PromptPreview> {
  const scan = await prisma.scan.findUniqueOrThrow({
    where: { id: scanId },
    select: { id: true, domain: true, modules: true },
  });
  const input = await buildActionPlanInput(prisma, scan, language);
  if (input.rules.length === 0) {
    throw new Error(`scan ${scanId} has no open issue outside Analytics: nothing to plan`);
  }
  // The same pipeline a generation runs — consent, redaction, caps — so the
  // text printed is the text that would be sent.
  const capture = capturingProvider();
  await runActionPlan(input, { provider: capture.provider });
  const promptText = capture.sent();
  if (promptText === null) {
    throw new Error('the request stopped before it reached the provider (consent or redaction)');
  }
  return { systemInstructions: buildActionPlanRequest(input).systemInstructions, promptText };
}

export function formatPromptPreview(preview: PromptPreview): string {
  return [
    '=== system instructions ===',
    preview.systemInstructions,
    '',
    '=== prompt text, exactly as it would be sent ===',
    preview.promptText,
    '',
  ].join('\n');
}

async function main(args: readonly string[]): Promise<number> {
  const [scanId, languageArg] = args;
  const language = actionPlanLanguageSchema.safeParse(languageArg);
  if (scanId === undefined || !language.success) {
    process.stderr.write(
      'usage: node --env-file-if-exists=../../.env src/action-plan/print-prompt.ts <scanId> <language>\n',
    );
    return 2;
  }
  const prisma = createPrismaClient();
  try {
    process.stdout.write(
      formatPromptPreview(await previewActionPlanPrompt(prisma, scanId, language.data)),
    );
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
