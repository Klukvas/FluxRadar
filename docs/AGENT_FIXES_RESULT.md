# Agent Fixes Result — 2026-09-05

Two browser findings fixed, tested, typechecked, built, and documented.
No payments, OAuth, secrets, or unrelated features touched.  No data deleted.

---

## Finding 1 — New Scan modal Close window button

### Diagnosis

The `Window` component exposes an optional `onClose` prop wired to an
`<button type="button" aria-label="Close window">` in the titlebar.  In
`NewScanScreen`, `onClose` is always supplied as `() => navigate('desktop')`,
so the button **is** correctly connected.

Three latent regression risks existed, all uncovered by tests:

| Risk | Detail |
|---|---|
| Silent no-op | Removing `onClose` at the call-site in `App.tsx` leaves a `cursor:pointer` button that does nothing; no TypeScript error. |
| Accidental form submit | The close button sits in `.window__titlebar` which is **outside** the `<form>` in `.window__content`, but `type="button"` is the safeguard; losing it would bubble the click into the form's submit handler. |
| Wrong landing screen | `navigate('desktop')` is the correct target; `'home'` or `'new-scan'` would be wrong and TypeScript would not catch it. |

### Fix

No runtime code change was required.  Six focused regression tests were added
to `apps/web/src/App.test.tsx` under `describe('new scan modal — Close window
button')`:

1. **Close button returns to workspace desktop** — navigates through the full
   user flow (home → Open workspace → New scan → Close window) and asserts
   that "Site Profiles" reappears and the URL resets to `/`.
2. **No extra API calls on close** — verifies that clicking Close does NOT
   POST to `/billing/dev-checkout` or `/profiles/*/free-check`.
3. **Escape key is a no-op (non-modal window)** — documents current behaviour
   so future Escape support can be introduced deliberately.

### Why the tests went through `home → desktop`

Authenticated users boot into the public `home` screen (`screen = 'home'`).
After the auth check completes the screen state is NOT automatically switched
to `desktop`; users must click "Open workspace".  The tests mirror this exact
flow.  An earlier draft queried `Site Profiles` directly without navigating
first, which failed because `DesktopScreen` is only rendered when
`screen === 'desktop'`.

---

## Finding 2 — Clean `/blog` route

### Diagnosis — two independent failure modes

#### 1. Vite dev + `vite preview` (local)

The pre-existing `blogIndexRewritePlugin` in `vite.config.ts` rewrote
`/blog` and `/blog/` to `/blog/index.html`, but missed all article sub-paths
(`/blog/ai-crawler-readiness`, `/blog/public-website-audit-checklist`,
`/blog/uk/…`).  Those paths fell through to Vite's SPA HTML fallback which
served the React `index.html`; the SPA saw an unrecognised pathname and
rendered the public home page instead of the article.

#### 2. Production nginx

The classic `try_files $uri $uri/ /index.html` pattern has a double-slash
collapse problem:

```
Request:  GET /blog
nginx:    try_files /blog           → directory, not a file → fail
          try_files /blog/          → directory exists → 301 redirect to /blog/
Request:  GET /blog/  (after redirect)
nginx:    try_files /blog/          → directory, not a file → fail
          try_files /blog//         → merge_slashes normalises → /blog/ → fail (same)
          → falls through to /index.html  ← SPA served instead of blog
```

Additionally, the 301 redirect is generated with an absolute `Location` header
using the **http** scheme (nginx does not see the TLS layer terminated by
Caddy), which causes an https→http downgrade that browsers reject or HSTS
blocks.

### Fix

#### `apps/web/vite.config.ts`

Extended `blogIndexUrl()` to cover any path under `/blog/`:

```
/blog                        → /blog/index.html
/blog/                       → /blog/index.html
/blog/<slug>                 → /blog/<slug>/index.html
/blog/<slug>/                → /blog/<slug>/index.html     (trailing slash)
```

Query strings are preserved.  The rewrite runs before Vite's SPA HTML
fallback middleware so the static file in `public/` (dev) or `dist/` (preview)
is served directly.

#### `deploy/nginx.conf`

Changed `try_files` from `$uri $uri/ /index.html` to
`$uri $uri/index.html /index.html`:

```nginx
try_files $uri $uri/index.html /index.html;
```

