import react from '@vitejs/plugin-react';
import type { Connect } from 'vite';
import { defineConfig } from 'vite';

// Keep the runtime-style `.js` suffix: TypeScript resolves it to the `.ts`
// source, while Vite's native config loader gets an explicit ESM import.
import { blogIndexUrl } from './src/blog-routing.js';

/**
 * Serve the standalone blog HTML for clean /blog paths in `vite dev` and
 * `vite preview`, instead of falling through to the React SPA shell.
 *
 * Paths handled
 * ─────────────
 *  /blog            → /blog/index.html          (blog index)
 *  /blog/           → /blog/index.html          (blog index, trailing slash)
 *  /blog/<slug>     → /blog/<slug>/index.html   (any article or locale sub-path)
 *  /blog/<slug>/    → /blog/<slug>/index.html   (same, trailing slash)
 *  /blog/blog.css   → untouched                 (a real file, served as-is)
 *
 * The rewrite only changes the request URL seen by later middleware; it never
 * alters the URL the browser sees (no client-side redirect is issued).
 *
 * Production deployment (nginx)
 * ─────────────────────────────
 * The production nginx config uses `try_files $uri $uri/index.html /index.html`
 * which achieves the same result without a redirect: nginx tests the request as
 * a real file first, then the explicit <path>/index.html, then the SPA entry
 * point. See deploy/nginx.conf.
 *
 * Why `$uri/index.html` instead of `$uri $uri/`
 * ───────────────────────────────────────────────
 * The classic `$uri/` form triggers a 301 redirect (/blog → /blog/) and then
 * relies on nginx's index module to append index.html.  With merge_slashes on
 * (the nginx default) the subsequent `$uri/` test for the redirected /blog/
 * request becomes /blog// → normalised back to /blog/ (not a regular file) →
 * falls through to /index.html (the SPA).  The explicit `$uri/index.html` step
 * avoids the redirect cycle and directly verifies the physical file.
 *
 * The matching rules themselves live in `src/blog-routing.ts` so they can be
 * unit tested; this plugin only applies them to the request URL.
 */
function blogIndexRewritePlugin() {
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
