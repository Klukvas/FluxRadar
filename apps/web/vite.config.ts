import react from '@vitejs/plugin-react';
import type { Connect } from 'vite';
import { defineConfig } from 'vite';

/**
 * Rewrite clean /blog paths to their static index.html equivalents so that
 * both `vite dev` and `vite preview` serve the standalone blog HTML pages
 * rather than falling through to the React SPA shell.
 *
 * Paths handled
 * ─────────────
 *  /blog            → /blog/index.html          (blog index)
 *  /blog/           → /blog/index.html          (blog index, trailing slash)
 *  /blog/<slug>     → /blog/<slug>/index.html   (any article or locale sub-path)
 *  /blog/<slug>/    → /blog/<slug>/index.html   (same, trailing slash)
 *
 * The rewrite only changes the request URL seen by later middleware; it never
 * alters the URL the browser sees (no client-side redirect is issued).
 *
 * Production deployment (nginx)
 * ─────────────────────────────
 * The production nginx config uses `try_files $uri $uri/index.html /index.html`
 * which achieves the same result without a redirect: nginx tests the explicit
 * file <path>/index.html before falling back to the SPA entry point.
 * See deploy/nginx.conf.
 *
 * Why `$uri/index.html` instead of `$uri $uri/`
 * ───────────────────────────────────────────────
 * The classic `$uri/` form triggers a 301 redirect (/blog → /blog/) and then
 * relies on nginx's index module to append index.html.  With merge_slashes on
 * (the nginx default) the subsequent `$uri/` test for the redirected /blog/
 * request becomes /blog// → normalised back to /blog/ (not a regular file) →
 * falls through to /index.html (the SPA).  The explicit `$uri/index.html` step
 * avoids the redirect cycle and directly verifies the physical file.
 */
function blogIndexRewritePlugin() {
  /**
   * Map a request URL to its static /index.html equivalent for any path
   * that lives inside the /blog subtree.  Returns null for all other paths.
   */
  function blogIndexUrl(url: string): string | null {
    // Strip query string for matching, preserve it for rewriting.
    const qmark = url.indexOf('?');
    const path = qmark === -1 ? url : url.slice(0, qmark);
    const qs = qmark === -1 ? '' : url.slice(qmark);

    // Exact match: /blog or /blog/
    if (path === '/blog' || path === '/blog/') {
      return `/blog/index.html${qs}`;
    }

    // Sub-paths: /blog/<something> or /blog/<something>/
    // Covers article slugs and locale sub-directories (e.g. /blog/uk/article).
    if (path.startsWith('/blog/') && path.length > '/blog/'.length) {
      // Remove any trailing slash before appending /index.html.
      const clean = path.endsWith('/') ? path.slice(0, -1) : path;
      return `${clean}/index.html${qs}`;
    }

    return null;
  }

  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    if (req.url) {
      const rewritten = blogIndexUrl(req.url);
      if (rewritten !== null) {
        req.url = rewritten;
      }
    }
    next();
  };

  return {
    name: 'blog-index-rewrite',
    configureServer(server: { middlewares: { use: (fn: Connect.NextHandleFunction) => void } }) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server: {
      middlewares: { use: (fn: Connect.NextHandleFunction) => void };
    }) {
      server.middlewares.use(rewrite);
    },
  };
}

export default defineConfig({
  plugins: [react(), blogIndexRewritePlugin()],
});
