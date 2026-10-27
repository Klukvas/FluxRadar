import { renderStaticChrome } from './static-chrome-render';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const publicRoot = resolve(process.cwd(), 'public');
function pagesIn(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(directory, entry.name);
    return entry.isDirectory() ? pagesIn(file) : entry.name === 'index.html' ? [file] : [];
  });
}
const allPages = [
  ...pagesIn(resolve(publicRoot, 'blog')),
  ...pagesIn(resolve(publicRoot, 'knowledge-base')),
];
const newArticles = allPages.filter((file) => {
  const html = readFileSync(file, 'utf8');
  return html.includes('class="content-article"') && html.includes('data-content-section=');
});
const sitemap = readFileSync(resolve(publicRoot, 'sitemap.xml'), 'utf8');
function parse(html: string): Document {
  return new DOMParser().parseFromString(
    html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*rel="stylesheet"[^>]*>/g, ''),
    'text/html',
  );
}
function pageUrl(file: string): string {
  return `/${relative(publicRoot, file)
    .replace(/\/index\.html$/, '')
    .replaceAll('\\', '/')}`;
}

describe('Ukrainian content collection', () => {
  it('adds exactly twenty guides and twenty blog articles', () => {
    expect(newArticles.filter((file) => file.includes('/knowledge-base/'))).toHaveLength(20);
    expect(newArticles.filter((file) => file.includes('/blog/'))).toHaveLength(20);
  });

  it.each(newArticles)('%s describes its actual visible article and canonical', (file) => {
    const html = readFileSync(file, 'utf8');
    const document = parse(html);
    const canonical = `https://fluxradar.net${pageUrl(file)}`;
    expect(document.documentElement.lang).toBe('uk');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(canonical);
    expect(
      document.querySelector('meta[name="description"]')?.getAttribute('content')?.length,
    ).toBeGreaterThan(50);
    expect(
      document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '',
    ).not.toContain('noindex');
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    const blocks = [
      ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ].map((match) => JSON.parse(match[1] ?? '{}') as Record<string, unknown>);
    const entities = blocks.flatMap((block) =>
      Array.isArray(block['@graph']) ? block['@graph'] : [block],
    ) as Record<string, unknown>[];
    const article = entities.find((entity) =>
      ['TechArticle', 'BlogPosting'].includes(String(entity['@type'])),
    );
    expect(article?.headline).toBe(document.querySelector('h1')?.textContent);
    expect(article?.inLanguage).toBe('uk');
    expect(article?.datePublished).toBe('2026-10-14');
    expect(document.querySelector('time[datetime="2026-10-14"]')).not.toBeNull();
    expect(JSON.stringify(article)).toContain(canonical);
    expect(entities.some((entity) => entity['@type'] === 'BreadcrumbList')).toBe(true);
    expect(sitemap).toContain(`<loc>${canonical}</loc>`);
  });

  it.each(newArticles)(
    '%s provides substantive instructions, sources and contextual links',
    (file) => {
      const document = parse(renderStaticChrome(readFileSync(file, 'utf8'), '/entry.js'));
      const article = document.querySelector('.content-article');
      const prose = article?.cloneNode(true) as Element | undefined;
      prose
        ?.querySelectorAll('.article-toc, .article-sources, .related-reading')
        .forEach((section) => section.remove());
      expect(prose?.textContent?.trim().split(/\s+/).length).toBeGreaterThanOrEqual(300);
      expect(article?.querySelectorAll('section h2').length).toBeGreaterThanOrEqual(4);
      expect(article?.querySelector('ol, ul')).not.toBeNull();
      expect(
        article?.querySelectorAll('.article-sources a[href^="https://"]').length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        article?.querySelectorAll('.related-reading a[href^="/"]').length,
      ).toBeGreaterThanOrEqual(2);
      expect(document.querySelector('.menubar__item')?.textContent).toBe('Головна');
      expect(document.querySelector('.powered-by__link')?.textContent).toContain(
        'Створено FluxLab',
      );
    },
  );

  it('keeps article titles and descriptions unique', () => {
    const documents = newArticles.map((file) => parse(readFileSync(file, 'utf8')));
    const titles = documents.map((document) => document.querySelector('h1')?.textContent);
    const descriptions = documents.map((document) =>
      document.querySelector('meta[name="description"]')?.getAttribute('content'),
    );
    expect(new Set(titles).size).toBe(40);
    expect(new Set(descriptions).size).toBe(40);
  });

  it('lists all new articles as ordinary links without JavaScript', () => {
    for (const kind of ['blog', 'knowledge-base']) {
      const index = parse(readFileSync(resolve(publicRoot, kind, 'index.html'), 'utf8'));
      expect(index.querySelector('[data-content-controls]')?.hasAttribute('hidden')).toBe(true);
      for (const file of newArticles.filter((article) => article.includes(`/${kind}/`))) {
        expect(index.querySelector(`a[href="${pageUrl(file)}"]`)).not.toBeNull();
      }
    }
  });

  it('keeps local content links and table-of-contents anchors valid', () => {
    const paths = new Set(allPages.map(pageUrl));
    for (const file of newArticles) {
      const document = parse(readFileSync(file, 'utf8'));
      for (const link of document.querySelectorAll('a[href]')) {
        const href = link.getAttribute('href') ?? '';
        if (href.startsWith('#')) expect(document.getElementById(href.slice(1))).not.toBeNull();
        if (href.startsWith('/blog') || href.startsWith('/knowledge-base')) {
          expect(paths.has(href.split('?')[0] ?? '')).toBe(true);
        }
      }
    }
  });

  it('retains the six legacy articles and keeps the two drafts unlisted', () => {
    expect(
      allPages.filter((file) => file.includes('/blog/') && !newArticles.includes(file)),
    ).toHaveLength(7);
    for (const slug of [
      'bezpeka-ta-dostupnist-publichnyy-skaner',
      'tekhnichnyy-seo-publichnyy-audyt',
    ]) {
      const html = readFileSync(resolve(publicRoot, 'blog', slug, 'index.html'), 'utf8');
      expect(html).toContain('noindex');
      expect(sitemap).not.toContain(`<loc>https://fluxradar.net/blog/${slug}</loc>`);
    }
  });
});

