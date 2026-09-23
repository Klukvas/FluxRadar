// The declarations the Action Plan needs on both sides of the wire.
//
// `apps/web` has no workspace dependency on purpose, so the owner-facing rule
// titles, the plan language list and the notice version sent with a click are
// each declared twice. This test reads the web source and fails when a copy
// drifts — the API would otherwise send Anthropic a rule id where the report
// shows a sentence, reject a language the picker offers, or refuse every click
// because the button names a notice this release does not publish.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ACCEPTED_AI_PROCESSING_NOTICE_VERSIONS,
  ACTION_PLAN_EXCLUDED_MODULE,
  ACTION_PLAN_NOTICE_VERSION,
} from '@fluxradar/ai';
import { ACTION_PLAN_LANGUAGES } from '@fluxradar/contracts';
import { RULE_TITLES } from '@fluxradar/rules';
import { describe, expect, it } from 'vitest';

function webSource(file: string): string {
  return readFileSync(resolve(process.cwd(), '..', 'web', 'src', file), 'utf8');
}

/** The `'ID': { en: '…', uk: '…' }` entries of the web RULE_TITLES literal. */
function webRuleTitles(): Map<string, { en: string; uk: string }> {
  const source = webSource('rule-titles.ts');
  const start = source.indexOf('export const RULE_TITLES');
  const body = source.slice(start, source.indexOf('\n};', start));
  const entries = new Map<string, { en: string; uk: string }>();
  const pattern =
    /'([A-Z0-9-]+)':\s*\{\s*en:\s*'((?:[^'\\]|\\.)*)',\s*uk:\s*'((?:[^'\\]|\\.)*)',?\s*\}/g;
  for (const match of body.matchAll(pattern)) {
    entries.set(match[1] ?? '', { en: match[2] ?? '', uk: match[3] ?? '' });
  }
  return entries;
}

describe('Action Plan declarations shared with the web app', () => {
  it('carries the same owner-facing rule titles as the report', () => {
    const web = webRuleTitles();

    expect(web.size).toBeGreaterThan(40);
    expect([...web.keys()].sort()).toEqual(Object.keys(RULE_TITLES).sort());
    for (const [ruleId, title] of web) {
      expect(RULE_TITLES[ruleId]).toEqual(title);
    }
  });

  it('carries the same plan languages as the profile picker', () => {
    const source = webSource('target-languages.ts');
    const literal = /LANGUAGE_CODES\s*=\s*\[([^\]]*)\]/.exec(source)?.[1] ?? '';
    const codes = [...literal.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);

    expect(codes).toEqual([...ACTION_PLAN_LANGUAGES]);
  });

  // The report decides whether to offer the button from its own issue summary,
  // and it has to leave out the one section a plan can never be written from.
  // Spell the section differently on either side and the report offers a button
  // the server answers with ACTION_PLAN_NOTHING_TO_PLAN.
  it('names the unplannable section exactly as the API excludes it', () => {
    const source = webSource('rule-titles.ts');
    const declared = /ANALYTICS_MODULE\s*=\s*'([^']+)'/.exec(source)?.[1];

    expect(declared).toBe(ACTION_PLAN_EXCLUDED_MODULE);
  });

  it('sends the click notice the API publishes, never the purchase one', () => {
    const source = webSource('ai-processing-notice.ts');
    const clicked = /ACTION_PLAN_NOTICE_VERSION\s*=\s*'([^']+)'/.exec(source)?.[1];

    expect(clicked).toBe(ACTION_PLAN_NOTICE_VERSION);
    // Two notices, two purposes: the pre-purchase one covers the AI work the
    // price already includes, this one a request the owner asks for afterwards.
    // Reusing either string would let a bump to one silently re-authorise the
    // other, and would misreport which disclosure was on screen at the click.
    expect(ACCEPTED_AI_PROCESSING_NOTICE_VERSIONS).not.toContain(clicked);
  });
});
