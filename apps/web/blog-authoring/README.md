# Blog authoring playbook

The scheduled blog agent follows this file on every run. People adding an article
by hand follow it too. The agent runs as a Claude Code cloud routine on Monday and
Thursday mornings (Kyiv time).

## What one run produces

- Take the **first two topics with `status: todo`** in [topics.yml](topics.yml).
  If only one is left, write that one. If none are left, skip to the queue step.
- Write each topic **in Ukrainian and in English**. One run therefore adds 2–4
  articles: two topics, two languages each.
- Open **one pull request** for the run, then **merge it yourself once every check
  is green**. A push to `main` starts `.github/workflows/deploy.yml`, which runs the
  quality gates again, releases, checks the live site and rolls back by itself if
  the site is broken. The owner asked for this (2026-11-13): articles go to
  production without a manual review. This authorization covers only blog content
  that follows this playbook.

## Steps

1. Create a branch `blog/<YYYY-MM-DD>` from `main`. Use the run date in Europe/Kyiv.
2. Read the two topics. Read the blog index (`apps/web/public/blog/index.html`)
   and the knowledge base index (`apps/web/public/knowledge-base/index.html`).
   If an existing article already covers the topic, give it a narrower angle that
   adds something new. Do not repeat an existing piece.
3. Before you describe anything FluxRadar checks, confirm it in the code
   (`packages/rules`, `packages/crawler`, `packages/scoring`). If you cannot find
   the check, do not claim FluxRadar does it.
4. Write the Ukrainian article, then the English one (see _Page contract_).
5. Add both to the blog index and the sitemap (see _Listing_).
6. Update the queue (see _Queue_).
7. Run the checks (see _Verify_). Fix what fails. If a check still fails after two
   fix attempts, open the PR as a **draft**, put the failure output in the body, and
   stop. A draft is never merged.
8. Commit with `content: add blog articles <slugs>`, push the branch and open the PR
   (see _Pull request_).
9. Merge and follow the deploy (see _Merge and deploy_).

## Page contract

### Where the files go

| Language  | Path                                           | Address                                   |
| --------- | ---------------------------------------------- | ----------------------------------------- |
| Ukrainian | `apps/web/public/blog/uk/<uk-slug>/index.html` | `https://fluxradar.net/blog/uk/<uk-slug>` |
| English   | `apps/web/public/blog/<en-slug>/index.html`    | `https://fluxradar.net/blog/<en-slug>`    |

Slugs are lowercase ASCII with hyphens. Write the Ukrainian slug in Latin
transliteration, like the existing ones (`seo-katalohu-tovariv`). Keep slugs to
2–5 words. Never reuse a slug that already exists.

### Template

Copy `apps/web/public/blog/uk/seo-katalohu-tovariv/index.html` as the structure for
**both** languages. For the English page, swap in the English site chrome (the
menubar, language dropdown and footer) from
`apps/web/public/blog/ai-crawler-readiness/index.html`: home `/`, FAQ `/faq`,
English labels, `en` marked as the active language option. Keep every `data-t` and
`data-t-label` attribute. `blog.js` translates the chrome with them.

### Head

- `<html lang="uk">` or `<html lang="en">`.
- `<title>`: no more than 60 characters, ending with ` | FluxRadar`.
- `<meta name="description">`: 120–160 characters.
- `<link rel="canonical">` and `og:url`: the page's own address.
- `og:type` is `article`. `og:locale` is `uk_UA` or `en_US`.
- The shared preview image. Every sitemap page carries it, and
  `public-heads.test.ts` checks this:
  ```html
  <meta property="og:image" content="https://fluxradar.net/og-image.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="FluxRadar · fluxradar.net" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="https://fluxradar.net/og-image.png" />
  ```
- Translation links on **both** pages, identical on each:
  ```html
  <link rel="alternate" hreflang="uk" href="https://fluxradar.net/blog/uk/<uk-slug>" />
  <link rel="alternate" hreflang="en" href="https://fluxradar.net/blog/<en-slug>" />
  <link rel="alternate" hreflang="x-default" href="https://fluxradar.net/blog/<en-slug>" />
  ```
- JSON-LD `@graph` with a `BlogPosting` and a `BreadcrumbList`, as in the template.
  `datePublished` and `dateModified` are the run date. `inLanguage` is `uk` or `en`.

### Body

- Breadcrumbs, then a header with a kicker (`<TOPIC> · УКРАЇНСЬКОЮ` or
  `<TOPIC> · IN ENGLISH`), an `<h1>`, a lede, and the publication date.
- An opening paragraph, a table of contents, then 4–6 `<section id="section-N">`
  sections with `<h2>` headings. Use lists or a small table where they help a reader.
- 900–1400 words of body text per article.
- `related-reading`: 2–4 links. The first is the translation ("English version" or
  "Українська версія"). The rest go to existing blog articles or knowledge-base pages
  in the same language. On English pages, link the knowledge base only when nothing
  in English fits. A page never recommends itself.
