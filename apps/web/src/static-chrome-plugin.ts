import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { runnerImport, type Connect, type Plugin } from 'vite';
import { blogIndexUrl } from './blog-routing.js';

async function htmlFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? htmlFiles(path) : entry.name === 'index.html' ? [path] : [];
    }),
  );
  return nested.flat();
}

/** Public HTML bypasses transformIndexHtml, so render it explicitly before static serving. */
export function staticChromePlugin(): Plugin {
  let root = process.cwd();
  let publicDir = '';
  return {
    name: 'static-site-chrome',
    configResolved(config) {
      root = config.root;
      publicDir = config.publicDir;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        const rewritten = blogIndexUrl(url);
        const pathname = (rewritten ?? url).split('?')[0] ?? '';
        if (
          !/^\/(blog|knowledge-base)\/.+index\.html$|^\/(blog|knowledge-base)\/index\.html$/.test(
            pathname,
          )
        )
          return next();
        const path = resolve(publicDir, `.${pathname}`);
        if (!path.startsWith(resolve(publicDir) + sep)) return next();
        try {
          const source = await readFile(path, 'utf8');
          const module = (await server.ssrLoadModule(
            '/src/static-chrome-render.tsx',
          )) as typeof import('./static-chrome-render');
          const html = module.renderStaticChrome(source, '/src/static-chrome-client.tsx');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(await server.transformIndexHtml(url, html));
        } catch (error) {
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOENT'
          )
            return next();
          next(error);
        }
      });
    },
    configurePreviewServer(server) {
      const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
        if (req.url) req.url = blogIndexUrl(req.url) ?? req.url;
        next();
      };
      server.middlewares.use(rewrite);
    },
    async writeBundle(options, bundle) {
      if (options.dir === undefined) throw new Error('Static chrome needs a build directory');
      const entry = Object.values(bundle).find(
        (item) => item.type === 'chunk' && item.isEntry && item.name === 'static-chrome',
      );
      if (entry === undefined) throw new Error('Static chrome client entry is missing');
      const { module } = await runnerImport<typeof import('./static-chrome-render')>(
        './src/static-chrome-render.tsx',
        { root, configFile: false },
      );
      for (const section of ['blog', 'knowledge-base']) {
        for (const path of await htmlFiles(join(options.dir, section))) {
          const html = await readFile(path, 'utf8');
          await writeFile(path, module.renderStaticChrome(html, `/${entry.fileName}`));
        }
      }
    },
  };
}
