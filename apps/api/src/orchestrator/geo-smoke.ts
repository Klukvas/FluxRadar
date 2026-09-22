// Live GEO smoke tool (plan phase 6). The owner runs it by hand, on a branch,
// before the OpenAI provider reaches production:
//
//   node --env-file=../../.env src/orchestrator/geo-smoke.ts <brand> <hostname>
//
// It asks each configured provider one real awareness question — the exact
// production prompt, with web search on — and prints what came back: the model
// that served it, how many searches it ran, what it cited, its usage, its
// finish reason, how long it took and what that request cost. It never touches
// the database and it never runs inside a test.

import {
  AiQuotaTracker,
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
  runAiRequest,
  type AiProviderName,
  type AiRequest,
} from '@fluxradar/ai';

import { buildGeoRequests, createDefaultAiProvider, GEO_VISIBILITY_PROVIDERS } from './geo.ts';

/**
 * Price card read from the providers' pricing pages on 2026-09-22, in US
 * dollars. Per million tokens for the model, per thousand calls for the search
 * tool. An unknown model prints no cost rather than a made-up one.
 */
interface ModelPrice {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
}

const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-sonnet-5': { inputPerMillion: 2, outputPerMillion: 10 },
  'claude-opus-5': { inputPerMillion: 15, outputPerMillion: 75 },
  'gpt-6-astra': { inputPerMillion: 10, outputPerMillion: 50 },
  'gpt-5.6-sol': { inputPerMillion: 4, outputPerMillion: 20 },
  'gpt-5.6-terra': { inputPerMillion: 2, outputPerMillion: 12 },
  'gpt-5.6-luna': { inputPerMillion: 0.2, outputPerMillion: 1.2 },
};

/** Both providers charge $10 per 1,000 server-side searches. */
const SEARCH_PRICE_PER_UNIT = 10 / 1000;

function costOf(
  modelId: string,
  usage: { inputTokens: number; outputTokens: number; searchUnits?: number },
): string {
  const price = MODEL_PRICES[modelId];
  if (price === undefined) return `unknown (no price card entry for ${modelId})`;
  const total =
    (usage.inputTokens / 1_000_000) * price.inputPerMillion +
    (usage.outputTokens / 1_000_000) * price.outputPerMillion +
    (usage.searchUnits ?? 0) * SEARCH_PRICE_PER_UNIT;
  return `$${total.toFixed(4)}`;
}

/** The first awareness question of a real scan, for one provider. */
function awarenessRequest(scanId: string, brand: string, provider: AiProviderName): AiRequest {
  const [request] = buildGeoRequests(scanId, brand, [], [provider]);
  if (request === undefined) throw new Error('geo-smoke: no awareness request was built');
  return request;
}

async function askOneProvider(
  provider: AiProviderName,
  scanId: string,
  brand: string,
  siteHostname: string,
): Promise<void> {
  const router = createDefaultAiProvider(brand, siteHostname);
  const request = awarenessRequest(scanId, brand, provider);
  const startedAt = Date.now();
  const { outcome } = await runAiRequest(request, {
    provider: router,
    quota: AiQuotaTracker.forPlan('Complete'),
    // Nothing is persisted, so this record only unlocks the request itself.
    consent: {
      scanId,
      providers: [...GEO_VISIBILITY_PROVIDERS],
      noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
    },
  });
  const elapsedMs = Date.now() - startedAt;

  console.log(`\n=== ${provider} (${elapsedMs} ms)`);
  console.log(`question: ${request.question}`);
  if (outcome.kind === 'unavailable') {
    console.log(`UNAVAILABLE ${outcome.reason}: ${outcome.detail}`);
    return;
  }
  const { response } = outcome;
  console.log(`model served:  ${response.modelId}`);
  console.log(`finish reason: ${response.finishReason}`);
  console.log(`searches:      ${response.usage.searchUnits ?? 0}`);
  console.log(`usage:         ${JSON.stringify(response.usage)} (${response.usageSource})`);
  console.log(`cost:          ${costOf(response.modelId, response.usage)}`);
  console.log(
    response.citations.length === 0
      ? 'citations:     none'
      : `citations:\n  ${response.citations.join('\n  ')}`,
  );
  console.log(`answer:\n${response.rawText}`);
}

async function main(): Promise<void> {
  // The whole point of this tool is that it spends money on a real provider.
  // A test that reached it would do the same.
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    throw new Error('geo-smoke: refusing to call a real provider from a test environment');
  }
  const [brand, siteHostname] = process.argv.slice(2);
  if (brand === undefined || siteHostname === undefined) {
    console.error('usage: node src/orchestrator/geo-smoke.ts <brand> <hostname>');
    process.exitCode = 1;
    return;
  }
  const scanId = `geo-smoke-${String(Date.now())}`;
  console.log(`GEO smoke: "${brand}" at ${siteHostname} — ${GEO_VISIBILITY_PROVIDERS.join(', ')}`);
  console.log('Nothing is written to the database.');
  // Sequential on purpose: this mirrors how a scan asks them, and it keeps the
  // printed elapsed time meaningful.
  for (const provider of GEO_VISIBILITY_PROVIDERS) {
    await askOneProvider(provider, scanId, brand, siteHostname);
  }
}

await main();
