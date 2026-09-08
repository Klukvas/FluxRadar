// Search queries an AI model thinks a site might be missing.
//
// These are hypotheses, not measurements, and everything here exists to keep
// that distinction impossible to lose. They are produced on request rather than
// during a scan; nothing is persisted; and the result is a closed union of
// states so the UI can say "the model was not asked", "the model was asked and
// answered nothing usable" and "here are some ideas" in three different ways.
//
// Two rules the validation enforces on the model's behalf:
//
//   1. An idea is a query string and a reason, and nothing else. The model is
//      given clicks and impressions as *context*, and any number it hands back
//      is dropped — a made-up metric next to measured ones is the one failure
//      this feature must not have.
//   2. An idea that repeats a query Search Console already measured is dropped.
//      The question is what the site might be missing, and a "suggestion" the
//      site already ranks for would be indistinguishable from a real row.

import type { AiProvider, AiRequest } from '@fluxradar/ai';
import { AnthropicProvider, buildPrompt, enforceInputCap, redact } from '@fluxradar/ai';
import { z } from 'zod';

import { ANTHROPIC_ENV_VARS, readAnthropicConfig } from '../anthropic-config.ts';
import type { SearchConsoleRow } from './types.ts';

export const QUERY_IDEAS_PROMPT_VERSION = 'gsc-query-ideas-v1';

/** The three languages the product's own audience actually searches in. */
export const QUERY_IDEA_LANGUAGES = ['ru', 'uk', 'en'] as const;
export type QueryIdeaLanguage = (typeof QUERY_IDEA_LANGUAGES)[number];

/** Per language, so one language cannot fill the whole block. */
export const MAX_IDEAS_PER_LANGUAGE = 6;
/** How many measured rows are worth showing the model as context. */
export const MAX_CONTEXT_ROWS = 20;
const MAX_QUERY_LENGTH = 80;
const MIN_QUERY_LENGTH = 2;
const MAX_RATIONALE_LENGTH = 220;

export const QUERY_IDEAS_SYSTEM_INSTRUCTIONS = [
  'You suggest search queries a website might be missing. You are not reporting data.',
  'Answer with a single JSON object and nothing else, in this exact shape:',
  '{"ideas":[{"query":"...","language":"ru|uk|en","rationale":"..."}]}',
  `Give at most ${MAX_IDEAS_PER_LANGUAGE} ideas per language, for all three of ru, uk and en.`,
  'A query is what a person would type into a search engine. Never include click counts,',
  'impression counts, positions, percentages or any other number presented as a measurement.',
  'Never repeat a query that already appears in the measured data you are shown.',
  'The rationale is one short sentence about why the query might fit this site.',
  'Write each query in its own language, not a transliteration of another one.',
].join('\n');

export interface QueryIdea {
  readonly query: string;
  readonly language: QueryIdeaLanguage;
  readonly rationale: string;
}

/**
 * What the endpoint can honestly report.
 *
 * `not_configured` and `failed` are deliberately different: one is a deployment
 * that never had an AI provider, the other is one that has it and did not get a
 * usable answer. `empty` is the model answering with nothing that survived
 * validation — reported as itself rather than dressed up as a failure or, worse,
 * padded with something invented.
 */
export type QueryIdeasResult =
  | {
      readonly state: 'generated';
      readonly ideas: readonly QueryIdea[];
      readonly model: string;
      readonly generatedAt: string;
    }
  | { readonly state: 'empty' }
  | { readonly state: 'not_configured' }
  | { readonly state: 'unavailable' }
  | { readonly state: 'failed' };

export interface QueryIdeasInput {
  readonly scanId: string;
  readonly siteUrl: string;
  readonly brand: string;
  readonly measuredQueries: readonly SearchConsoleRow[];
  readonly measuredPages: readonly SearchConsoleRow[];
}

const ideasSchema = z.object({
  ideas: z
    .array(
      z.object({
        query: z.string(),
        language: z.enum(QUERY_IDEA_LANGUAGES),
        rationale: z.string(),
      }),
    )
    .max(200),
});

/**
 * The prompt, as the metadata half of an `AiRequest`.
 *
 * Built through the same `buildPrompt` the GEO module uses, so the section
 * order, the input cap and the tokenizer are the ones the rest of the product
 * is written against rather than a second set of rules living here.
 */
export function buildQueryIdeasRequest(input: QueryIdeasInput): AiRequest {
  const measured = input.measuredQueries.slice(0, MAX_CONTEXT_ROWS);
  const pages = input.measuredPages.slice(0, MAX_CONTEXT_ROWS);
  return {
    scanId: input.scanId,
    provider: 'anthropic',
    promptVersion: QUERY_IDEAS_PROMPT_VERSION,
    sequence: 1,
    question:
      `Suggest search queries the site ${input.siteUrl} may be missing, ` +
      `in Russian, Ukrainian and English.`,
    brandFacts: [
      `The site is ${input.siteUrl}`,
      `The site is presented as "${input.brand}"`,
      ...measured.map(
        (row) =>
          `Already measured query: "${row.key}" ` +
          `(${row.clicks} clicks, ${row.impressions} impressions, position ${row.position.toFixed(1)})`,
      ),
    ],
    pageTitles: pages.map((row) => row.key),
    systemInstructions: QUERY_IDEAS_SYSTEM_INSTRUCTIONS,
  };
}

