// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exampleReportContent } from './example-report-content';
import { russianExampleNote } from './example-report-copy.ru';
import { EXAMPLE_RULE_IDS } from './example-report-fixture';
import { problemTitle } from './finding-explainers';
import { PUBLIC_LOCALES, PUBLIC_PAGE_PATHS, publicPagePath } from './public-page-routing';
import { staticPublicFiles } from './static-public-render';

const template = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
describe('public first-response HTML', () => {
  const files = staticPublicFiles(template);
  // Eight public pages in three locales. The count is spelled out so that a
  // page or a locale added to the routing and forgotten in the prerender is a
  // failure here, rather than a URL that silently serves the English shell.
  const documents = PUBLIC_LOCALES.length * Object.keys(PUBLIC_PAGE_PATHS).length;
  it(`renders all ${documents} locale documents without a browser or network`, () => {
    expect(documents).toBe(24);
    expect(files).toHaveLength(documents);
    expect(new Set(files.map((file) => file.fileName)).size).toBe(documents);
    for (const file of files) {
      expect(file.html).toContain('<h1');
      expect(file.html).toContain('data-public-snapshot=');
      expect(file.html).not.toContain('<div id="root"></div>');
      expect(file.html).toContain('<noscript>');
      expect(file.html).not.toContain('application/json');
      // The locale a file belongs to is its directory prefix; English has none.
      const locale =
        PUBLIC_LOCALES.find((language) => file.fileName.startsWith(`${language}/`)) ?? 'en';
      expect(file.html).toContain(`<html lang="${locale}">`);
      expect(file.html).toContain(`href="${publicPagePath('checks', locale)}"`);
    }
  });

  // Every locale must reach the same eight documents: a page that exists in
  // two locales and not the third is a dead link in the third one's footer.
  it('writes the same page set in every locale', () => {
    for (const language of PUBLIC_LOCALES) {
      const prefix = language === 'en' ? '' : `${language}/`;
      const names = files
        .map((file) => file.fileName)
        .filter((name) =>
          language === 'en'
            ? !PUBLIC_LOCALES.some((other) => other !== 'en' && name.startsWith(`${other}/`))
            : name.startsWith(prefix),
        );
      expect(names.length, language).toBe(Object.keys(PUBLIC_PAGE_PATHS).length);
    }
  });
  // The first response is the whole document for a reader with JavaScript off,
  // and for the crawler that indexes /ru/example-report. The example's six
  // problems are translated for the Russian page
  // (`example-report-content.ts`), so the prerender has to carry the Russian
  // words and the note that says they are a translation — not the English
  // shell, and not the Ukrainian findings the page used to show.
  it('prerenders the Russian example translated, with the note that says so', () => {
    const russian = files.find((file) => file.fileName === 'ru/example-report/index.html')?.html;
    if (russian === undefined) throw new Error('expected the Russian example document');

    for (const ruleId of EXAMPLE_RULE_IDS) {
      const finding = exampleReportContent.ru.findings[ruleId];
      if (finding === undefined) throw new Error(`no Russian words for ${ruleId}`);
      expect(russian, ruleId).toContain(finding.title);
      expect(russian, ruleId).not.toContain(problemTitle(ruleId, 'uk'));
    }
    expect(russian).toContain(russianExampleNote);
    expect(russian).toContain('example-translation');

    // And the Ukrainian document is the document it always was.
    const ukrainian = files.find((file) => file.fileName === 'uk/example-report/index.html')?.html;
    if (ukrainian === undefined) throw new Error('expected the Ukrainian example document');
    for (const ruleId of EXAMPLE_RULE_IDS) {
      expect(ukrainian, ruleId).toContain(problemTitle(ruleId, 'uk'));
    }
    expect(ukrainian).not.toContain('example-translation');
  });

  it('describes actual service offers without merchant inventory or invented reviews', () => {
    const home = files.find((file) => file.fileName === 'index.html')?.html ?? '';
    expect(home).toContain('"@type":"Service"');
    expect(home).not.toMatch(/"@type":"Product"|aggregateRating|InStock|shippingDetails/);
    expect(home).toContain('"price":"39"');
    expect(home).toContain('"price":"87"');
  });
});
