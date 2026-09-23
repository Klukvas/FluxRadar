import { describe, expect, it } from 'vitest';

import {
  FINDING_MESSAGES,
  MODULE_MESSAGE_CATALOGS,
  RENDER_ONLY_MESSAGE_CODES,
  placeholdersOf,
  renderFindingMessage,
  renderTemplate,
  type FindingMessageCatalog,
} from './index.js';

// Findings used to store one finished Russian sentence, shown unchanged to
// English and Ukrainian readers. The catalog is what replaced it, so these
// checks guard the two ways it can quietly go wrong: a translation that names
// different values than the English one, and Russian creeping back in.

const CATALOG = FINDING_MESSAGES as FindingMessageCatalog;

describe('the finding message catalog', () => {
  it('gives no two modules the same code', () => {
    const total = MODULE_MESSAGE_CATALOGS.reduce(
      (sum, catalog) => sum + Object.keys(catalog).length,
      0,
    );
    expect(Object.keys(CATALOG)).toHaveLength(total);
  });

  it('writes every message in every language', () => {
    for (const [code, template] of Object.entries(CATALOG)) {
      expect({ code, en: template.en.trim() !== '', uk: template.uk.trim() !== '' }).toEqual({
        code,
        en: true,
        uk: true,
      });
    }
  });

  it('names the same values in every language of a message', () => {
    for (const [code, template] of Object.entries(CATALOG)) {
      expect({ code, values: [...placeholdersOf(template.uk)].sort() }).toEqual({
        code,
        values: [...placeholdersOf(template.en)].sort(),
      });
    }
  });

  it('keeps Cyrillic out of the English text', () => {
    for (const [code, template] of Object.entries(CATALOG)) {
      expect({ code, cyrillic: /\p{Script=Cyrillic}/u.test(template.en) }).toEqual({
        code,
        cyrillic: false,
      });
    }
  });
});

describe('braces in the catalog', () => {
  // The values a rule must pass are derived at compile time from the English
  // template, by a type that reads every `{…}` as a value name. A literal brace
  // elsewhere in the copy would make that list disagree with what rendering
  // actually fills in, and the compile-time check would demand the wrong keys.
  it('are used only to name a value', () => {
    for (const [code, template] of Object.entries(CATALOG)) {
      for (const text of [template.en, template.uk]) {
        const withoutValueNames = text.replace(/\{[A-Za-z][A-Za-z0-9]*\}/g, '');
        expect({ code, stray: /[{}]/.test(withoutValueNames) }).toEqual({ code, stray: false });
      }
    }
  });
});

describe('rendering a message', () => {
  it('fills in every value it names', () => {
    expect(renderTemplate('Pages: {count} of {checked}', { count: 1, checked: 4 })).toBe(
      'Pages: 1 of 4',
    );
  });

  it('answers null rather than a sentence with a hole in it', () => {
    expect(renderTemplate('Pages: {count} of {checked}', { count: 1 })).toBeNull();
  });

  it('leaves braces that are not a value name as text', () => {
    expect(renderTemplate('JSON-LD {"@type": {type}}', { type: 'Organization' })).toBe(
      'JSON-LD {"@type": Organization}',
    );
  });

  it('does not render a code this build does not know', () => {
    expect(renderFindingMessage({ code: 'unknown.evidence', params: {} }, 'en')).toBeNull();
  });
});

// A finding stores its message code, and the report renders the code rather than
// the sentence stored with it. A code a rule stopped using therefore still has
// readers: the findings of every scan that ran before the change.

describe('historical message codes', () => {
  it('are all still in the catalog, in every language', () => {
    for (const code of RENDER_ONLY_MESSAGE_CODES) {
      const template = CATALOG[code];
      expect({ code, known: template !== undefined }).toEqual({ code, known: true });
      expect({ code, en: template?.en.trim() !== '', uk: template?.uk.trim() !== '' }).toEqual({
        code,
        en: true,
        uk: true,
      });
    }
  });

  it('render a CONTENT-004 row stored with four failure kinds, in both languages', () => {
    // Reproduced defect: with `unconfirmed` dropped from the template, this row
    // rendered "Broken media: 3" and then listed one of them — in English to a
    // Ukrainian reader too, because the localized rendering wins over the stored
    // sentence.
    const stored = {
      code: 'content-004.evidence.mixed',
      params: {
        count: 3,
        unreachable: '—',
        httpErrors: '—',
        htmlResponses: 'img[src="/other.html"]',
        unconfirmed: 'img[src="/img/a.png"], img[src="/img/b.png"]',
      },
    };
    expect(renderFindingMessage(stored, 'en')).toBe(
      'Broken media: 3. Unreachable: —. HTTP error: —. Returns an HTML page instead of media: ' +
        'img[src="/other.html"]. Internal, not confirmed by the crawl: img[src="/img/a.png"], img[src="/img/b.png"].',
    );
    expect(renderFindingMessage(stored, 'uk')).toContain(
      'Внутрішні, не підтверджені обходом: img[src="/img/a.png"], img[src="/img/b.png"].',
    );
  });

  it('render a CONTENT-004 row whose only kind was the unconfirmed one', () => {
    const stored = {
      code: 'content-004.evidence.unconfirmed',
      params: { count: 2, items: 'img[src="/img/a.png"], img[src="/img/b.png"]' },
    };
    expect(renderFindingMessage(stored, 'en')).toBe(
      'Internal media the crawl could not confirm (2): img[src="/img/a.png"], img[src="/img/b.png"]',
    );
    expect(renderFindingMessage(stored, 'uk')).toBe(
      'Внутрішні медіафайли, не підтверджені обходом (2): img[src="/img/a.png"], img[src="/img/b.png"]',
    );
  });

  it('keep the current breakdown on a code of its own', () => {
    // `mixed` names four kinds, `mixed-v2` the three that remain: rendering
    // answers null for a missing value, so the two cannot share a code.
    expect(placeholdersOf(CATALOG['content-004.evidence.mixed']?.en ?? '')).toContain(
      'unconfirmed',
    );
    expect(placeholdersOf(CATALOG['content-004.evidence.mixed-v2']?.en ?? '')).not.toContain(
      'unconfirmed',
    );
  });
});
