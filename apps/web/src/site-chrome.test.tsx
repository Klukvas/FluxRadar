import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SUPPORT_EMAIL } from './brand';
import { SiteFooter, SiteHeader } from './site-chrome';
import { renderStaticChrome, staticChromeState } from './static-chrome-render';
import { readStaticSession } from './static-chrome-session';

function pages(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? pages(join(directory, entry.name))
      : entry.name === 'index.html'
        ? [join(directory, entry.name)]
        : [],
  );
}
afterEach(cleanup);

describe('shared site chrome', () => {
  it('marks the knowledge base active and preserves the selected language in real public and workspace links', () => {
    render(
      <SiteHeader
        variant="public"
        active="knowledge-base"
        signedIn
        language="uk"
        onLanguageChange={() => undefined}
      />,
    );
    expect(screen.getByRole('link', { name: 'База знань' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'FAQ' })).toHaveAttribute('href', '/faq?lang=uk');
    expect(screen.getByRole('link', { name: 'Профілі' })).toHaveAttribute(
      'href',
      '/profiles?lang=uk',
    );
    expect(screen.getByRole('link', { name: 'Головна' })).toHaveAttribute('href', '/?lang=uk');
  });
  it('closes language selection, outside click and Escape with focus restored', () => {
    const change = vi.fn();
    render(<SiteHeader variant="public" active="blog" language="en" onLanguageChange={change} />);
    const language = screen.getByRole('combobox');
    fireEvent.click(language);
    fireEvent.click(screen.getByRole('option', { name: 'Українська' }));
    expect(change).toHaveBeenCalledWith('uk');
    expect(language).toHaveFocus();
    fireEvent.click(language);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(language);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(language).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(document.getElementById('menubar-links')).toHaveClass('is-open');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus();
  });
  it.each(['en', 'uk'] as const)(
    'preserves home and support affordances in the %s footer',
    (language) => {
      render(<SiteFooter language={language} />);
      expect(
        screen.getByRole('link', {
          name:
            language === 'uk'
              ? 'Головна — FLUXRADAR / ВІД FLUXLAB'
              : 'Home — FLUXRADAR / BY FLUXLAB',
        }),
      ).toHaveAttribute('href', `/?lang=${language}`);
      expect(screen.getByRole('link', { name: SUPPORT_EMAIL })).toHaveAttribute(
        'href',
        `mailto:${SUPPORT_EMAIL}`,
      );
    },
  );
  it('uses the same complete footer and keeps the refund anchor after the language query', () => {
    render(<SiteFooter language="uk" />);
    expect(screen.getByRole('link', { name: 'Політика повернень' })).toHaveAttribute(
      'href',
      '/terms?lang=uk#terms-paid',
    );
    expect(screen.getByRole('link', { name: 'Наш краулер' })).toHaveAttribute(
      'href',
      '/bot?lang=uk',
    );
    expect(document.querySelectorAll('footer')).toHaveLength(1);
  });
});

describe('static chrome rendering', () => {
  it('renders every public page with one shared header/footer while preserving its opaque content and SEO', () => {
    const files = ['blog', 'knowledge-base'].flatMap((section) =>
      pages(resolve('public', section)),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const html = renderStaticChrome(source, '/assets/static-chrome-test.js');
      expect(html.match(/<nav class="menubar"/g)).toHaveLength(1);
      expect(html.match(/<footer\b/g)).toHaveLength(1);
      expect(html).toContain('id="site-header-root"');
      const page = new DOMParser().parseFromString(
        html.match(/<footer\b[\s\S]*?<\/footer>/)?.[0] ?? '',
        'text/html',
      );
      const footer = page.querySelector('footer');
      expect(footer?.querySelector('a[href^="/?lang="]')).not.toBeNull();
      expect(footer?.querySelector(`a[href="mailto:${SUPPORT_EMAIL}"]`)?.textContent).toBe(
        SUPPORT_EMAIL,
      );
      expect(html).toContain('href="/site-chrome.css"');
      const restored = html
        .replace(/<div id="site-header-root"[\s\S]*?<\/nav><\/div>/, '<!-- site-header -->')
        .replace(/<div id="site-footer-root"[\s\S]*?<\/footer><\/div>/, '<!-- site-footer -->')
        .replace('<link rel="stylesheet" href="/site-chrome.css" />', '')
        .replace('<script type="module" src="/assets/static-chrome-test.js"></script>', '');
      expect(restored).toBe(source);
      if (file.includes('knowledge-base'))
        expect(staticChromeState(source)).toMatchObject({
          active: 'knowledge-base',
          language: 'uk',
        });
    }
  });
  it('fails closed when a slot is missing or repeated', () => {
    expect(() => renderStaticChrome('<html></html>', '/entry.js')).toThrow('site-header');
  });
});

describe('static session adapter', () => {
  it.each([
    [401, { success: false }, 'anonymous'],
    [503, null, 'unavailable'],
    [200, { success: true, data: { accountId: 'a', email: 'person@example.com' } }, 'signed-in'],
    [200, { success: true, data: {} }, 'unavailable'],
    [200, { success: false, data: { accountId: 'a', email: 'a' } }, 'unavailable'],
  ] as const)(
    'validates a %s response without enabling navigation on errors',
    async (status, data, result) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(data), { status }));
      expect(await readStaticSession(fetcher)).toBe(result);
      expect(fetcher).toHaveBeenCalledWith(
        expect.stringMatching(/\/auth\/me$/),
        expect.objectContaining({ credentials: 'same-origin' }),
      );
    },
  );
  it('stays unavailable when the network or JSON fails', async () => {
    expect(
      await readStaticSession(vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))),
    ).toBe('unavailable');
    expect(
      await readStaticSession(vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>'))),
    ).toBe('unavailable');
  });
});
