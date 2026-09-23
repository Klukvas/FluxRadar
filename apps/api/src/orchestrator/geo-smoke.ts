// Live smoke check for the GEO providers. The owner runs it by hand:
//
//   node --env-file=../../.env src/orchestrator/geo-smoke.ts <brand> <hostname> [provider...]
//
// It sends ONE awareness question to each configured provider with web search
// on, and prints what came back: the model that served it, the search count,
// the citations, the usage, the finish reason and the elapsed time. It never
// writes to the database, and it refuses to run under Vitest.
//
// All FOUR adapters are smokeable, not only the two a paid scan selects on its
// own: Gemini and Perplexity are the ones an owner most needs to try before a
// customer does, and filtering them out here left exactly those two unreachable.
// Naming providers on the command line narrows the run to them.
//
// This file is written and typechecked by the implementation; running it spends
// real money and is the owner's call.

import {
  AiQuotaTracker,
  AI_PROVIDER_NAMES,
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
  runAiRequest,
} from '@fluxradar/ai';
import type { AiConsent, AiProviderName } from '@fluxradar/ai';

import { readIntegrationConfig } from '../integrations/config.ts';
import { buildGeoRequests, createDefaultAiProvider, isTestRuntime } from './geo.ts';

function isProviderName(value: string): value is AiProviderName {
  return (AI_PROVIDER_NAMES as readonly string[]).includes(value);
}

/** The requested providers, or every one this environment has a key for. */
function smokeProviders(requested: readonly string[]): readonly AiProviderName[] {
  const unknown = requested.filter((name) => !isProviderName(name));
  if (unknown.length > 0) {
    throw new Error(
      `unknown provider ${unknown.join(', ')}; expected one of ${AI_PROVIDER_NAMES.join(', ')}`,
    );
  }
  const config = readIntegrationConfig();
  const keys: Readonly<Record<AiProviderName, string | null>> = {
    anthropic: config.anthropicApiKey,
    openai: config.openAiApiKey,
    google: config.googleAiApiKey,
    perplexity: config.perplexityApiKey,
  };
  const names = requested.length === 0 ? AI_PROVIDER_NAMES : requested.filter(isProviderName);
  return names.filter((provider) => keys[provider] !== null);
}

async function main(): Promise<void> {
  if (isTestRuntime()) {
    throw new Error('geo-smoke is a manual tool and does not run under Vitest');
  }
  const [brand, hostname, ...requested] = process.argv.slice(2);
  if (brand === undefined || hostname === undefined) {
    throw new Error('usage: geo-smoke.ts <brand> <hostname> [provider...]');
  }
  const providers = smokeProviders(requested);
  if (providers.length === 0) {
    throw new Error(
      requested.length === 0
        ? 'no GEO provider is configured; set the API keys first'
        : `no API key is configured for ${requested.join(', ')}`,
    );
  }

  const scanId = `smoke-${hostname}`;
  const consent: AiConsent = {
    scanId,
    providers: [...providers],
    noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
  };
  const provider = createDefaultAiProvider(brand, hostname);
  // One awareness question per provider: the first entry of each provider's list.
  const requests = buildGeoRequests(scanId, brand, [], providers).filter(
    (request) => request.sequence === 1,
  );

  for (const request of requests) {
    const startedAt = process.hrtime.bigint();
    const { outcome } = await runAiRequest(request, {
      provider,
      quota: AiQuotaTracker.withLimit(1),
      consent,
    });
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    if (outcome.kind === 'unavailable') {
      process.stdout.write(
        `${request.provider}: UNAVAILABLE (${outcome.reason}) — ${outcome.detail}\n`,
      );
      continue;
    }
    const { response } = outcome;
    process.stdout.write(
      [
        `${request.provider}: ok in ${elapsedMs.toFixed(0)} ms`,
        `  model served: ${response.modelId}`,
        `  finish reason: ${response.finishReason}`,
        `  searches: ${response.usage.searchUnits ?? 0}`,
        `  citations: ${response.citations.length === 0 ? '(none)' : response.citations.join(', ')}`,
        `  usage: ${JSON.stringify(response.usage)} (${response.usageSource})`,
        `  answer: ${response.rawText.slice(0, 400)}`,
        '',
      ].join('\n'),
    );
  }
}

await main();