- **At least three other pages must link to every new page.**
  `public-links.test.ts` enforces this. The blog index and the translation give
  two. For the third, add the new page to the `related-reading` list of one existing
  article in the same language, or of the other article in the same language from
  this run.
- `article-sources`: 2–4 authoritative sources, such as Google Search Central,
  web.dev, MDN, W3C/WAI or the IETF. Cite **only pages you opened during this run**.
  If you cannot open the web, cite only documentation already linked from an
  existing article in this repo. Never invent a URL. End the section with the
  "checked on <date>" sentence and the no-promises sentence from the template.
- The `content-cta` paragraph and the footer, as in the template.

### Voice

- Write for a non-technical site owner, then give the specifics a developer needs.
- Base claims on evidence. Do not promise rankings, traffic, AI citations or sales.
- Do not invent statistics, case studies or customer results. Say a number only if
  a cited source gives it.
- Do not name competitors.
- The English article adapts the Ukrainian one for an English reader. It is not a
  word-for-word translation. Both make the same claims.
- Natural Ukrainian. No Russianisms, no machine-translation phrasing.

## Listing

### Blog index: `apps/web/public/blog/index.html`

Add a card at the **top** of each language section. The newest card goes first.
Ukrainian cards go in `data-article-lang="uk"` and English cards in
`data-article-lang="en"`:

```html
<article>
  <div class="article-meta">
    <span class="kicker-tag">TOPIC IN CAPITALS</span
    ><span class="lang-badge lang-badge--uk">UA</span>
  </div>
  <h2><a href="/blog/uk/<uk-slug>">Title</a></h2>
  <time datetime="YYYY-MM-DD">13 листопада 2026</time>
  <p>One- or two-sentence summary.</p>
</article>
```

On English cards the badge is `<span class="lang-badge">EN</span>` and the date
reads `November 13, 2026`. `datetime` must equal the article's `datePublished`.

### Sitemap: `apps/web/public/sitemap.xml`

Add one entry per article before `</urlset>`. Each entry lists both translations
and `x-default`:

```xml
<url><loc>https://fluxradar.net/blog/uk/<uk-slug></loc><lastmod>YYYY-MM-DD</lastmod><xhtml:link rel="alternate" hreflang="uk" href="https://fluxradar.net/blog/uk/<uk-slug>"/><xhtml:link rel="alternate" hreflang="en" href="https://fluxradar.net/blog/<en-slug>"/><xhtml:link rel="alternate" hreflang="x-default" href="https://fluxradar.net/blog/<en-slug>"/></url>
```

## Queue

In `topics.yml`, change each written topic to `status: done` and fill in
`published`, `uk_slug` and `en_slug`. If fewer than six `todo` topics remain
afterwards, add up to six new ones with `status: proposed`. Proposed topics must
not repeat an existing article. The agent never writes a `proposed` topic. The
owner promotes them to `todo`.

## Verify

Run these from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @fluxradar/web exec vitest run src/blog-catalog.test.ts src/blog-page.test.ts src/blog-public-locale.test.ts src/public-heads.test.ts src/public-links.test.ts
pnpm exec prettier --check apps/web/public/blog/index.html apps/web/public/blog/<en-slug> apps/web/public/blog/uk/<uk-slug>
```

`blog-catalog.test.ts` checks every article on disk. It confirms each one is on the
index and in the sitemap, declares its own canonical address and language, has the
same date on its card and in its JSON-LD, and has translation links that point at
each other. A failure there means the listing or the head is wrong. Fix the page,
not the test.

## Pull request

- Title: `content: blog articles YYYY-MM-DD`.
- Body: a table with the topic, both addresses and the word count of each article,
  the sources cited, the test output, and anything the owner should check by hand,
  such as a claim you could not fully verify.
- Change only the new article files, `blog/index.html`, `sitemap.xml`,
  `apps/web/blog-authoring/topics.yml` and the `related-reading` lists of existing
  articles. Nothing else.

## Merge and deploy

1. Wait for the PR's checks: `gh pr checks <number> --watch`. Merge only when every
   check passed. If any check fails, fix the pages, push, and wait again. After two
   failed rounds, leave the PR open, mark it draft and stop.
2. Before merging, confirm the diff touches only the paths listed under _Pull request_
   (`gh pr diff <number> --name-only`). If it touches anything else, do not merge.
3. Merge with `gh pr merge <number> --squash --delete-branch`. If `gh` cannot merge
   (missing, not authenticated, refused), do not look for another route to `main`.
   Leave the PR open and report why.
4. Follow the deploy the merge started: find the `Deploy production` run for the merge
   commit (`gh run list --workflow deploy.yml --commit <sha>`) and wait for it
   (`gh run watch <id> --exit-status`). It takes about 15–25 minutes.
5. When it succeeds, open each new address on `https://fluxradar.net` and confirm it
   answers 200 with the article's `<h1>`.
6. If the deploy fails, **never re-run it, never revert or push a fix to `main`
   yourself.** The workflow already rolled back if traffic was switched. Report the
   failing job and its link to the owner.

Never touch a deploy that this run did not start, and never start one by hand.
