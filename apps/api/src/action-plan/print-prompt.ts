// Dry run: print exactly what an Action Plan request would send, and send
// nothing.
//
//   node --env-file-if-exists=../../.env src/action-plan/print-prompt.ts <scanId> <language>
//
// It is how the owner checks what leaves for Anthropic before trusting the
// feature, and where the quality gate starts. It never builds a provider, so it
// cannot call one even by accident.

import { buildActionPlanRequest, buildPrompt } from '@fluxradar/ai';
import { isActionPlanLanguage } from '@fluxradar/contracts';

import { createPrismaClient } from '../db.ts';
import { buildActionPlanScanInput } from './input-builder.ts';
import { isTestRuntime } from '../orchestrator/geo.ts';

async function main(): Promise<void> {
  if (isTestRuntime()) {
    throw new Error('print-prompt is a manual tool and does not run under Vitest');
  }
  const [scanId, language = 'en'] = process.argv.slice(2);
  if (scanId === undefined || scanId === '') {
    throw new Error('usage: print-prompt.ts <scanId> [language]');
  }
  if (!isActionPlanLanguage(language)) {
    throw new Error(`unknown plan language "${language}"`);
  }

  const prisma = createPrismaClient();
  try {
    const scan = await prisma.scan.findUniqueOrThrow({
      where: { id: scanId },
      select: { domain: true },
    });
    const input = await buildActionPlanScanInput(prisma, scanId, language);
    const request = buildActionPlanRequest({
      scanId,
      domain: scan.domain,
      language,
      modules: input.modules,
      rules: input.rules,
      consent: null,
    });
    const prompt = buildPrompt(request);
    process.stdout.write(
      [
        `# Action Plan dry run — scan ${scanId}, language ${language}`,
        `# rules: ${input.rules.length}, modules: ${input.modules.length}`,
        `# caps: ${JSON.stringify(request.caps)}`,
        `# prompt version: ${request.promptVersion}`,
        `# estimated input tokens: ${prompt.inputTokens} (truncated: ${String(prompt.truncated)})`,
        '',
        '## system instructions',
        request.systemInstructions,
        '',
        '## prompt text',
        prompt.promptText,
        '',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
