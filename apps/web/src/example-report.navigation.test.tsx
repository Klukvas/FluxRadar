// The public example report (/example-report) — finding your way around it.
//
// It exists for a stranger: somebody weighing up the product who cannot see a
// report because they have not bought one. The suite was one 1,125-line file
// and is five now, one per question it answers; the helpers they share live in
// `example-report-test-support.tsx`.

import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, within } from '@testing-library/react';

import { EXAMPLE_REPORT_PATH } from './app-routes';
import { exampleReportCopy } from './example-report-copy';
import { EXAMPLE_RULE_IDS, EXAMPLE_SUMMARY } from './example-report-fixture';
import {
  BASE_CSS,
  EXAMPLE_CSS,
  cleanupExamplePage,
  openExample,
} from './example-report-test-support';
import { problemTitle } from './finding-explainers';
import { findingsCopy } from './findings-copy';

afterEach(cleanupExamplePage);

describe('finding your way around it', () => {
  /** The accessible name of a region, from whichever attribute carries it. */
  function accessibleName(node: Element): string {
    const label = node.getAttribute('aria-label');
    if (label !== null) return label;
    const id = node.getAttribute('aria-labelledby');
    return id === null ? '' : (document.getElementById(id)?.textContent ?? '');
  }

  /** Every landmark region on the page, by the name a screen reader announces. */
  function regionNames(): readonly string[] {
    const regions = document.querySelectorAll(
      'section[aria-label], section[aria-labelledby], [role="region"]',
    );
    return Array.from(regions, accessibleName).filter((name) => name !== '');
  }

  // "Fix these first" is the report's own block and carries its own region and
  // heading. The page wrapped it in a second region pointed at the same
  // heading, so a screen reader announced two nested regions with one name.
  it('announces each region once', async () => {
    await openExample();
    const names = regionNames();

    expect(names).toContain(findingsCopy.en.fixFirst.heading);
    const twice = names.filter((name, index) => names.indexOf(name) !== index);
    expect(twice).toEqual([]);
    // The anchor the index jumps to is still there, and is not a region.
    const anchor = document.getElementById('example-fix-first');
    expect(anchor?.tagName).toBe('DIV');
    expect(anchor?.hasAttribute('aria-labelledby')).toBe(false);
  });

  it.each(['en', 'uk'] as const)('gives every id to one element only (%s)', async (language) => {
    await openExample(language);
    const ids = Array.from(document.querySelectorAll('[id]'), (node) => node.id);
    const twice = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    expect(twice).toEqual([]);
  });

  // Two index blocks listed the same three steps — the strip at the top and a
  // sticky "On this page" panel beside the report. On a phone they stacked into
  // eight links of 15 to 17 pixels. One block now, and every jump in it a tap
  // target.
  it('has one block of jumps, listing each place once', async () => {
    await openExample();
    const steps = document.querySelector('.example-how__steps');
    const more = document.querySelector('.example-how__more');
    if (steps === null || more === null) throw new Error('expected the one index block');

    const targets = [
      ...Array.from(steps.querySelectorAll('a'), (link) => link.getAttribute('href')),
      ...Array.from(more.querySelectorAll('a'), (link) => link.getAttribute('href')),
    ];
    expect(targets).toEqual([
      '#example-score',
      '#example-fix-first',
      '#example-findings',
      '#example-glossary',
      '#example-next',
    ]);
    // Every one of them leads somewhere on this page.
    for (const target of targets) {
      expect(document.getElementById((target ?? '').slice(1))).not.toBeNull();
    }
    // And no second index. In-page links live in exactly two places now: this
    // block, and "Fix these first", whose rows link to the problem each one
    // names. A third block repeating these five anchors is what the removed
    // sticky panel was.
    const fixFirst = document.querySelector('#example-fix-first');
    const elsewhere = Array.from(document.querySelectorAll('a[href^="#"]')).filter(
      (link) => !steps.contains(link) && !more.contains(link) && fixFirst?.contains(link) !== true,
    );
    expect(elsewhere.map((link) => link.getAttribute('href'))).toEqual([]);
    expect(document.querySelector('.legal-index')).toBeNull();
  });

  /**
   * The phone rule that mentions one selector, from the selector to the end of
   * the rule. A shared rule is read from its first selector, which carries the
   * whole list with it.
   */
  function phoneRule(selector: string): string {
    const phones = EXAMPLE_CSS.slice(EXAMPLE_CSS.indexOf('@media (max-width: 699px)'));
    // Guards the reader itself: a renamed query would otherwise leave every
    // assertion below searching the whole file and passing by accident.
    expect(phones.startsWith('@media (max-width: 699px)')).toBe(true);
    const at = phones.indexOf(selector);
    if (at === -1) throw new Error(`no phone rule mentions ${selector}`);
    return phones.slice(at, phones.indexOf('}', phones.indexOf('{', at)));
  }

  it.each([
    '.example-how__steps a',
    '.example-how__more a',
    '.example-report-shell .legal-back',
    '.example-cta__links a:not(.button)',
    // "See what each report includes", in the document's own header: 14px tall
    // on a 375px screen, the smallest target on the page.
    '.example-report-shell .legal-document__notice a',
  ])('makes %s a 40px tap target on a phone', (selector) => {
    const rule = phoneRule(selector);
    expect(rule).toMatch(/min-height: 40px;/);
    // From padding, not from a bigger font: the words stay readable size.
    expect(rule).toMatch(/display: inline-flex;/);
    expect(rule).not.toMatch(/font-size/);
  });

  it.each(['en', 'uk'] as const)(
    'has the link that rule is written for, inside the notice (%s)',
    async (language) => {
      await openExample(language);
      const notice = document.querySelector(
        '.example-report-shell .legal-document__notice',
      ) as HTMLElement;
      const link = within(notice).getByRole('link', {
        name: exampleReportCopy[language].planLink,
      });
      expect(notice.contains(link)).toBe(true);
    },
  );

  /** The whole of the first rule whose selector list mentions this one. */
  function ruleFor(css: string, selector: string): string {
    const at = css.indexOf(selector);
    if (at === -1) throw new Error(`no rule mentions ${selector}`);
    return css.slice(at, css.indexOf('}', css.indexOf('{', at)));
  }

  // Both summaries were a line of text and nothing else — 19px for "Technical
  // details". Unconditionally 40px, not only on a phone: a target too small to
  // hit on a phone was always too small, and the height comes from the box.
  it.each(['.example-technical summary', '.example-finding > summary'])(
    'makes %s a 40px control on every screen',
    (selector) => {
      const rule = ruleFor(EXAMPLE_CSS, selector);
      expect(rule).toMatch(/min-height: 40px;/);
      expect(rule).toMatch(/display: flex;/);
      expect(rule).not.toMatch(/font-size/);
    },
  );

  // 52px from the shared shell took four lines and the top third of a 375px
  // screen before the reader reached the word "example".
  it('scales its own title down on a phone', () => {
    const rule = phoneRule('.example-report-shell .legal-header h1');
    expect(rule).toMatch(/font-size: clamp\(30px, 8\.5vw, 44px\);/);
    // Two classes and a type, so it wins on specificity rather than on which
    // stylesheet the bundler happens to put last.
    expect(BASE_CSS).toMatch(/\.legal-header h1 \{\s*margin-top: 18px;\s*font-size: 52px;/);
  });

  // "How to read this page" is #111 and "ON THIS PAGE" is #555; on the page's
  // slate ground (--desktop, #66799b) those are 4.29:1 and 1.70:1, and no text
  // colour reaches 4.5:1 there — pure white is 4.40:1. So the block moved onto
  // the platinum card the rest of the page is drawn on.
  it('puts its headings on a surface they have contrast against', async () => {
    await openExample();
    const rule = ruleFor(EXAMPLE_CSS, '.example-how {');
    expect(rule).toMatch(/background: var\(--plat-50\);/);
    expect(rule).toMatch(/color: var\(--plat-900\);/);
    // The heading and the label really are inside it, so the surface reaches them.
    const how = document.querySelector('.example-how');
    expect(how?.querySelector('h2')).not.toBeNull();
    expect(how?.querySelector('.example-how__more-label')).not.toBeNull();
  });
});

// The document was 210px wide beside an empty 210px rail on every screen above
// 900px — at 1024, 1100, 1280 and 1440, in both languages — and 19,101px tall.
// `.example-layout { grid-template-columns: minmax(0, 1fr) }` was there and
// lost: it and `.legal-layout` are both one-class selectors, so the stylesheet
// loaded last won, and base.css is imported last (App.tsx). A grep for "the
// override exists" passed throughout.

// A row of "Fix these first" reads "Show below ↓" and was announced "Show
// findings: <title>", so the words on it were in neither the accessible name
// nor anything a voice user could say — WCAG 2.5.3, label in name. And five
// rows with one visible label need the name to tell them apart.
describe('the rows that lead down the page', () => {
  /** Every jump row of "Fix these first", in the order the block draws them. */
  function jumpRows(): readonly HTMLElement[] {
    const block = document.querySelector('#example-fix-first') as HTMLElement;
    return Array.from(block.querySelectorAll('a.fix-first__jump'));
  }

  it.each(['en', 'uk'] as const)(
    'names each row by the words on it and by where it goes (%s)',
    async (language) => {
      await openExample(language);
      const visible = exampleReportCopy[language].showBelow;
      const rows = jumpRows();
      expect(rows.length).toBeGreaterThan(1);

      const names = rows.map((row) => row.getAttribute('aria-label') ?? '');
      rows.forEach((row, index) => {
        const group = EXAMPLE_SUMMARY.groups[index];
        if (group === undefined) throw new Error('expected a problem for every row');
        // The visible text is the whole visible text, and the name contains it.
        expect(row.textContent).toBe(visible);
        expect(names[index]).toContain(visible);
        // Plus the problem it leads to, which is what makes the five differ.
        expect(names[index]).toContain(problemTitle(group.ruleId, language));
      });
      expect(new Set(names).size).toBe(names.length);
    },
  );
});

// A "Show below ↓" link lands on the `<li>` of a closed card, so the reader
// pressed a link promising to show them a problem and arrived at a folded
// headline with one more press to work out.
describe('the card a jump lands on', () => {
  /** The `<details>` of one problem's own entry. */
  function cardFor(ruleId: string): HTMLDetailsElement | null {
    const entry = document.getElementById(`example-finding-${ruleId.toLowerCase()}`);
    return entry?.querySelector('details') ?? null;
  }

  /** Which problems are unfolded, by rule id. */
  function unfolded(): readonly string[] {
    return EXAMPLE_RULE_IDS.filter((ruleId) => cardFor(ruleId)?.hasAttribute('open') === true);
  }

  it('opens when its own row is pressed', async () => {
    await openExample();
    const target = EXAMPLE_SUMMARY.groups[2];
    const row = document.querySelectorAll('#example-fix-first a.fix-first__jump')[2];
    if (target === undefined || row === undefined) throw new Error('expected a third row');

    fireEvent.click(row);

    expect(cardFor(target.ruleId)?.hasAttribute('open')).toBe(true);
    expect(unfolded()).toEqual([target.ruleId]);
  });

  // The second press asks for the card already asked for, at the address
  // already in the bar: no new state and no `hashchange`, so the card the
  // reader folded in between stayed folded under a link promising to show it.
  it('opens again when its row is pressed again after being folded by hand', async () => {
    await openExample();
    const target = EXAMPLE_SUMMARY.groups[2];
    const row = document.querySelectorAll('#example-fix-first a.fix-first__jump')[2];
    if (target === undefined || row === undefined) throw new Error('expected a third row');

    fireEvent.click(row);
    expect(cardFor(target.ruleId)?.hasAttribute('open')).toBe(true);

    cardFor(target.ruleId)?.removeAttribute('open');
    expect(cardFor(target.ruleId)?.hasAttribute('open')).toBe(false);

    fireEvent.click(row);
    expect(cardFor(target.ruleId)?.hasAttribute('open')).toBe(true);
    expect(unfolded()).toEqual([target.ruleId]);

    // A jump that names no problem is not an ask: folded again by hand, the
    // card stays folded when the reader moves to the glossary.
    cardFor(target.ruleId)?.removeAttribute('open');
    act(() => {
      window.history.replaceState(null, '', `${EXAMPLE_REPORT_PATH}#example-glossary`);
      window.dispatchEvent(new Event('hashchange'));
    });
    expect(unfolded()).toEqual([]);
  });

  it('opens when the page is opened at its own address', async () => {
    const target = EXAMPLE_RULE_IDS[4];
    if (target === undefined) throw new Error('expected a fifth problem');
    await openExample('en', `#example-finding-${target.toLowerCase()}`);

    expect(unfolded()).toEqual([target]);
  });

  it('follows a later change of address, which is the back button too', async () => {
    await openExample();
    const target = EXAMPLE_RULE_IDS[5];
    if (target === undefined) throw new Error('expected a sixth problem');

    act(() => {
      window.history.replaceState(
        null,
        '',
        `${EXAMPLE_REPORT_PATH}#example-finding-${target.toLowerCase()}`,
      );
      window.dispatchEvent(new Event('hashchange'));
    });

    expect(unfolded()).toEqual([target]);
  });

  it('is still the first card when nobody has asked for one', async () => {
    await openExample();
    expect(unfolded()).toEqual([EXAMPLE_RULE_IDS[0]]);
  });

  it.each(['#example-glossary', '#example-next', '#example-findings'])(
    'leaves every card as it was when the address names %s instead',
    async (anchor) => {
      await openExample('en', anchor);
      // The jumps that are not a problem move the reader and nothing else; the
      // first card stays the one that is open.
      expect(unfolded()).toEqual([EXAMPLE_RULE_IDS[0]]);

      act(() => {
        window.history.replaceState(null, '', `${EXAMPLE_REPORT_PATH}${anchor}`);
        window.dispatchEvent(new Event('hashchange'));
      });
      expect(unfolded()).toEqual([EXAMPLE_RULE_IDS[0]]);
    },
  );

  // The fold is a `<details>`, which is why the keyboard still works: the row
  // is a `<summary>`, and nothing here replaces it with a click handler.
  it('leaves the fold a native disclosure, operable from the keyboard', async () => {
    await openExample();
    const card = cardFor(EXAMPLE_RULE_IDS[1] ?? '');
    const summary = card?.querySelector('summary');
    expect(summary?.tagName).toBe('SUMMARY');

    // Opened by hand, it stays open: React only writes `open` when the value
    // it passes changes, and this card's value has not.
    summary?.dispatchEvent(new Event('click', { bubbles: true }));
    card?.setAttribute('open', '');
    act(() => {
      window.dispatchEvent(new Event('hashchange'));
    });
    expect(card?.hasAttribute('open')).toBe(true);
  });
});
