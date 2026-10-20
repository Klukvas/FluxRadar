import { describe, expect, it } from 'vitest';

import { blogIndexUrl } from './blog-routing';

describe('blogIndexUrl', () => {
  it('serves the blog index for the clean path, with or without a trailing slash', () => {
    expect(blogIndexUrl('/blog')).toBe('/blog/index.html');
    expect(blogIndexUrl('/blog/')).toBe('/blog/index.html');
  });

  it('keeps the query string, which carries the language filter', () => {
    expect(blogIndexUrl('/blog?lang=uk')).toBe('/blog/index.html?lang=uk');
  });

  it('resolves article and locale sub-paths to their own index.html', () => {
    expect(blogIndexUrl('/blog/ai-crawler-readiness')).toBe(
      '/blog/ai-crawler-readiness/index.html',
    );
    expect(blogIndexUrl('/blog/uk/tekhnichne-seo-audyt/')).toBe(
      '/blog/uk/tekhnichne-seo-audyt/index.html',
    );
  });

  // Regression: the shared header stylesheet and script live inside /blog, and
  // rewriting them to <file>/index.html 404s the whole blog chrome in dev.
  it('leaves real files inside the blog subtree alone', () => {
    expect(blogIndexUrl('/blog/blog.css')).toBeNull();
    expect(blogIndexUrl('/blog/blog.js')).toBeNull();
    expect(blogIndexUrl('/blog/blog.js?v=2')).toBeNull();
  });

  it('serves knowledge-base documents before the SPA fallback', () => {
    expect(blogIndexUrl('/knowledge-base')).toBe('/knowledge-base/index.html');
    expect(blogIndexUrl('/knowledge-base/?lang=uk')).toBe('/knowledge-base/index.html?lang=uk');
    expect(blogIndexUrl('/knowledge-base/novi-perevirky-saitu/')).toBe(
      '/knowledge-base/novi-perevirky-saitu/index.html',
    );
    expect(blogIndexUrl('/knowledge-base/example.pdf')).toBeNull();
    expect(blogIndexUrl('/knowledge-based')).toBeNull();
  });

  it('claims nothing outside the content sections', () => {
    expect(blogIndexUrl('/')).toBeNull();
    expect(blogIndexUrl('/faq')).toBeNull();
    expect(blogIndexUrl('/blogging')).toBeNull();
  });
});