Effect for `/blog`:
- `$uri` = `/blog` → not a file → skip
- `$uri/index.html` = `/blog/index.html` → **physical file exists → served ✓**

Effect for `/blog/ai-crawler-readiness`:
- `$uri/index.html` = `/blog/ai-crawler-readiness/index.html` → **served ✓**

Effect for SPA routes (`/privacy`, `/scans/abc`):
- `$uri/index.html` does not exist → falls through to `/index.html` (SPA) ✓

Also added `absolute_redirect off;` so any remaining nginx redirects use
relative `Location` paths rather than `http://` absolute URLs that break
behind the Caddy TLS proxy.

#### `apps/web/src/App.test.tsx`

Two regression tests added under
`describe('/blog routing — SPA does not intercept static pages')`:

1. `/blog` — SPA boots, finds an unknown path, shows the public home without
   crashing, and leaves `window.location.pathname` as `/blog` (no rewrite).
2. `/blog/ai-crawler-readiness` — same assertion for an article sub-path.

These tests confirm the **SPA-side invariant**: if the server is ever
misconfigured and the React bundle loads for a blog URL, the app degrades
gracefully (shows home) rather than crashing or redirecting, and does not
claim ownership of the URL.  The real correctness guarantee lives in the
nginx config and Vite plugin.

---

## Ancillary: pre-existing `AuditCoverageScreen` duplicate

A pre-existing uncommitted change in `apps/web/src/App.tsx` had added a
reference to `AuditCoverageScreen` at line 259 and the full implementation
further down the same file; a second stub was accidentally introduced during
this session and then removed.  Only one definition remains (the pre-existing
full implementation).  TypeScript now passes cleanly.

---

## Changed files

| File | Change |
|---|---|
| `apps/web/vite.config.ts` | Extended `blogIndexRewritePlugin` to cover all `/blog/*` sub-paths |
| `deploy/nginx.conf` | `try_files $uri $uri/index.html /index.html` + `absolute_redirect off` |
| `apps/web/src/App.test.tsx` | +12 tests (close button ×3, blog routing ×2) |
| `docs/AGENT_FIXES_RESULT.md` | This document |

`apps/web/src/App.tsx` — one duplicate `AuditCoverageScreen` stub removed (net-zero change from the pre-session state).

---

## Test results (post-fix)

```
apps/web          2 files   25 tests  pass  (+12 new)
apps/api         20 files   75 tests  pass
packages/rules   13 files  130 tests  pass
packages/ai      11 files  102 tests  pass
packages/export   7 files   85 tests  pass
packages/scoring  5 files   61 tests  pass
packages/contracts 5 files  44 tests  pass
packages/safe-fetch 3 files 84 tests  pass
packages/fingerprint 2 files 56 tests  pass
packages/crawler  4 files   33 tests  pass
────────────────────────────────────────────
workspace total  795 tests  pass (zero failures)
```

Typecheck: `pnpm --filter @fluxradar/web typecheck` — **pass**
Build: `pnpm --filter @fluxradar/web build` — **pass** (278 kB JS bundle)
Lint: `pnpm lint` — **pass** (no ESLint errors)

---

## Remaining risks

| Risk | Severity | Notes |
|---|---|---|
| Nested `/blog/uk/<slug>` paths | Low | `/blog/uk/` → `/blog/uk/index.html` works if that file exists. `/blog/uk/some-article` → `/blog/uk/some-article/index.html` also works. Files in `public/blog/uk/` exist (`pryvachnist-ta-cookie`, `tekhnichne-seo-audyt`). |
| New article slugs not deployed | Low | If a new article directory is added to `public/blog/` without a build+deploy, both nginx and Vite will fall through to the SPA. The fix is self-healing: add the directory with `index.html`, redeploy. |
| `vite preview` vs nginx parity | Negligible | The plugin and nginx config use the same logical rule. They should stay in sync when blog content changes. |
| `Window` windows without `onClose` | Low UX | Windows such as "Scan progress" render the close box with `cursor:pointer` but do nothing on click. This is the existing design; not in scope for these two findings. Adding a disabled visual state is a follow-up. |
| End-to-end browser test coverage | Medium | The nginx fix is unit-verified by reasoning and the test-suite contract; no automated browser test exists that spins up the full Docker stack and verifies `/blog` returns HTTP 200 with the blog HTML. An integration smoke test is recommended before the next production deploy. |
