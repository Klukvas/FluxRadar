import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import react from '@vitejs/plugin-react';
import type { Connect, Plugin } from 'vite';
import { defineConfig, runnerImport } from 'vite';

// Keep the runtime-style `.js` suffix: TypeScript resolves it to the `.ts`
// source, while Vite's native config loader gets an explicit ESM import.
import { legacyPublicRedirect, publicRequestRewrite } from './src/public-page-routing.js';
import { blogIndexUrl } from './src/blog-routing.js';
import { sentryDsnProblem } from './src/sentry-dsn.js';
import { PLAUSIBLE_SITE_SCRIPT, plausibleSiteScriptProblem } from './src/plausible-config.js';

/**
 * Serve standalone content HTML for clean /blog and /knowledge-base paths in `vite dev` and
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
      const redirect = legacyPublicRedirect(req.url);
      if (redirect !== null) {
        _res.statusCode = 308;
        _res.setHeader('Location', redirect);
        _res.end();
        return;
      }
      const normalizedPublic = publicRequestRewrite(req.url);
      if (normalizedPublic !== null) req.url = normalizedPublic;
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

/**
 * Writes `dist/<path>/index.html` for every public page except home, each with
 * that page's own title, description, canonical, social cards and alternates
 * (see `src/static-page-heads.ts` for why the first response needs them).
 *
 * It starts from the `index.html` this build just emitted, so the hashed script
 * and stylesheet tags are the real ones. The generator is loaded through Vite's
 * own module runner rather than imported here: it reaches `api.ts`, which reads
 * `import.meta.env` at module load, and only a Vite transform defines that.
 */
function staticPageHeadsPlugin(): Plugin {
  let root = process.cwd();
  return {
    name: 'static-page-heads',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    async writeBundle(options, bundle) {
      const entry = bundle['index.html'];
      if (entry?.type !== 'asset' || options.dir === undefined) {
        throw new Error(
          'static-page-heads: the build wrote no index.html to derive page heads from',
        );
      }
      const template =
        typeof entry.source === 'string' ? entry.source : new TextDecoder().decode(entry.source);
      const { module } = await runnerImport<typeof import('./src/static-public-render')>(
        './src/static-public-render.tsx',
        {
          root,
          configFile: false,
          plugins: [
            {
              name: 'prerender-style-imports',
              enforce: 'pre',
              resolveId(id) {
                return id.endsWith('.css') ? `\0prerender-style:${id.replaceAll('.', '_')}` : null;
              },
              load(id) {
                return id.startsWith('\0prerender-style:') ? '' : null;
              },
            },
          ],
        },
      );
      for (const file of module.staticPublicFiles(template)) {
        const target = join(options.dir, file.fileName);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.html);
      }
    },
  };
}

/**
 * Refuses to build a site whose error reports could never arrive: a
 * VITE_SENTRY_DSN that is set but unusable (src/sentry-dsn.ts) fails the image
 * build here, instead of shipping a site that only warns in the console. An
 * empty value builds without error monitoring. The DSN is never printed.
 */
function sentryDsnCheckPlugin(): Plugin {
  return {
    name: 'sentry-dsn-check',
    apply: 'build',
    configResolved(config) {
      const dsn = String(config.env.VITE_SENTRY_DSN ?? '').trim();
      const problem = dsn === '' ? null : sentryDsnProblem(dsn, config.mode);
      if (problem !== null) {
        throw new Error(
          `VITE_SENTRY_DSN is set but unusable: ${problem}. Fix the PRODUCTION_SENTRY_WEB_DSN ` +
            'variable, or leave it empty to build without error monitoring.',
        );
      }
    },
  };
}

/**
 * A Plausible site script id that has been filled in and is wrong fails the
 * build, for the same reason the Sentry DSN does: the alternative is a site
 * whose tracker 404s on every page, which nothing but a browser console would
 * report.
 *
 * The placeholder itself is not an error — it means the Plausible account does
 * not exist yet, and a build carrying it simply counts nothing
 * (src/plausible-config.ts). What fails here is a half-pasted value: the whole
 * snippet URL, the `.js` left on the end, or a name that is not Plausible's.
 * The id must also reach deploy/Caddyfile and public/blog/blog.js; DEPLOY-023
 * and blog-page.test.ts fail while only some of the three have it.
 */
function plausibleSiteScriptCheckPlugin(): Plugin {
  return {
    name: 'plausible-site-script-check',
    apply: 'build',
    configResolved() {
      const problem = plausibleSiteScriptProblem(PLAUSIBLE_SITE_SCRIPT);
      if (problem !== null) {
        throw new Error(
          `PLAUSIBLE_SITE_SCRIPT in apps/web/src/plausible-config.ts is unusable: ${problem}. ` +
            'Copy the "pa-XXXXX" name out of the snippet in Plausible → site settings → ' +
            'General → Site Installation, and put the same id in deploy/Caddyfile and ' +
            'apps/web/public/blog/blog.js.',
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    blogIndexRewritePlugin(),
    staticPageHeadsPlugin(),
    sentryDsnCheckPlugin(),
    plausibleSiteScriptCheckPlugin(),
  ],
});