describe('catalog progressive enhancement', () => {
  it('localizes the English archive controls and hides empty legacy groups after filtering', () => {
    const html = readFileSync(resolve(publicRoot, 'blog/index.html'), 'utf8');
    document.body.innerHTML = parse(html).body.innerHTML;
    document.body.setAttribute('data-blog-page', 'index');
    window.history.replaceState(null, '', '/blog?lang=en');
    window.localStorage.clear();
    new Function(readFileSync(resolve(publicRoot, 'blog/blog.js'), 'utf8'))();
    new Function(readFileSync(resolve(publicRoot, 'blog/content.js'), 'utf8'))();
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('label[for="content-search"]')?.textContent).toBe(
      'Find an article',
    );
    expect(document.querySelector('[data-content-reset]')?.textContent).toBe('Reset filters');
    expect(document.querySelector('[data-content-results]')?.textContent).toBe('Articles found: 2');
    const category = document.querySelector<HTMLSelectElement>('#content-category');
    if (category === null) throw new Error('Missing topic selector');
    expect(
      [...category.querySelectorAll<HTMLOptionElement>('[data-content-language]')].every(
        (option) => option.hidden,
      ),
    ).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-language-filter="uk"]')?.click();
    const aiTopic = [...category.options].find((option) => option.value.includes('AI'));
    if (aiTopic === undefined) throw new Error('Missing AI topic');
    category.value = aiTopic.value;
    category.dispatchEvent(new Event('change'));
    expect(document.documentElement.lang).toBe('uk');
    expect(document.querySelector('[data-content-results]')?.textContent).toMatch(
      /^Знайдено матеріалів: [1-9]/,
    );
    expect(document.querySelector<HTMLElement>('[aria-labelledby="uk-heading"]')?.hidden).toBe(
      true,
    );
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.removeAttribute('data-blog-page');
    document.documentElement.removeAttribute('data-blog-lang');
    window.localStorage.clear();
  });

  it('filters Ukrainian guides, reports an empty result and allows reset', () => {
    const html = readFileSync(resolve(publicRoot, 'knowledge-base/index.html'), 'utf8');
    document.body.innerHTML = parse(html).body.innerHTML;
    document.documentElement.lang = 'uk';
    document.documentElement.removeAttribute('data-blog-lang');
    new Function(readFileSync(resolve(publicRoot, 'blog/content.js'), 'utf8'))();
    const search = document.querySelector<HTMLInputElement>('#content-search');
    if (search === null) throw new Error('Missing catalog search');
    search.value = 'canonical';
    search.dispatchEvent(new Event('input'));
    expect(
      [...document.querySelectorAll<HTMLElement>('[data-content-card]')].filter(
        (card) => !card.hidden,
      ).length,
    ).toBeGreaterThan(0);
    search.value = 'zzzz-no-match';
    search.dispatchEvent(new Event('input'));
    expect(document.querySelector('[data-content-results]')?.textContent).toContain(
      'Нічого не знайдено',
    );
    document.querySelector<HTMLButtonElement>('[data-content-reset]')?.click();
    expect(search.value).toBe('');
    expect(
      [...document.querySelectorAll<HTMLElement>('[data-content-card]')].filter(
        (card) => !card.hidden,
      ),
    ).toHaveLength(20);
  });
});
