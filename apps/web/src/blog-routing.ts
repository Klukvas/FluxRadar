/**
 * Clean `/blog` URLs → the static file that actually answers them.
 *
 * The blog is plain HTML in `public/blog`, so a request for `/blog` or
 * `/blog/<slug>` has to be resolved to that directory's `index.html` before the
 * SPA fallback claims it. Production nginx does this with
 * `try_files $uri $uri/index.html /index.html`, and the dev/preview middleware
 * in `vite.config.ts` uses this function so the two behave the same.
 *
 * The `$uri` step is why a request for a real file inside the subtree — the
 * shared `blog.css` and `blog.js` the pages load — must be left alone: turning
 * `/blog/blog.css` into `/blog/blog.css/index.html` would 404 the stylesheet in
 * dev while production served it happily.
 */
export function blogIndexUrl(url: string): string | null {
  const query = url.indexOf('?');
  const path = query === -1 ? url : url.slice(0, query);
  const search = query === -1 ? '' : url.slice(query);

  if (path === '/blog' || path === '/blog/') return `/blog/index.html${search}`;
  if (!path.startsWith('/blog/') || path.length === '/blog/'.length) return null;

  const clean = path.endsWith('/') ? path.slice(0, -1) : path;
  if (hasFileExtension(clean)) return null;
  return `${clean}/index.html${search}`;
}

function hasFileExtension(path: string): boolean {
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  return lastSegment.includes('.');
}
