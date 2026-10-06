// The public example report (/example-report) — the column the document is drawn in.
//
// It exists for a stranger: somebody weighing up the product who cannot see a
// report because they have not bought one. The suite was one 1,125-line file
// and is five now, one per question it answers; the helpers they share live in
// `example-report-test-support.tsx`.

import { afterEach, describe, expect, it } from 'vitest';

import {
  ALL_STYLESHEETS,
  BASE_CSS,
  EXAMPLE_CSS,
  cleanupExamplePage,
  openExample,
} from './example-report-test-support';

afterEach(cleanupExamplePage);

// The document was 210px wide beside an empty 210px rail on every screen above
// 900px — at 1024, 1100, 1280 and 1440, in both languages — and 19,101px tall.
// `.example-layout { grid-template-columns: minmax(0, 1fr) }` was there and
// lost: it and `.legal-layout` are both one-class selectors, so the stylesheet
// loaded last won, and base.css is imported last (App.tsx). A grep for "the
// override exists" passed throughout.
describe('the column the document is drawn in', () => {
  /**
   * Every selector in a stylesheet that decides a grid's columns, with the
   * media query it sits in — the whole file, @media blocks included.
   *
   * Written as a scan rather than a regex over one rule, because the defect was
   * a rule *elsewhere in the cascade*: what matters is not what this page's own
   * stylesheet says but whether anything else can still select this page.
   */
  function columnRules(css: string): readonly { selector: string; media: string }[] {
    // Comments first: one of them sits directly above `.example-layout` and
    // holds no braces, so a selector pattern reading up to the next `{` ate it
    // and reported the whole paragraph as the selector.
    const source = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
    const found: { selector: string; media: string }[] = [];
    const rule = /(?:^|\n)([ \t]*)([^@{}\n][^{};]*)\{([^{}]*)\}/g;
    for (let match = rule.exec(source); match !== null; match = rule.exec(source)) {
      const [, indent = '', selector = '', body = ''] = match;
      if (!/grid-template-columns|grid-template-areas|grid-column\s*:/.test(body)) continue;
      const before = source.slice(0, match.index);
      const opened = (before.match(/@media[^{]*\{/g) ?? []).at(-1) ?? '';
      found.push({
        selector: selector.trim().replace(/\s+/g, ' '),
        media: indent === '' ? '' : opened.trim(),
      });
    }
    return found;
  }

  it('reads the stylesheets it is checked against', () => {
    // Guards the scanner: a selector syntax it cannot parse would leave every
    // assertion below looking at an empty list and passing by accident.
    const base = columnRules(BASE_CSS);
    expect(base.length).toBeGreaterThan(20);
    expect(base.filter((found) => found.selector === '.legal-layout').length).toBeGreaterThan(0);
    expect(columnRules(EXAMPLE_CSS).map((found) => found.selector)).toContain('.example-layout');
    // And that the two files it names really are the ones read from disk, among
    // every stylesheet of the build.
    const byFile = new Map(ALL_STYLESHEETS.map((sheet) => [sheet.file, sheet.css]));
    expect(byFile.get('base.css')).toBe(BASE_CSS);
    expect(byFile.get('example-report.css')).toBe(EXAMPLE_CSS);
    expect(ALL_STYLESHEETS.length).toBeGreaterThan(10);
  });

  /** Every element the document is nested inside, and the document itself. */
  function documentAncestry(): readonly Element[] {
    const chain: Element[] = [];
    for (
      let node: Element | null = document.querySelector('.example-report');
      node !== null;
      node = node.parentElement
    ) {
      chain.push(node);
    }
    if (chain.length < 4) throw new Error('expected the document inside its shell');
    return chain;
  }

  /** Whether a selector can select this element, ignoring one it cannot parse. */
  function selects(node: Element, selector: string): boolean {
    try {
      return node.matches(selector);
    } catch {
      return false;
    }
  }

  // The scan used to read `base.css` alone, and only its `.legal-layout` rules.
  // The defect it was written for was a rule *elsewhere in the cascade*, so the
  // same rule written for `.legal-document`, for `article`, or in a third
  // stylesheet would have walked straight past it.
  it('is drawn in one column track, declared in one place, from any stylesheet', async () => {
    await openExample();
    const chain = documentAncestry();
    const reaching = ALL_STYLESHEETS.flatMap(({ file, css }) =>
      columnRules(css)
        .filter((found) => chain.some((node) => selects(node, found.selector)))
        .map((found) => ({ file, selector: found.selector, media: found.media })),
    );

    // Exactly one: the page's own. Anything else is a second opinion about the
    // column the whole report is drawn in.
    expect(reaching).toEqual([
      { file: 'example-report.css', selector: '.example-layout', media: '' },
    ]);
  });

  it.each(['en', 'uk'] as const)(
    'is this page’s own, not the shared rail (%s)',
    async (language) => {
      await openExample(language);
      // Not "the override is stronger" — the shared class is gone from the page,
      // so there is nothing left for any of its rules to select.
      expect(document.querySelectorAll('.legal-layout')).toHaveLength(0);
      expect(document.querySelectorAll('.example-layout')).toHaveLength(1);
      expect(document.querySelector('.legal-index')).toBeNull();
    },
  );

  it('cannot be reached by any column rule from the shared shell', async () => {
    await openExample();
    const shared = columnRules(BASE_CSS).filter((found) =>
      found.selector.includes('.legal-layout'),
    );
    // Every variant, the top-level rule and the media ones alike.
    expect(shared.length).toBeGreaterThanOrEqual(2);
    for (const found of shared) {
      expect({
        selector: found.selector,
        media: found.media,
        matches: document.querySelectorAll(found.selector).length,
      }).toEqual({ selector: found.selector, media: found.media, matches: 0 });
    }
  });

  it('declares a single track, at a readable measure, and nothing else does', () => {
    const own = columnRules(EXAMPLE_CSS).filter((found) =>
      found.selector.includes('example-layout'),
    );
    expect(own).toHaveLength(1);
    const rule = EXAMPLE_CSS.slice(
      EXAMPLE_CSS.indexOf('.example-layout {'),
      EXAMPLE_CSS.indexOf('}', EXAMPLE_CSS.indexOf('.example-layout {')),
    );
    expect(rule).toMatch(/display: grid;/);
    expect(rule).toMatch(/grid-template-columns: minmax\(0, 1fr\);/);
    // Centred, and capped short of the 1132px a 1440px screen would give it.
    expect(rule).toMatch(/max-width: \d{3}px;/);
    expect(rule).toMatch(/margin: 32px auto 0;/);
  });

  // Measured at 1440px: the header, the EXAMPLE banner and the "how to read"
  // strip are children of `.legal-main`, which the shared shell caps at 1180px
  // — 1132px of content — while the document below them is 828px wide and
  // centred. Three blocks stood 152px proud of the article on each side.
  it('holds every block on the page to the document’s own measure', () => {
    const measure = /\.example-layout \{[^}]*max-width: (\d+)px;/.exec(EXAMPLE_CSS);
    const capped = /\.example-report-shell \.legal-main \{[^}]*max-width: (\d+)px;/.exec(
      EXAMPLE_CSS,
    );
    if (measure?.[1] === undefined || capped?.[1] === undefined) {
      throw new Error('expected a measure for the document and for the page');
    }
    // The document's measure plus the main's padding on each side, which
    // `box-sizing: border-box` makes the figure the cap is written in.
    const padding = /\.legal-main \{[^}]*padding: 56px (\d+)px/.exec(BASE_CSS)?.[1];
    expect(BASE_CSS).toMatch(/box-sizing: border-box;/);
    expect(Number(capped[1])).toBe(Number(measure[1]) + 2 * Number(padding));
    // Scoped to this page: the shared shell keeps the width the pages with an
    // index rail beside their document need.
    expect(BASE_CSS).toMatch(/\.legal-main \{[^}]*max-width: 1180px;/);
    expect(capped[0]).toMatch(/^\.example-report-shell /);
  });

  it('draws its header, its banner and its strip inside that column', async () => {
    await openExample();
    const main = document.querySelector('.example-report-shell .legal-main');
    if (main === null) throw new Error('expected the capped column');
    // The three blocks the step was measured on, and the document itself: one
    // parent, so one pair of edges.
    for (const selector of [
      '.legal-header',
      '.example-banner',
      '.example-how',
      '.example-layout',
    ]) {
      expect({ selector, inside: main.querySelector(selector) !== null }).toEqual({
        selector,
        inside: true,
      });
    }
    // And the way back is still in the header, where it is laid out against the
    // heading rather than against the page.
    expect(document.querySelector('.legal-header .legal-back')).not.toBeNull();
  });

  // happy-dom is given no stylesheet to compute from: `vitest.config.ts` leaves
  // `test.css` at its default, so `import './styles/example-report.css'` is an
  // empty module and `getComputedStyle` returns nothing about the grid. The
  // rendered column count can only be measured in a real browser; what is
  // testable here is the cascade, which is what the three rules above read.
  it('cannot be measured here, and says so', async () => {
    await openExample();
    const layout = document.querySelector('.example-layout') as HTMLElement;
    expect(window.getComputedStyle(layout).gridTemplateColumns).toBe('');
    expect(document.styleSheets).toHaveLength(0);
  });
});
