import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), 'public');
const index = readFileSync(resolve(root, 'knowledge-base/index.html'), 'utf8');
const filter = readFileSync(resolve(root, 'blog/content.js'), 'utf8');

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-blog-lang');
});

describe('knowledge-base catalog', () => {
  it('keeps every guide discoverable without running JavaScript', () => {
    document.body.innerHTML = index.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? '';
    const links = [...document.querySelectorAll('[data-content-card] h3 a')];
    const schema = JSON.parse(
      index.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? '{}',
    ) as { mainEntity: { itemListElement: readonly { url: string }[] } };
    expect(links).toHaveLength(21);
    expect(schema.mainEntity.itemListElement.map((entry) => new URL(entry.url).pathname)).toEqual(
      links.map((link) => link.getAttribute('href')),
    );
    expect(document.querySelector('[data-content-controls]')?.hasAttribute('hidden')).toBe(true);
    expect(links.every((link) => link.closest('[hidden]') === null)).toBe(true);
  });

  it('finds a new signal, filters topics, explains empty results and resets the catalog', () => {
    document.body.innerHTML = index.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? '';
    document.documentElement.lang = 'uk';
    document.documentElement.setAttribute('data-blog-lang', 'uk');
    new Function(filter)();
    const search = document.querySelector<HTMLInputElement>('#content-search');
    const category = document.querySelector<HTMLSelectElement>('#content-category');
    const visibleCards = () => [...document.querySelectorAll('[data-content-card]:not([hidden])')];
    if (search === null || category === null) throw new Error('catalog controls missing');
    expect(visibleCards()).toHaveLength(21);
    search.value = 'TLS';
    search.dispatchEvent(new Event('input'));
    expect(visibleCards()).toHaveLength(1);
    expect(visibleCards()[0]?.querySelector('a')?.getAttribute('href')).toBe(
      '/knowledge-base/novi-perevirky-saitu',
    );
    search.value = '';
    category.value = 'SEO та індексація';
    category.dispatchEvent(new Event('change'));
    expect(visibleCards().length).toBeGreaterThan(0);
    expect(visibleCards().length).toBeLessThan(21);
    search.value = 'no-such-guide-123';
    search.dispatchEvent(new Event('input'));
    expect(visibleCards()).toHaveLength(0);
    expect(document.querySelector('[data-content-results]')?.textContent).toContain(
      'Нічого не знайдено',
    );
    document.querySelector<HTMLButtonElement>('[data-content-reset]')?.click();
    expect(visibleCards()).toHaveLength(21);
    expect(search.value).toBe('');
    expect(category.value).toBe('');
    expect(document.activeElement).toBe(search);
  });
});
