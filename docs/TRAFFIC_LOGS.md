# Traffic logs

GA4 on fluxradar.net counts only the visitors who accept analytics cookies, and
it never counts a crawler. Caddy's access log counts every request, with no
cookie and no consent banner involved, so it is where to look for:

- the real number of requests and visitors, including the ones who declined
  analytics;
- which pages are hit, and which sites refer traffic;
- which crawlers visit, and in particular which **AI bots** do (GPTBot,
  ClaudeBot, PerplexityBot and the rest). FluxRadar sells AI-crawler readiness
  audits, so its own site is the first place to check what those bots actually
  fetch.

The log is written by the `log` block in [`deploy/Caddyfile`](../deploy/Caddyfile)
and read by [`scripts/traffic-report.sh`](../scripts/traffic-report.sh).
`DEPLOY-018` (`apps/api/src/deploy/deploy-018-access-log-privacy.test.ts`) pins
everything below.

## What is logged

One JSON line per request to `fluxradar.net`, written to
`/data/logs/access.log` inside the caddy container. `/data` is the `caddy_data`
volume (the same one that holds the TLS certificates, in its own `caddy/`
directory), so the log survives the Caddy recreate every deploy does.

Each line keeps what a traffic report needs: the time, method, host, path,
status, response size, duration, protocol, `User-Agent` and `Referer`.

## What is masked or removed

Filtered **before** a line is written — nothing unfiltered ever reaches disk:

| Field | Treatment | Why |
| --- | --- | --- |
| `request>remote_ip`, `request>client_ip` | Masked to the /24 (IPv4) or /48 (IPv6) network | A network, not a person's address. The DNS record is not proxied, so Caddy sees real client addresses and needs no trusted proxies. |
| `request>uri` | Query keys `reset_token`, `verify_email`, `token`, `code`, `state`, `email` deleted | The mailed reset and verification links, the API call that spends a verification token, and OAuth's callback carry one-time secrets as query parameters. |
| `request>headers>Referer` | Whole query string removed | A same-origin navigation sends the full previous URL — a reset link included (`Referrer-Policy: strict-origin-when-cross-origin`). |
| `resp_headers>Location` | Whole query string removed | A redirect to an OAuth provider carries its `state`. |
| `Cookie`, `Authorization`, `Proxy-Authorization`, `Set-Cookie` | Deleted | Caddy writes them as `REDACTED` by default; deleting them does not depend on that default. |
| `Forwarded`, `X-Forwarded-For`, `X-Real-Ip` | Deleted | Client-supplied, and a corporate proxy puts the user's own address in them. |

When the app starts putting a secret in a new query parameter, add it to the
`query` filter; DEPLOY-018 fails when a mailed link's parameter is missing.

Masking to a /24 makes GoAccess's *unique visitors* (address + date + user
agent) a slight undercount: two visitors on the same network with the same
browser on the same day count as one.

## Retention

The [Privacy Policy](../apps/web/src/legal/PrivacyPolicy.tsx) keeps ordinary
application and security logs for **up to 30 days**.

Caddy 2.10 rolls a log by size, not by time (time-based rolling arrived in
Caddy 2.11). The settings:

| Setting | Value | Effect |
| --- | --- | --- |
| `roll_size` | `2MiB` | The live file rolls once it reaches 2 MiB, and is gzipped. |
| `roll_keep_for` | `336h` (14 days) | A rolled file is deleted by the first roll or restart after it is 14 days old. |
| `roll_keep` | `100` | At most 100 rolled files; a crawler storm shortens retention instead of filling the disk. |

So an entry's worst-case age is *two fill times of a 2 MiB file plus 14 days*:
it waits in the live file until that fills, and its rolled file is removed at
the roll after it turns 14 days old. At roughly 2 KB per line, a 2 MiB file
holds about a thousand requests, so the 30-day promise holds while the site
serves more than about 140 requests a day. A public site whose every page view
also calls its API, and which crawlers visit, is expected to stay well above
that; nobody has measured it yet, which is what the check below is for.

`scripts/traffic-report.sh` checks it every time it runs: it prints a
**warning** when the server holds an entry older than 30 days. If you ever see
it, lower `roll_size` to `1MiB` in `deploy/Caddyfile` (DEPLOY-018 allows up to
2 MiB), or move to Caddy 2.11 and add `roll_interval`.

## Running the report

Once, on the Mac that runs it:

```bash
brew install goaccess
```

Then, from the repository root:

```bash
scripts/traffic-report.sh <user@host> [days]
```

- `<user@host>` is the production server as a user that can run `docker` — the
  same user and host as the deploy's `PRODUCTION_SSH_USER` and
  `PRODUCTION_SSH_HOST` secrets — or a `Host` alias from `~/.ssh/config`. The
  script stores neither.
- `[days]` is how far back to report: 1 to 30, 7 by default.

The script is read-only on the server. It finds the running caddy container of
the `fluxradar` compose project, streams the rotated logs (oldest first) and the
live one, keeps the requested window, and runs a local `goaccess
--log-format=CADDY`. The report is written to `traffic-reports/` in the
repository, which git ignores, and opens in the browser on macOS. The raw lines
are deleted when the script exits.

## Reading the report

- **Crawlers and AI bots**: the *Browsers* panel groups user agents by type.
  Expand **AI Crawlers** for GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot,
  Claude-User, PerplexityBot, Bytespider, CCBot and the rest, each with its hits
  and bandwidth; **Crawlers** holds search engines and other bots. The script
  hands GoAccess its own list of AI agents, so the grouping is the same on every
  GoAccess version, and it includes every agent the AI-readiness audit checks.
- **Pages**: *Requested Files* lists paths by hits, `/api/…` calls alongside
  the pages that made them. GoAccess does not cross-filter panels, so this is
  every client's traffic, bots included, not one bot's.
- **Referrers**: *Referring Sites* by host, *Referrers* by URL (query strings
  are already gone). Internal navigation shows up as `fluxradar.net`.
- **Visitors**: the overview's *Unique Visitors*, and *Visitors* per day.