/**
 * The JSON object inside whatever the model actually sent.
 *
 * Models wrap JSON in prose and in fenced code blocks, so the outermost braces
 * are located rather than the whole answer being parsed. Anything that is not a
 * parseable object is not a partial answer to salvage — it is no answer.
 */
function jsonObjectIn(rawText: string): unknown {
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(rawText.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

/** Collapses whitespace so a multi-line answer cannot smuggle layout into a cell. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * The ideas worth showing, from the model's raw answer.
 *
 * Every rejection here is deliberate: a bounded, deduplicated, metric-free list
 * of at most `MAX_IDEAS_PER_LANGUAGE` per language, none of which repeats
 * something Search Console already measured.
 */
export function parseQueryIdeas(
  rawText: string,
  measuredQueries: readonly SearchConsoleRow[] = [],
): readonly QueryIdea[] {
  const parsed = ideasSchema.safeParse(jsonObjectIn(rawText));
  if (!parsed.success) return [];

  const measured = new Set(measuredQueries.map((row) => row.key.trim().toLowerCase()));
  const seen = new Set<string>();
  const perLanguage = new Map<QueryIdeaLanguage, number>();
  const ideas: QueryIdea[] = [];

  for (const candidate of parsed.data.ideas) {
    const query = oneLine(candidate.query);
    const rationale = oneLine(candidate.rationale);
    const key = query.toLowerCase();
    if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) continue;
    if (rationale === '') continue;
    // A "query" made only of digits and punctuation is a metric that escaped
    // the instruction not to send one, not something a person would search for.
    if (!/\p{Letter}/u.test(query)) continue;
    if (measured.has(key) || seen.has(key)) continue;
    if ((perLanguage.get(candidate.language) ?? 0) >= MAX_IDEAS_PER_LANGUAGE) continue;
    seen.add(key);
    perLanguage.set(candidate.language, (perLanguage.get(candidate.language) ?? 0) + 1);
    ideas.push({
      query,
      language: candidate.language,
      rationale: rationale.slice(0, MAX_RATIONALE_LENGTH),
    });
  }
  return ideas;
}

export interface QueryIdeasDeps {
  /** null when this deployment has no AI provider; nothing is sent anywhere. */
  readonly provider: AiProvider | null;
  readonly now: () => Date;
}

/**
 * Asks the model, and reports honestly whatever came back.
 *
 * The request goes through the same redaction the scan-time AI path uses and is
 * capped the same way, because the context it carries is the account's own
 * Search Console rows. A provider error is caught and reported as `failed`: an
 * optional idea block must never turn opening a report into an error.
 */
export async function generateQueryIdeas(
  input: QueryIdeasInput,
  deps: QueryIdeasDeps,
): Promise<QueryIdeasResult> {
  if (deps.provider === null) return { state: 'not_configured' };
  if (input.measuredQueries.length === 0) return { state: 'unavailable' };

  const request = buildQueryIdeasRequest(input);
  const prompt = buildPrompt(request);
  let promptText: string;
  try {
    // Fail-closed: a redaction pipeline that cannot finish blocks the send.
    promptText = enforceInputCap(redact(prompt.promptText).text).text;
  } catch {
    return { state: 'failed' };
  }

  try {
    const response = await deps.provider.send(request, promptText);
    const ideas = parseQueryIdeas(response.rawText, input.measuredQueries);
    if (ideas.length === 0) return { state: 'empty' };
    return {
      state: 'generated',
      ideas,
      model: response.modelId,
      generatedAt: deps.now().toISOString(),
    };
  } catch {
    // The provider's own message can carry account and quota metadata, so it is
    // never propagated; the caller logs by name and the reader gets a sentence.
    return { state: 'failed' };
  }
}

/**
 * The provider this deployment is configured with, or null.
 *
 * Null covers both "no key" and "a key with a model this release refuses to
 * use": neither can produce an answer, and naming the difference to the browser
 * would describe the server's configuration to anyone with an account.
 */
export function createQueryIdeasProvider(env: NodeJS.ProcessEnv = process.env): AiProvider | null {
  const config = readAnthropicConfig(env);
  if (config.state !== 'configured') return null;
  const apiKey = env[ANTHROPIC_ENV_VARS.apiKey]?.trim();
  if (apiKey === undefined || apiKey === '') return null;
  return new AnthropicProvider({
    apiKey,
    modelId: config.model,
    ...(env[ANTHROPIC_ENV_VARS.apiVersion] !== undefined
      ? { apiVersion: env[ANTHROPIC_ENV_VARS.apiVersion] }
      : {}),
  });
}
