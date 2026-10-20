import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const root = resolve(process.cwd(), 'public/blog');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const source = ['public-links.js', 'attribution.js', 'blog.js']
  .map((file) => readFileSync(resolve(root, file), 'utf8'))
  .join('\n');
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(null, { status: 401 }))),
  );
  document.body.innerHTML =
    /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1]?.replace(/<script[\s\S]*?<\/script>/g, '') ?? '';
  document.body.setAttribute('data-blog-page', 'index');
  document.documentElement.lang = 'en';
  window.history.replaceState(null, '', '/blog?lang=uk');
  new Function(source)();
});
afterEach(() => {
  document.body.innerHTML = '';
  document.body.removeAttribute('data-blog-page');
  localStorage.clear();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
function destinations() {
  return [
    '.menubar__apple',
    '.menubar [data-t="nav.home"]',
    '.menubar [data-t="nav.faq"]',
    '.site-footer [data-t="blog.footerHome"]',
  ].map((selector) => document.querySelector(selector)?.getAttribute('href'));
}
describe('blog public destinations follow the selected locale', () => {
  it('keeps the Ukrainian initial filter linked to Ukrainian public documents', () => {
    expect(destinations()).toEqual(['/uk', '/uk', '/uk/faq', '/uk']);
  });
  it('updates only fixed chrome links when the filter changes', () => {
    const articleLinks = Array.from(document.querySelectorAll('article a'), (node) =>
      node.getAttribute('href'),
    );
    document.querySelector<HTMLButtonElement>('[data-language-filter="en"]')?.click();
    expect(destinations()).toEqual(['/', '/', '/faq', '/']);
    document.querySelector<HTMLButtonElement>('[data-language-filter="uk"]')?.click();
    expect(destinations()).toEqual(['/uk', '/uk', '/uk/faq', '/uk']);
    expect(
      Array.from(document.querySelectorAll('article a'), (node) => node.getAttribute('href')),
    ).toEqual(articleLinks);
  });
});
