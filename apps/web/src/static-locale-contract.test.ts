import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), 'public');
const pages = ['blog', 'knowledge-base']
  .flatMap((section) =>
    readdirSync(resolve(root, section), { recursive: true })
      .map(String)
      .filter((path) => path.endsWith('index.html'))
      .map((path) => `${section}/${path}`),
  )
  .filter((path) => readFileSync(resolve(root, path), 'utf8').includes('<html lang="uk">'));
const tooltipKeys = ['nav.profilesHint', 'nav.scanHint', 'nav.reportsHint', 'nav.integrationsHint'];

function pageDocument(path: string): Document {
  const source = readFileSync(resolve(root, path), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(source)?.[1] ?? '';
  return new DOMParser().parseFromString(
    body.replace(/<script[\s\S]*?<\/script>/g, ''),
    'text/html',
  );
}
describe('initial Ukrainian static chrome contract', () => {
  it.each(pages)('%s retains stable tooltip translation keys', (path) => {
    const doc = pageDocument(path);
    const nodes = Array.from(doc.querySelectorAll('[data-t-title]'));
    expect(nodes.map((node) => node.getAttribute('data-t-title'))).toEqual(tooltipKeys);
    for (const node of nodes) expect(node.getAttribute('title')).toMatch(/[А-Яа-яІіЇїЄє]/);
  });
  it.each(pages)('%s selects its declared initial language consistently', (path) => {
    const doc = pageDocument(path);
    expect(doc.querySelector('[data-language-current]')?.textContent).toBe('Українська');
    expect(doc.querySelector('[data-language-option="uk"]')?.getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(doc.querySelector('[data-language-option="en"]')?.getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  // The product's interface speaks Russian; these hand-written documents do
  // not. Offering a Russian option here would promise an article set that
  // does not exist, so the switcher stays at the two languages the documents
  // are actually written in — see `blog-public-locale.test.ts` for how a
  // Russian reader is still sent back to the Russian public pages.
  it.each(pages)('%s offers no language the document is not written in', (path) => {
    const doc = pageDocument(path);
    const offered = Array.from(doc.querySelectorAll('[data-language-option]'), (node) =>
      node.getAttribute('data-language-option'),
    );
    expect(offered).toEqual(['en', 'uk']);
    expect(doc.querySelector('[data-language-option="ru"]')).toBeNull();
  });
});
