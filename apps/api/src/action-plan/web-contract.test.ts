import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ACTION_PLAN_LANGUAGES, ACTION_PLAN_NOTICE_VERSION } from '@fluxradar/contracts';
import { RULE_TITLES } from '@fluxradar/rules';
import { describe, expect, it } from 'vitest';

// apps/web has no workspace dependencies, so what the Action Plan shares with
// it is declared twice. Read the web sources as text, as
// billing/checkout-metadata.test.ts does for the pre-purchase notice, and fail
// before deploy when a copy drifts.

function webSource(file: string): string {
  return readFileSync(resolve(process.cwd(), '..', 'web', 'src', file), 'utf8');
}

/** The source text between `export const <name>` and the end of its literal. */
function declaration(source: string, name: string, end: string): string {
  const start = source.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`the web source no longer declares ${name}`);
  const stop = source.indexOf(end, start);
  if (stop < 0) throw new Error(`the literal of ${name} has no end marker "${end}"`);
  return source.slice(start, stop);
}

describe('Action Plan declarations shared with the web app', () => {
  it('rule titles match apps/web/src/rule-titles.ts', () => {
    const table = declaration(webSource('rule-titles.ts'), 'RULE_TITLES', '\n};\n');
    const entries = [
      ...table.matchAll(/'([A-Z0-9-]+)':\s*\{\s*en:\s*'([^']*)',\s*uk:\s*'([^']*)',?\s*\}/g),
    ];
    // Every key must be read: an entry written in another shape (a double-quoted
    // string, a template) would otherwise be skipped instead of compared.
    expect(entries).toHaveLength([...table.matchAll(/^\s*'[A-Z0-9-]+':\s*\{/gm)].length);

    const webTitles = Object.fromEntries(
      entries.map(([, ruleId, en, uk]) => [ruleId as string, { en, uk }]),
    );
    expect(webTitles).toEqual(RULE_TITLES);
  });

  it('plan languages match the target-language picker in apps/web/src/target-languages.ts', () => {
    const list = declaration(webSource('target-languages.ts'), 'LANGUAGE_CODES', '] as const');
    const codes = [...list.matchAll(/'([a-z]+)'/g)].map(([, code]) => code);

    expect(codes).toEqual([...ACTION_PLAN_LANGUAGES]);
  });

  it('the consent notice version matches apps/web/src/action-plan-notice.ts', () => {
    const source = webSource('action-plan-notice.ts');
    const version = /ACTION_PLAN_NOTICE_VERSION\s*=\s*'([^']+)'/.exec(source)?.[1];

    expect(version).toBe(ACTION_PLAN_NOTICE_VERSION);
  });
});
