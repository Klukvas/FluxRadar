# Production deployment

FluxRadar is deployed to one Hetzner Cloud server through GitHub Actions.

## Runtime layout

- Caddy terminates HTTPS on the server and routes `fluxradar.net/api/*` to the API.
- Nginx serves the React SPA from the web container.
- PostgreSQL runs as an internal Docker service and persists data in the
  `fluxradar_postgres` volume; port 5432 is not published to the Internet.
- Complete report artifacts use the private Hetzner Object Storage bucket.
- Releases are unpacked under `/opt/fluxradar/releases/<commit>` and selected by
  `/opt/fluxradar/current`.
- Encrypted database snapshots go to the same Hetzner bucket under
  `fluxradar/postgres/` — see *Database backup and restore*.

## Required GitHub environment

The `production` environment contains these secrets:

- `PRODUCTION_SSH_HOST`
- `PRODUCTION_SSH_USER`
- `PRODUCTION_SSH_PRIVATE_KEY`
- `PRODUCTION_SSH_KNOWN_HOSTS`
- `PRODUCTION_APP_DIR`
- `PRODUCTION_ENV_FILE`

`PRODUCTION_BACKUP_ENCRYPTION_KEY` is required as well once database backups are
switched on — see *Database backup and restore*.

The last secret is the complete production environment file and must never be
committed to the repository, and the deploy workflow never overwrites it
blindly. It must include `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`DATABASE_URL` pointing to the `postgres` compose service,
`FLUXRADAR_ENV_FILE=.env.production` and `INTEGRATION_ENCRYPTION_KEY`. The API
refuses to start in production when `DATABASE_URL` or the dedicated
`INTEGRATION_ENCRYPTION_KEY` is missing; every integration is optional, but none
of them may be *half* configured (see *Optional, but never half configured*).

### `INTEGRATION_ENCRYPTION_KEY`

This key encrypts every stored Google/Bing access and refresh token, so it is the
one thing between a database dump and every connected customer's analytics. Two
rules, both enforced:

- **It must be stated in production, and there is no fallback.** Development and
  tests may fall back to `SESSION_SECRET`; nothing else may, and an *unset*
  `NODE_ENV` gets no fallback either — an unlabelled process in a container is a
  production process that lost its label, not a developer checkout.
- **It must not be the same value as `SESSION_SECRET`.** Copying it across
  satisfies the first rule while reintroducing exactly the coupling the first
  rule exists to prevent: the day `SESSION_SECRET` is rotated, every stored token
  becomes undecryptable, with no error anywhere — AES-GCM simply stops
  authenticating.

Both are refused twice: `deploy/normalize-env-file.cjs` fails the **deploy** on an
env file that breaks either, so a bad file never reaches the server, and
`validateRuntimeConfig` fails the **boot** as a backstop. Both report variable
names only. The normalizer additionally *warns* when the key is shorter than 32
characters — it is stretched with a single unsalted SHA-256, so its own entropy is
all a leaked database has. A warning rather than an error, because a deployment
already running a short key has to be able to redeploy in order to rotate it.

Generate one with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Rotating it makes every **existing** integration connection undecryptable; users
reconnect Google/Bing afterwards. Plan a rotation, do not improvise one.

### Optional, but never half configured

Every optional integration reports one of three states —
`not_configured` / `invalid` / `configured` — and only the middle one is fatal.
Being off is a normal production state; looking connected while being unable to
complete a single request is not. In production `validateRuntimeConfig` collects
every `invalid` integration into a single startup error naming the variables,
never their values, so one failed deploy shows every gap at once:

| Integration | Off when… | Refuses to boot when… |
| ----------- | --------- | --------------------- |
| Google / Bing OAuth | no `*_OAUTH_*` variable is set | a client id/secret is set without the other, or `*_OAUTH_REDIRECT_URI` is missing or is not an `https://` callback on `fluxradar.net` ending in `/integrations/<provider>/callback` |
| Object storage | no `HETZNER_S3_*` variable is set | some of the five are set, or `HETZNER_S3_ENDPOINT` has no `https://` scheme |
| Anthropic | `ANTHROPIC_API_KEY` is absent | `ANTHROPIC_MODEL` names a retired model while a key is present |
| FastSpring | no `FASTSPRING_*` variable is set | the set is incomplete (see *Billing gate*) |

The OAuth rule is the one with a history: with a client id and secret but no
redirect URI, the API used to fall back to the **localhost** callback in
production. The provider then rejected the callback after the user had already
completed the consent screen — a silent failure that looked like a provider
outage. Local development still gets `http://localhost:3310/integrations/<provider>/callback`
automatically; production must state the callback and it must be the HTTPS one
registered with the provider.

Object storage is the other one: a partial `HETZNER_S3_*` set used to disable the
store silently, so exports kept working, nothing was archived, and the deploy
looked healthy.

### The network the crawl leaves from

`CRAWL_EGRESS_PROXY_URL` (`http://user:password@host:port`, port required) sends
every crawl request through an HTTP CONNECT proxy instead of this server's own
network. It exists because sites behind a WAF that rejects this hosting network
answer 403 to everything — start page, `robots.txt`, `sitemap.xml` — and a
report can only describe that as a site with no robots.txt that never returns
200. Absent is supported and means a direct crawl, which is the local default.

Each proxy is an **egress location**, and the owner chooses on the launch
screen which one a scan leaves from (D-228), because a site can answer visitors
from different countries differently. `CRAWL_EGRESS_PROXY_URL` is the Ukrainian
location (Kyiv) and the default one — a Free check always uses it — and every
further country is `CRAWL_EGRESS_PROXY_URL_<CODE>` plus a registry entry (see
*Adding a country* below). The choice is stored in the scan's execution config,
the report prints it beside the plan, and a scan is never moved to another
location: a launch naming a location that is not configured or not answering is
refused (`EGRESS_LOCATION_UNKNOWN` 400, `EGRESS_LOCATION_UNAVAILABLE` 503), and
a started scan whose location goes down fails as a platform failure.

It fails the boot when it is present but unreadable, by variable name: the
alternative is falling back to the blocked network and producing that same
report again. So does a `CRAWL_EGRESS_PROXY_URL_<CODE>` for which no location
is registered. The value carries a password and appears in no log line and no
error message, not even by length; the SSRF guard does not move to the proxy,
which is asked to tunnel to an address this process already resolved and
approved (`packages/safe-fetch/src/proxy.ts`).

#### The proxy host

It is a proxy, not a VPN: only the crawl's own requests go through it, one at a
time, addressed explicitly. Everything else the API does — Anthropic, PageSpeed,
FastSpring, Resend, object storage, backups — leaves from the production server
directly, and the server's own routing is untouched.

| | |
| --- | --- |
| Host | `173.242.53.147`, Kyiv |
| Network | AS200000 Hosting Ukraine — a Ukrainian ASN, which is the whole point |
| Provider / plan | ukraine.com.ua, VPS 2G — 315 UAH per month, 1 TB of traffic |
| Software | Ubuntu, tinyproxy on port 13128, basic auth, `ConnectPort` 443 and 80 |
| Config | `/etc/tinyproxy/tinyproxy.conf` (the stock file is kept as `.orig`) |
| Access | SSH by key only (`~/.ssh/fluxradar_egress` on the maintainer's Mac); password login is off and the provider's VNC console is the way back in |
| Firewall | inbound: 22 open, 13128 **only** from the production host `138.201.172.158`; outbound: every private range denied |
| Traffic | `vnstat -m` on the host is the authority for the 1 TB cap; the API's own monthly counter is a lower-bound estimate (D-225) |

Ukraine was chosen because the block follows the network, not the agent: the
same `FluxRadarBot/0.1` request that a Ukrainian address answers with 200 is
refused from this server's hosting network, and our customers' sites are
Ukrainian. Do not "fix" an outage by pointing the variable at a box on the
production server's own hosting network — that is the state this whole
arrangement exists to leave.

The password lives in exactly two places, neither of them this repository: the
GitHub environment secret `PRODUCTION_CRAWL_EGRESS_PROXY_URL` and two
`chmod 600` files on the maintainer's Mac. To rotate it: change `BasicAuth` in
the tinyproxy config, restart the service, update the secret, redeploy.

An unreachable proxy is not a silent condition. The API checks every location
at startup and every five minutes, and a scan attempt checks its own location
before its first request; the check confirms both that the proxy answers and
that the public internet sees its address and not the server's own (D-225). A
location that fails is logged as an error naming it
(`crawl egress proxy is unreachable — scans from this location are blocked`,
with `location` in the context), stops being offered on the launch screen, and
refuses launches until it answers again. A scan already running fails as a
platform failure — ours, refundable — instead of reporting the customer's site
as unreachable. Restoring service means fixing that host or building a
replacement the same way: a VPS whose IP `whois` shows on a Ukrainian ASN,
tinyproxy with the same config, the firewall reduced to the production host,
then the secret and a redeploy.

Traffic is counted per location and month (`CrawlEgressLocationUsage`, a warning
at 80% of that location's `monthlyTrafficBytes` in the registry). The older
`CrawlEgressUsage` table is what the previous release writes and nothing here
reads it; it goes in a contract-phase migration once that release cannot return.

#### Adding a country

A country is one VPS, one variable and one registry entry. Nothing in the
rules, the crawler or the orchestrator changes, and the launch screen lists it
as soon as its proxy answers.

1. **Rent a VPS whose address sits in that country's own network.** The block
   this exists to avoid follows the network, not the flag on a provider's
   website, so check the address before paying for a year of it:
   `whois <ip>` must show an ASN registered in that country (`country:` and the
   `origin:` AS's own `country:`), and a geolocation lookup should agree.
   Resellers of "local" proxies and VPSes very often route through somebody
   else's network — a "Polish" box on a German ASN is a German crawl with a
   Polish label on the report. Prefer a small local hosting company over a
   global cloud's regional zone for the same reason. Note the plan's monthly
   traffic allowance.
2. **Build the proxy exactly like the Kyiv one** (*The proxy host* above):
   tinyproxy on a non-default port, basic auth with a fresh password,
   `ConnectPort` 443 and 80, key-only SSH, inbound open for that port **only**
   from the production host `138.201.172.158`, every private range denied
   outbound, `vnstat` installed. From the production host,
   `curl -x http://user:pass@<ip>:<port> https://www.cloudflare.com/cdn-cgi/trace`
   must print `ip=<ip>` — the address the check will expect.
3. **Register it** in `apps/api/src/integrations/crawl-egress-locations.ts`:
   `egressLocation({ id: 'de', countryCode: 'DE', city: 'Frankfurt', label: { en: 'Germany, Frankfurt', uk: 'Німеччина, Франкфурт' }, monthlyTrafficBytes: … })`.
   The id is the lower-case country code (`de-fra` if a second point in the
   same country is ever needed), and it is written into every scan that uses
   it — so an entry is never removed or re-pointed at another city afterwards;
   a retired location just loses its variable, and a new city is a new id.
   The labels are what the launch screen and every report print.
4. **Set the secret.** The variable is `CRAWL_EGRESS_PROXY_URL_<CODE>` (and
   optionally `CRAWL_EGRESS_EXPECTED_IP_<CODE>` = the address from step 2).
   Add both lines to `PRODUCTION_ENV_FILE`, which needs no workflow change. A
   separate `PRODUCTION_CRAWL_EGRESS_PROXY_URL_<CODE>` secret, rotated on its
   own like the Ukrainian one, also needs its `upsert_env` line in
   `.github/workflows/deploy.yml` — whose steps are pinned by the `DEPLOY-*`
   tests, so update them in the same change. Keep the password in the same two
   places as Kyiv's: the GitHub secret and a `chmod 600` file on the
   maintainer's Mac, never this repository. Deploying the variable before the
   registry entry fails the boot by name, which is the intended order of events.
5. **Deploy and watch it arrive.** The startup log's `crawl egress proxy checked`
   line should carry the new `location` with `state: healthy`, and the
   country appears on the launch screen. Add the host to this document's table
   the way the Kyiv host is described, and watch its traffic with `vnstat -m`
   on the box — the API's own counter is a lower bound (D-225).

PageSpeed, CrUX and Resend cannot fail the boot (Resend is reported as `invalid`
when only one half of the key/sender pair is present, but transactional email
stays optional). PageSpeed remains enabled without `PAGESPEED_API_KEY`; the key
only raises the upstream quota. `CRUX_API_KEY` is optional and adds field data
when configured. Their state is visible in the startup log instead.

### Local secret files

An OAuth client download (`client_secret_*.json`) may sit in a developer
checkout. It is protected in two places and must stay that way: `.gitignore`
excludes `client_secret_*.json`, and the deploy workflow's release archive
excludes the same pattern, so it can neither be committed nor shipped to the
server. Delete or move such a file out of the repository once the client id and
secret are in the environment; never add one to the release.

### Startup configuration log

The API logs one `integration configuration` line at boot listing which
integrations are `configured`, `disabled` and `invalid`, plus one
`integration is only partially configured` error line per half-configured
integration with the missing variable names. Names and statuses only — no value
of any variable is ever logged. This is the same rule the FastSpring line already
followed, extended to storage, Anthropic, PageSpeed, CrUX, Resend, Google and
Bing (`apps/api/src/integrations/diagnostics.ts`).

### How the env file must be written

The deploy reads that file with **two different parsers**: `docker compose
--env-file` starts PostgreSQL and Caddy, while `docker run --env-file` starts the
API and web containers. They disagree — compose strips quotes, interpolates `$`,
drops an inline `#` comment and trims trailing whitespace; `docker run` does none
of that. Since compose initialises PostgreSQL from `POSTGRES_PASSWORD` and the
API connects with `DATABASE_URL`, a quoted password used to create the database
with one value and point the API at another.

`deploy/normalize-env-file.cjs` is therefore the single writer of the release env
file. It runs in the deploy after the optional secrets are merged and before the
file is uploaded, and it:

- rewrites every assignment into the one form both parsers read identically
  (unquoted, no interpolation, no inline comment);
- **fails the deploy** on anything it cannot express in both — a value with a
  leading/trailing space, a `#` comment on the value line, an `export ` prefix,
  a backslash escape in a double-quoted value, or a `$` in a variable compose
  itself reads (`POSTGRES_*`, `DATABASE_URL`, `FLUXRADAR_*`);
- **cross-checks** `DATABASE_URL` against `POSTGRES_USER` / `POSTGRES_PASSWORD` /
  `POSTGRES_DB` and requires its host to be the compose service `postgres`;
- requires `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL`,
  `FLUXRADAR_ENV_FILE=.env.production` and `INTEGRATION_ENCRYPTION_KEY`;
- prints variable **names** and problems only — never a value.

So: write plain `KEY=value` lines, and if a generated password would need quoting,
`$` or a trailing space, generate a different one. `DEPLOY-002`
(`apps/api/src/deploy/deploy-002-env-file-parity.test.ts`) runs the shipped script
against both parser behaviours in CI.

### Retired variables

Paddle is gone from the code (D-229), and with it two variables that nothing
reads any more: `PADDLE_WEBHOOK_SECRET` and `FLUXRADAR_ENABLE_MOCK_CHECKOUT`.
Delete `PADDLE_WEBHOOK_SECRET` from `PRODUCTION_ENV_FILE`: no release a rollback
could return to requires it — since 2026-09-06 a missing value is replaced by a
random one at startup — so the normalizer no longer warns about it and the
rollback probe no longer asks. `FLUXRADAR_ENABLE_MOCK_CHECKOUT` must simply stay
unset: releases before this one refuse to boot in production with it set, and
the rollback probe runs their validators.

**Delete the `PADDLE_WEBHOOK_SECRET` line whole, or leave it with its value —
never leave it present and empty** (`PADDLE_WEBHOOK_SECRET=`). The releases
before D-229 tell the two apart: `resolvePaddleWebhookSecret` substitutes a
random secret only when the variable is *undefined*, and hands an empty string
on to `getPaddleWebhookSecret`, whose `!secret` check throws. `startServer` calls
it on every boot, so an empty value keeps such a release from starting — which
is exactly the release a rollback would start.

### Transactional email

Email verification and password reset are implemented and ship in this release;
what is not automatic is the Resend account behind them. Until it is connected,
the API still boots and every email-dependent flow reports `not-configured`
rather than pretending a message was sent — `POST /auth/register` answers with
`emailVerification: { status: "not-configured" }` and the password-reset request
still answers 202 (it is deliberately indistinguishable from an unknown address).

To connect it, set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` — either in
`PRODUCTION_ENV_FILE`, or through the two `production` secrets
`PRODUCTION_RESEND_API_KEY` and `PRODUCTION_RESEND_FROM_EMAIL`, which override
them when non-empty and are skipped when empty, like every other optional
override below. Supplying them as deploy secrets is what lets the pair be
connected or corrected — a rotated key, a rebrand, a new sending subdomain —
without rewriting a base env file nobody can read back.

They are overridable as a **pair** on purpose: half of it sends nothing and is
reported `invalid` at boot, by name. `RESEND_REPLY_TO` stays optional everywhere
and has no deploy secret, because on its own it configures nothing.

**Remaining manual, provider-side steps — none of which this repository can do or
verify:**

1. Create a Resend account and an API key with send permission.
2. Add `fluxradar.net` (or the chosen sending subdomain) as a **domain** in the
   Resend dashboard.
3. Publish the DKIM and SPF DNS records Resend prints, at the same authoritative
   DNS provider as the `A` record, and wait for Resend to report the domain
   **verified**.
4. Set `RESEND_FROM_EMAIL` to an address on that verified domain, as
   `mail@fluxradar.net` or `FluxRadar <mail@fluxradar.net>`.
5. Register once against the live site and confirm the verification email
   arrives. This is the only end-to-end proof; CI never sends a real message.

What *is* checked automatically, at startup, by name and never by value
(`apps/api/src/email/resend-config.ts`):

- exactly one of the key/sender pair present → reported `invalid`;
- a `RESEND_FROM_EMAIL` that is not an address Resend could accept → reported
  `invalid`, because a malformed sender is otherwise indistinguishable from a
  working one until a customer says the email never arrived;
- a `RESEND_REPLY_TO` left behind on its own, or one that is not an address.

None of these fails the boot: a deployment that cannot send email can still sell
and run scans. They appear in the `integration configuration` line and in an
`integration is only partially configured` error line. **An unverified domain is
not visible here at all** — it is an HTTP error on the first send, which the
caller reports as `provider-error`.

### Support requests

The floating **Support** button on every page opens a form that guests and
signed-in owners can both send. The API forwards each request to a Telegram
channel through a bot (`apps/api/src/support/`). Until the bot is connected,
production offers no button at all: `GET /support/status` answers
`available: false` and `POST /support` answers `503 SUPPORT_UNAVAILABLE`. Local
development without a bot writes each request to the API log instead.

To connect it, set both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_SUPPORT_CHAT_ID` in
`PRODUCTION_ENV_FILE`. There is no deploy secret override for them in this
release.

1. Create a bot with @BotFather and copy the token it prints.
2. Add the bot to the support channel as an **administrator** allowed to post
   messages.
3. Take the channel's `@username` if it is public, or its numeric id — which
   starts with `-100` — if it is private.
4. Deploy, open the site signed out, send one message, and confirm it arrives in
   the channel. This is the only end-to-end proof; CI never sends a real message.

What is checked at startup, by name and never by value
(`apps/api/src/support/telegram-config.ts`): exactly one of the pair present, a
token that is not shaped like a BotFather token, or a chat id that is neither
numeric nor an `@username` is reported `invalid`, and the form stays off. None of
these fails the boot. **A bot that is not an admin of the channel is not visible
here** — it is a `support request delivery failed` error line with Telegram's
reason on the first send, and the visitor is asked to try again.

The reply address of a signed-in request is the account's own; a guest's is
labelled unverified in the channel. Each sender (account, or a guest's address)
may send 3 requests per 15 minutes, and each client address 10.

## Optional integration secrets

**Precedence, and there is only one rule:** `PRODUCTION_ENV_FILE` is the base,
and a matching optional secret overrides one variable in it *only when that
secret is non-empty*. The workflow itself pins nothing — it used to hardcode
`ANTHROPIC_MODEL`, which silently outranked the base file and contradicted this
document. To connect integrations one at a time without editing the base file,
define any of these separate `production` environment secrets. The deploy
workflow merges each non-empty value into the release env file (an unset or empty
secret is skipped and never adds a blank override; values are never echoed to the
workflow log):

| GitHub `production` secret                | Env key written           |
| ---------------------------------------- | ------------------------- |
| `PRODUCTION_INTEGRATION_ENCRYPTION_KEY`   | `INTEGRATION_ENCRYPTION_KEY` |
| `PRODUCTION_BING_OAUTH_CLIENT_ID`         | `BING_OAUTH_CLIENT_ID`     |
| `PRODUCTION_BING_OAUTH_CLIENT_SECRET`     | `BING_OAUTH_CLIENT_SECRET` |
| `PRODUCTION_BING_OAUTH_REDIRECT_URI`      | `BING_OAUTH_REDIRECT_URI`  |
| `PRODUCTION_GOOGLE_OAUTH_CLIENT_ID`       | `GOOGLE_OAUTH_CLIENT_ID`   |
| `PRODUCTION_GOOGLE_OAUTH_CLIENT_SECRET`   | `GOOGLE_OAUTH_CLIENT_SECRET` |
| `PRODUCTION_GOOGLE_OAUTH_REDIRECT_URI`    | `GOOGLE_OAUTH_REDIRECT_URI` |
| `PRODUCTION_ANTHROPIC_API_KEY`            | `ANTHROPIC_API_KEY`        |
| `PRODUCTION_PAGESPEED_API_KEY`            | `PAGESPEED_API_KEY`        |
| `PRODUCTION_CRUX_API_KEY`                 | `CRUX_API_KEY`             |
| `PRODUCTION_CRAWL_EGRESS_PROXY_URL`       | `CRAWL_EGRESS_PROXY_URL`   |
| `PRODUCTION_RESEND_API_KEY`               | `RESEND_API_KEY`           |
| `PRODUCTION_RESEND_FROM_EMAIL`            | `RESEND_FROM_EMAIL`        |
| `PRODUCTION_HETZNER_S3_ACCESS_KEY`        | `HETZNER_S3_ACCESS_KEY`    |
| `PRODUCTION_HETZNER_S3_SECRET_KEY`        | `HETZNER_S3_SECRET_KEY`    |
| `PRODUCTION_HETZNER_S3_ENDPOINT`         | `HETZNER_S3_ENDPOINT`      |
| `PRODUCTION_HETZNER_S3_REGION`           | `HETZNER_S3_REGION`        |
| `PRODUCTION_HETZNER_S3_BUCKET`            | `HETZNER_S3_BUCKET`        |
| `PRODUCTION_BACKUP_ENCRYPTION_KEY`        | `FLUXRADAR_BACKUP_ENCRYPTION_KEY` |

The model identifier is not a secret, so it is a production environment
**variable** rather than a secret: set `PRODUCTION_ANTHROPIC_MODEL` to override
`ANTHROPIC_MODEL`, or leave it unset to keep whatever `PRODUCTION_ENV_FILE`
defines. With neither present the API uses its own default,
`DEFAULT_ANTHROPIC_MODEL` in `apps/api/src/integrations/anthropic-config.ts` —
currently `claude-sonnet-5`, the model this release is written against. A base
env file left on a **retired** model identifier no longer needs a workflow
override to correct it: with `ANTHROPIC_API_KEY` present, the API refuses to boot
and names `ANTHROPIC_MODEL` (never its value).

### FastSpring

Every `FASTSPRING_*` variable can be supplied from the `production` environment
instead of the base file, and only three of them are secrets. The rest describe
*which* store, checkout and products this deployment sells and are visible in the
FastSpring app to anyone who can open it, so they are environment **variables**:

| GitHub `production` secret                | Env key written                |
| ---------------------------------------- | ------------------------------ |
| `PRODUCTION_FASTSPRING_API_USERNAME`      | `FASTSPRING_API_USERNAME`      |
| `PRODUCTION_FASTSPRING_API_PASSWORD`      | `FASTSPRING_API_PASSWORD`      |
| `PRODUCTION_FASTSPRING_WEBHOOK_SECRET`    | `FASTSPRING_WEBHOOK_SECRET`    |

| GitHub `production` **variable**                   | Env key written                       |
| ------------------------------------------------- | ------------------------------------- |
| `PRODUCTION_FASTSPRING_MODE`                       | `FASTSPRING_MODE`                     |
| `PRODUCTION_FASTSPRING_SESSION_API`                | `FASTSPRING_SESSION_API`              |
| `PRODUCTION_FASTSPRING_CHECKOUT_PATH`              | `FASTSPRING_CHECKOUT_PATH`            |
| `PRODUCTION_FASTSPRING_POPUP_STOREFRONT`           | `FASTSPRING_POPUP_STOREFRONT`         |
| `PRODUCTION_FASTSPRING_STOREFRONT_URL`             | `FASTSPRING_STOREFRONT_URL`           |
| `PRODUCTION_FASTSPRING_PRODUCT_PATH_BASIC`         | `FASTSPRING_PRODUCT_PATH_BASIC`       |
| `PRODUCTION_FASTSPRING_PRODUCT_PATH_COMPLETE`      | `FASTSPRING_PRODUCT_PATH_COMPLETE`    |
| `PRODUCTION_FASTSPRING_CURRENCY_POLICY`            | `FASTSPRING_CURRENCY_POLICY`          |
| `PRODUCTION_FASTSPRING_STORE_VERIFIED`             | `FASTSPRING_STORE_VERIFIED`           |
| `PRODUCTION_FASTSPRING_SESSION_EXPIRATION_DAYS`    | `FASTSPRING_SESSION_EXPIRATION_DAYS`  |

The set is all-or-nothing: a half-configured provider is reported as
`misconfigured` and sells nothing, and in production it fails the boot naming the
missing variables. `FASTSPRING_MODE=live` additionally requires
`FASTSPRING_STORE_VERIFIED=verified`, which may only be set after the FastSpring
store itself has been checked — see `docs/FASTSPRING.md` §3/§4. Without it the
production boot fails on purpose. Setting the block directly in
`PRODUCTION_ENV_FILE` works exactly as well; the overrides above exist so a value
can be changed without rewriting the whole file.

### Backup retention

The encryption key is a secret (above). The retention knobs describe a policy,
not a credential, so they are `production` environment **variables**. All are
optional; the defaults are in *Database backup and restore*.

| GitHub `production` **variable**       | Env key written                     |
| -------------------------------------- | ----------------------------------- |
| `PRODUCTION_BACKUP_PREFIX`             | `FLUXRADAR_BACKUP_PREFIX`           |
| `PRODUCTION_BACKUP_RETENTION_DAYS`     | `FLUXRADAR_BACKUP_RETENTION_DAYS`   |
| `PRODUCTION_BACKUP_MIN_KEEP`           | `FLUXRADAR_BACKUP_MIN_KEEP`         |
| `PRODUCTION_BACKUP_MAX_DELETE`         | `FLUXRADAR_BACKUP_MAX_DELETE`       |
| `PRODUCTION_BACKUP_STALE_HOURS`        | `FLUXRADAR_BACKUP_STALE_HOURS`      |
| `PRODUCTION_BACKUP_MAX_AGE_HOURS`      | `FLUXRADAR_BACKUP_MAX_AGE_HOURS`    |

`DEPLOY-009` (`apps/api/src/deploy/deploy-009-ci-security-checks.test.ts`) fails
when a workflow reads a `secrets.*` or `vars.*` name this document does not
mention, because a name only the workflow knows resolves to an empty string and
is skipped in silence.

`PRODUCTION_INTEGRATION_ENCRYPTION_KEY` upserts the same key the base file may
already define; supply it only when rotating or when the base file omits it.
Resend has no optional deploy secret — set `RESEND_API_KEY`/`RESEND_FROM_EMAIL`
directly in `PRODUCTION_ENV_FILE` when you are ready to connect email.

The optional GitHub `production` environment variable
`FLUXRADAR_INTERNAL_FREE_EMAILS` is merged into that file the same way. Keep it
as an exact comma-separated list for internal test accounts; leave it unset when
internal free access should be disabled.

| GitHub `production` **variable**          | Env key written                        |
| ----------------------------------------- | -------------------------------------- |
| `FLUXRADAR_INTERNAL_FREE_EMAILS`          | `FLUXRADAR_INTERNAL_FREE_EMAILS`       |
| `PRODUCTION_FREE_CHECK_ALLOWED_ORIGINS`   | `FLUXRADAR_FREE_CHECK_ALLOWED_ORIGINS` |

`PRODUCTION_FREE_CHECK_ALLOWED_ORIGINS` names the origins allowed to re-run the
free homepage check without spending a limit; it is a variable rather than a
secret because an https origin is public by construction. See *Free-check
allowlist* below for the matching rules and for what a listed origin gives away.

## DNS before first public visit

Create this DNS record at the authoritative DNS provider:

```text
Type: A
Name: @
Value: 138.201.172.158
```

Cloudflare proxying may be enabled after the record exists. Use SSL/TLS mode
`Full (strict)`. Caddy will obtain the certificate automatically once public
DNS resolves to the server. A `www` record and alias can be added later.

**Publish the record before the first deploy.** The public smoke test at the end
of the deploy now fails when the hostname does not resolve, instead of reporting
a pass — see *Public smoke test* below.

## Public smoke test

The last step of a deploy is the only one that looks at the deployment the way a
customer's browser does, so it runs `deploy/public-smoke.sh` **from the GitHub
runner**, not over SSH. A check that curls the site from the machine that serves
it cannot see a DNS record that was never published, a certificate that was never
issued, or a proxy in front refusing traffic.

It fails, non-zero, on any of:

- the hostname does not resolve;
- the certificate cannot be verified — there is no `--insecure` anywhere in the
  script, and curl's own `ssl_verify_result` is asserted as well;
- the request ends anywhere but `https://` (a redirect off TLS);
- `/api/health` is not 200 with `"status":"ok"`;
- `/api/health/ready` is not 200 with `"status":"ready"` — the readiness contract,
  so a deployment whose API cannot reach PostgreSQL fails here;
- `/` is not the FluxRadar document, or is served without the
  `Strict-Transport-Security` **or** `Content-Security-Policy` header
  `deploy/Caddyfile` is responsible for. The policy is what keeps the paid
  checkout working and inline script out, and it is set in one file and read by
  nobody afterwards, so a Caddyfile edit could drop it while every other check
  still passed.

The previous version did none of this: it ran `curl --insecure`, asserted nothing
about the status or the body, and exited **0** when the hostname did not resolve
at all. `DEPLOY-007` runs the script against a real TLS server for every one of
those cases, including the self-signed certificate that must fail.

The loopback check earlier in the deploy (`--resolve fluxradar.net:443:127.0.0.1`)
is a different thing and deliberately still ignores the certificate: it asks only
whether Caddy on this host routes `/api/*` to the new container, and it runs while
ACME may still be issuing on a fresh server. The certificate is the public check's
job, which is where a wrong or expired one is actually visible.

## Continuous integration

The quality gates live in **one** place, `.github/workflows/quality.yml`, and are
called twice: by `ci.yml` on every pull request, and by `deploy.yml` on `main`
before it touches the server — so a red test never reaches production, and the
merge gate and the release gate cannot drift apart the way two copies had.

They are separate jobs rather than one list of steps, because one job gives one
verdict: a lint error in the web app used to hide every backend test result
behind it, and a run took as long as the sum of parts that mostly do not depend
on each other.

| Job | Needs | Notes |
| --- | --- | --- |
| `build-backend` | — | Builds `packages/*` and the API, and publishes the `workspace-dist` artifact. |
| `build-frontend` | — | `vite build`, so a broken web build is not found at deploy time. |
| `lint-backend` | — | `eslint .` minus `apps/web` and `e2e`. |
| `lint-frontend` | — | `eslint apps/web e2e`. |
| `typecheck-backend` | `build-backend` | |
| `typecheck-frontend` | — | The web app has no workspace dependency, so it waits for nothing. |
| `test-backend` | `build-backend` | The only job that needs the PostgreSQL service. |
| `test-packages` | `build-backend` | |
| `test-frontend` | — | No database, no compiled workspace. |
| `images` | — | Both Dockerfiles, on pull requests only. |

The two lint jobs are defined as a partition — the backend job is *everything the
frontend job does not take* — so splitting the lint in two cannot quietly leave a
directory unlinted by either half. `DEPLOY-017` holds the two lists to each
other, and runs the `remote-upload` action and the manual rollback workflow the
same way the other deploy tests run their scripts.

The workspace packages resolve through their `exports` to `dist/index.js`, which
is the whole reason `build-backend` exists as a job: everything that imports one
downloads that single build instead of compiling its own, so every gate tests the
same output.

`ci.yml` deliberately does **not** run on a push to `main`. The same gates run
inside the deploy for that commit, and running both meant paying for two full
test suites to learn the same thing twice. The advisory job below keeps a weekly
schedule of its own for the same reason it exists at all.

A second CI job, **Dependency advisories**, checks the packages against the
public advisory database:

- `pnpm audit --prod --audit-level high` is **blocking** — those are the packages
  that end up inside the deployed images;
- the same audit over build and test dependencies runs with `continue-on-error`,
  because blocking on a `vitest` advisory would stop the very pull request that
  fixes it from merging.

It is deliberately **not** part of `deploy.yml`. An advisory is published against
code that is already merged and already running, so gating the deploy on it would
block the hotfix. It gates the merge instead — on every pull request, and weekly
on a schedule, because an advisory against code nobody has touched would
otherwise never be seen. It needs no secret and no production credential — and it proves nothing about a vulnerability nobody has
reported yet. There is no container image scanning and no runtime monitoring in
this repository; both are still manual (see *What is not automated*).

#### Accepted advisories

`pnpm.auditConfig.ignoreGhsas` in the root `package.json` is the only way an
advisory is allowed to stay. Every entry needs a row here saying what it is and
why the fix is worse than the finding; `DEPLOY-009` fails when an id is ignored
without one, so an exception cannot be added quietly.

| Advisory | Package | Why it is accepted |
| --- | --- | --- |
| [`GHSA-ggr8-5vv4-36mx`](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) | `deepmerge-ts <8.0.0`, reached only through `@prisma/client → prisma → @prisma/config` | Stack exhaustion while merging a recursive object graph. The only graph `@prisma/config` merges is the Prisma configuration file, which is in this repository and authored by us — no request, payload or customer input reaches it, so there is nothing for an attacker to recurse. `@prisma/config@6.19.3` pins `deepmerge-ts` to exactly `7.1.5`, and no stable Prisma release moves off it, so removing this would mean forcing a **major** override into the CLI that runs `prisma migrate deploy` on every deploy. Breaking migrations to fix an unreachable stack overflow is the worse trade. **Review on every Prisma upgrade** and drop the entry the moment a release ships `deepmerge-ts >= 8`. |

`DEPLOY-009` (`apps/api/src/deploy/deploy-009-ci-security-checks.test.ts`) keeps
the workflows honest: every one of them must declare explicit least-privilege
`permissions`, none may run on `pull_request_target`, the deploy and the backup
verification must agree on the SSH secret names, and every `secrets.*` / `vars.*`
name a workflow reads must appear in **this document** — GitHub resolves an
undefined secret to the empty string and `upsert_env` skips empty values, so a
typo or a rename is silent everywhere else.

### What is not automated

Stated plainly so nothing here is mistaken for a control that exists:

- **Container image scanning** — no workflow scans the built images for OS-level
  vulnerabilities. The base images (`node:24-bookworm-slim`, `nginx:1.27-alpine`,
  `postgres:17-alpine`, `caddy:2.10-alpine`) are pinned and must be bumped by
  hand.
- **An image registry** — there is none, so every deploy rebuilds both images
  from scratch, `docker save`s them and `scp`s the tar to the server. The API
  image carries the whole workspace and its `node_modules`, which is larger than
  this repository's entire GitHub artifact allowance; that is why the build and
  the upload are one stage each rather than a build stage handing an artifact to
  an upload stage. A registry would make them separate, make the upload
  incremental, and make a rollback to an evicted release possible — at the cost
  of a `packages: write` permission that `DEPLOY-009` currently forbids outright,
  and a pull credential on the server.
- **Uptime and error monitoring** — there is none. Nothing pages anyone when the
  site goes down between deploys; the only automated outside-in check is the
  public smoke test at the end of a deploy, and the nightly backup verification.
- **Log aggregation** — container logs live on the one server and are read with
  `docker logs`.
- **Secret rotation** — manual, and `INTEGRATION_ENCRYPTION_KEY` has consequences
  when rotated (see above).

## Billing gate

Paid audits are sold through FastSpring. `docs/FASTSPRING.md` is the full
reference — exact environment variables, the webhook URL, the required events,
test/live switching, and the values that must come from the FastSpring account
owner. The short version:

- Leave **every** `FASTSPRING_*` variable empty and paid checkout simply stays
  off: the API boots, `/billing/checkout-config` reports `available: false`, and
  the UI offers only the free homepage check.
- Setting **some** of them fails the production boot with the missing variable
  names (never their values). This is deliberate: a half-configured provider
  would accept webhooks it cannot verify.
- Which variables are missing is an operator's business and appears only in the
  API log — at startup (`paid checkout disabled: provider is only partially
  configured`, with a `missing` list of names) and again on each refused request.
  The browser-facing `/billing/checkout-config` and the 503 from
  `/billing/checkout-session` answer with the closed codes `not_configured` /
  `misconfigured` and never name a variable: the buyer cannot act on it, and it
  would hand anyone probing the checkout a map of how this deployment is wired.
  A startup log line also states the mode when checkout **is** configured, so
  "paid checkout is off" is never a silent state.
- The production webhook URL is `https://fluxradar.net/api/webhooks/fastspring`,
  and the required events are `order.completed`, `return.created` and
  `chargeback.created`.
- `FASTSPRING_MODE` (`test` / `live`) must match the storefront host in
  `FASTSPRING_STOREFRONT_URL`. A test-mode order can never grant access on a
  live deployment.

`/billing/dev-checkout` refuses every account that is not internal, in every
environment: a signed FastSpring order is the only thing that creates a purchase.
An exact, comma-separated `FLUXRADAR_INTERNAL_FREE_EMAILS` allowlist may be
supplied in the private production environment file for internal testing.
Matching accounts can create Basic/Complete scans without a payment; those scans
deliberately do not create Purchase or Entitlement records. Keep the allowlist
limited to team accounts because the scan still consumes server and AI
resources.

### Free-check allowlist

The free homepage check is limited twice: once per account, and once per domain
for everyone (a global claim row that survives account deletion). Both limits get
in the way of the sites this deployment runs itself — the demo site, the
marketing site, a customer site being reproduced during support.

`FLUXRADAR_FREE_CHECK_ALLOWED_ORIGINS` is the exception. It is an exact,
comma-separated list of **https origins** —
`https://demo.example.com,https://fluxradar.net`. Set it either in
`PRODUCTION_ENV_FILE`, or through the optional GitHub `production` **variable**
`PRODUCTION_FREE_CHECK_ALLOWED_ORIGINS`, which overrides the base file when it is
non-empty and is skipped when empty, like every other optional override. It is a
variable and deliberately **not** a secret: an https origin is printed on the
site it names, so hiding it buys nothing, while keeping it out of
`PRODUCTION_ENV_FILE` means the list can be corrected — a demo domain added, a
customer's site removed after support is over — without rewriting a base env file
nobody can read back. Rules worth knowing before adding one:

- Exact match only, on the normalized origin (host lowercased, default port and a
  trailing `/` removed). There are **no wildcards**: `https://example.com` does
  not cover `https://www.example.com`, which is a different site.
- A listed origin skips both limits. The account's one-time flag is not spent and
  no global claim row is written, so the check can be re-run from any account, as
  often as needed.
- Entries that are not an https origin (a bare host, an `http://` URL, anything
  with a path) are ignored and logged at startup by value — `free-check allowlist
  entries ignored: not an https origin`. The active list is logged too.
- Unset or empty is the normal state: every account keeps its one free check, and
  every domain keeps its global claim.

Keep the list to origins this team controls. A listed origin is unlimited free
scanning for anyone who registers and adds that domain as a profile.

### Content Security Policy

`deploy/Caddyfile` is `default-src 'self'` with three deliberate exceptions, all
of them for FastSpring's popup checkout:

| Directive | Addition | Why |
| --- | --- | --- |
| `script-src` | `https://sbl.onfastspring.com` | The Store Builder Library the browser loads to open the popup. Pinned to one version in `apps/web/src/fastspring-sbl.ts`. |
| `frame-src` | `https://*.onfastspring.com` | The checkout itself renders in a FastSpring iframe over our page. |
| `connect-src` | `https://*.onfastspring.com` | The library talks to the storefront from our page while the checkout is open. |

`frame-ancestors 'none'` is unchanged: FluxRadar still may not be framed by
anyone. No inline script is allowed, and nothing else was widened.

Removing any of the three breaks paid checkout in a way that is visible to the
buyer but not to the server: the popup does not open, the browser console carries
the CSP violation, and the UI says the checkout could not be loaded and offers
the hosted page as a link. If a deployment runs `FASTSPRING_SESSION_API=v1` (no
popup checkout), none of the three is needed — the hosted page opens in a tab.

That sentence used to be the whole safety net. Three things now check it:

- **`DEPLOY-008`** (`apps/api/src/deploy/deploy-008-security-headers.test.ts`)
  reads `deploy/Caddyfile` and asserts the whole header set, that `script-src`
  carries no `'unsafe-inline'`, `'unsafe-eval'` or wildcard, and that the
  FastSpring exceptions are **exactly** the origins the code uses — `script-src`
  against `SBL_ORIGIN` in `apps/web/src/fastspring-sbl.ts`, `frame-src` and
  `connect-src` against the storefront domain
  `apps/api/src/billing/fastspring/popup-storefront.ts` validates. Bumping the
  SBL origin without the Caddyfile now fails CI instead of the checkout.
- **The web container repeats the same headers** (`deploy/nginx.conf`), so a
  document served straight off it still carries them. Caddy's `header` directive
  *sets* a field, so on the public path the browser sees one of each; DEPLOY-008
  requires the two policies to be byte-identical, which makes the duplication
  safe either way.
- **`deploy/public-smoke.sh` asserts the header reaches the browser**, from the
  GitHub runner, as the last gate of every deploy — alongside HSTS.

A fourth check sits on the other side of the policy: `apps/web/src/inline-script-policy.test.ts`
asserts that no document FluxRadar serves — the SPA shell or any static blog page
— carries an inline `<script>`, an `on…=` handler, a `javascript:` URL or an
off-origin asset. `vite dev` and `vite preview` serve these pages with **no**
policy, so an inline script added to an article works everywhere except
production, where the browser silently refuses to run it. (`<script
type="application/ld+json">` is a data block, not a script, and is allowed.)

## Database backup and restore

One server, one PostgreSQL volume. Everything a customer has paid for lives in
it, and until this section existed nothing copied it anywhere else. The scripts
are in [`deploy/backup/`](../deploy/backup/README.md); this is what they do and
what an operator has to set up once.

### What runs, and when

| When | What | Touches the live database |
| ---- | ---- | ------------------------- |
| 02:17 UTC daily (cron) | `pg-backup.sh` — dump, encrypt, upload, prune | reads it with `pg_dump` |
| 03:30 UTC Sunday (cron) | `pg-restore.sh --verify-latest` | no — restores into a throwaway database |
| 04:20 UTC daily (GitHub Actions) | `backup-verify` workflow, the same verification over SSH | no |
| Every deploy that adds a migration | the `backup` stage of `deploy.yml`, running the same `pg-backup.sh` | reads it with `pg_dump` |
| Every deploy | `check-backup-config.sh` on the env file the `package` stage ships | no |

### Whether a release can be backed up at all

Production once ran for two weeks with `FLUXRADAR_BACKUP_ENCRYPTION_KEY` set
nowhere: `pg-backup.sh` refused to run every night, `backup-verify` failed every
night, and every deploy in that time went green, because nothing in the deploy
asked. The `package` stage now runs `deploy/backup/check-backup-config.sh` on the
env file it is about to ship, and when anything a backup needs is missing — the
encryption key, `POSTGRES_DB`/`POSTGRES_USER`, any `HETZNER_S3_*` — the run
carries a **"Production cannot be backed up"** warning naming the variables
(names only, never values).

It warns rather than blocks: a deploy gated on the backup configuration would
also block the fix for whatever else is wrong in production. The list it checks
is compared with `pg-backup.sh` and `backup-cli.cjs` by `DEPLOY-016`, so a
variable added to either cannot go unchecked.

### The snapshot before a migration

`prisma migrate deploy` runs in the `release` stage and **cannot be undone**.
Everything else the deploy does about rollback is about the *code*: the
compatibility gate proves the previous release can still read the migrated
schema, and `rollback-release.sh` puts that release back in front of traffic.
None of it restores a column a migration dropped or a value it rewrote. For that
the only answer is a dump, and the newest scheduled one can be up to 26 hours old
(*Freshness*, below).

So the `backup` stage takes one, from the release that is still running,
immediately before the schema changes under it
(`deploy/backup/pre-migration-snapshot.sh`). It is skipped **only when both
releases' migration directories were listed successfully and the new one adds
nothing** — a deploy that changes no migration runs nothing, which keeps the
common case as fast as it was. The comparison is by directory name, so a
migration edited in place after it has been applied is not detected (nor should
it be: Prisma refuses that anyway).

**When in doubt, it snapshots.** A release without its migrations directory, an
active release without one, a listing or a comparison that fails — each means
"cannot tell what this release will migrate", and the answer to that is the
snapshot, never "no snapshot needed". The first, inline version got this
backwards: `comm … || true` over listings nothing checked, so any error there
read as "no new migrations". `DEPLOY-015` runs the script through every one of
those cases, and each fails if the gate is made to fail open again.

A failure here **stops the deploy**, with the previous release still serving and
the schema untouched. That is the point: the alternative is applying an
irreversible migration with a safety net nobody checked. The same applies when
the active release predates the backup tooling and has no `pg-backup.sh`.

`ALLOW_MIGRATION_WITHOUT_BACKUP` is the escape hatch. Set the
repository/environment variable to `true` to downgrade that failure to a loud
warning, on the day that trade is knowingly the right one — an empty database, a
snapshot taken by hand minutes earlier, an outage where the migration *is* the
fix. Anything other than `true` keeps the gate. Unset it again afterwards: it
turns off the one control that stands between a bad migration and a day of lost
customer data.

`pg_dump` runs **inside the running PostgreSQL container**, so the dump is always
taken by the exact server version that wrote the data and the host needs no
PostgreSQL packages. The dump is written to `$APP_DIR/backups/work`, encrypted
there, uploaded, and the plaintext is deleted on every exit path.

### Encryption

Every archive is AES-256-GCM before it leaves the work directory
(`deploy/backup/archive-crypto.cjs`, format `FRBK1`). The bucket only ever holds
ciphertext, so an S3 credential leak is not a database leak, and GCM's
authentication tag means a truncated or altered archive fails to decrypt instead
of restoring into plausible corruption.

The key is `FLUXRADAR_BACKUP_ENCRYPTION_KEY`, 32 bytes base64:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

It is deliberately **not** the object-storage credential: rotating one must not
force the other. Keep it in the password manager *and* in the GitHub secret
`PRODUCTION_BACKUP_ENCRYPTION_KEY`. **A snapshot taken with a key that is later
lost is unrecoverable** — when rotating, keep the previous key until every
snapshot encrypted with it has aged out of retention.

Alongside each archive is a plaintext `.meta.json` sidecar holding sizes and the
SHA-256 of the *plaintext* dump. It carries no credential and no customer data,
and it is what lets a restore prove it reconstructed the exact bytes that were
dumped — including when the key itself is what is being recovered.

Because both the age check and the checksum check read that sidecar, only one
reason for its absence is accepted: a `404`, which is a snapshot older than
sidecars. A bucket that answers `403` or `5xx` for it, or a sidecar that is not
readable JSON, **fails** the command — silently continuing there would drop the
checksum verification and fall back to a timestamp taken from the object's own
name.

### Retention

`deploy/backup/retention-policy.cjs` is a pure planner and every rule in it exists
because the failure mode of a retention sweep is "the backups are gone":

- only keys this tool wrote (`fluxradar-<UTC timestamp>.dump.enc`) are candidates;
  anything else in the bucket is invisible to it and can never be deleted;
- the newest `FLUXRADAR_BACKUP_MIN_KEEP` (default 7) snapshots survive regardless
  of age;
- everything past `FLUXRADAR_BACKUP_RETENTION_DAYS` (default 30) is expired;
- at most `FLUXRADAR_BACKUP_MAX_DELETE` (default 50) snapshots go per run;
- **nothing is pruned at all** while the newest snapshot is older than
  `FLUXRADAR_BACKUP_STALE_HOURS` (default 48). A stale newest snapshot means
  backups are failing, and pruning then would finish what the failure started.

### Freshness

Retention refusing to prune is a safety valve, not an alarm: it is silent, and it
is deliberately generous. The alarm is `FLUXRADAR_BACKUP_MAX_AGE_HOURS`
(default 26 — one daily cycle plus slack, and deliberately below the 48-hour
retention threshold so it fires first).

`pg-restore.sh --verify-latest` — the nightly `backup-verify` workflow and the
weekly cron — **fails** when the newest snapshot is older than that. It is the
only check that can: a backup job that stopped two weeks ago leaves a snapshot
that still decrypts, still matches its checksum and still restores perfectly, so
nothing except its age says the backups have stopped.

The age is taken from the snapshot key and, when the metadata sidecar states a
`takenAt`, from the sidecar too — **the older of the two wins**, because a job
that re-uploads an old dump under a fresh key would otherwise look brand new. A
snapshot timestamped in the future is refused rather than treated as fresh, and a
sidecar with an unusable `takenAt` is reported and the key is used instead.

Two paths are deliberately NOT age-gated, and both are an operator naming what
they want:

- `--key <s3 key>` (including the `snapshot_key` input of the `backup-verify`
  workflow) — one specific object was asked for;
- `--target-database …` (the destructive disaster-recovery restore, which passes
  `--allow-stale` to the CLI). On the day it is needed, the only backup that
  exists may well be older than the alarm, and refusing to restore it would be
  the alarm causing the outage it warns about.

### Restoring

`pg-restore.sh` verifies by default and destroys only when told to, four times
over. The verification path is the one a schedule runs against production:

```sh
/opt/fluxradar/current/deploy/backup/pg-restore.sh --verify-latest
```

It downloads the newest snapshot, refuses it if it is older than
`FLUXRADAR_BACKUP_MAX_AGE_HOURS`, decrypts it, checks it against the sidecar
checksum, creates `fluxradar_verify_<timestamp>` beside the live database,
restores into it, asserts the schema is there, that every recorded migration
finished and that `Account` can be read, then drops the throwaway database again.
The live database is never read from, written to or dropped. Add `--keep` to
inspect the result, `--key <s3 key>` for a specific snapshot, `--dry-run` to
decrypt without touching any database.

**A real disaster recovery** is deliberately not a single command. In order:

```sh
# 1. Stop the API so nothing writes while the database is being replaced.
docker stop "$(docker ps --filter 'name=fluxradar-api-' -q)"

# 2. Recreate the database EMPTY. This is the destructive step, and it is done by
#    hand, at the prompt, on purpose — no script in this repository drops the
#    live database.
PG="$(docker ps --filter 'label=com.docker.compose.service=postgres' -q)"
docker exec -i "$PG" dropdb --username fluxradar --force fluxradar
docker exec -i "$PG" createdb --username fluxradar fluxradar

# 3. Restore into it. The script refuses unless all of this is true: the flag is
#    present, the variable names the database by hand, no API container is
#    running, and the target is empty.
FLUXRADAR_RESTORE_ALLOW_PRODUCTION=overwrite-fluxradar \
  /opt/fluxradar/current/deploy/backup/pg-restore.sh \
  --target-database fluxradar --i-know-this-destroys-data

# 4. Start the API again and confirm from outside the server.
docker start "<the api container>"
bash deploy/public-smoke.sh --host fluxradar.net
```

### Manual setup (one time, by an operator)

Nothing below can be done by a deploy, and until it is done there are no backups:

1. Create the GitHub `production` secret `PRODUCTION_BACKUP_ENCRYPTION_KEY` with
   a fresh 32-byte base64 key, and store the same key in the password manager.
   Optionally set the `PRODUCTION_BACKUP_*` repository variables to override the
   prefix and the retention numbers.
2. Deploy once, so `.env.production` on the server carries the key.
3. Install the schedule as root. The log directory is created first, because
   cron opens the log file *before* running the script and a missing directory
   would make the job fail without ever starting:
   ```sh
   install -m 0700 -o fluxradar -g fluxradar -d /opt/fluxradar/backups
   install -m 0644 -o root -g root \
     /opt/fluxradar/current/deploy/backup/fluxradar-backup.cron \
     /etc/cron.d/fluxradar-backup
   ```
   Edit the user in that file if the deploy account is not `fluxradar`, and point
   `MAILTO` at an address a human reads.
4. Prove it end to end, from the server, before trusting it:
   ```sh
   /opt/fluxradar/current/deploy/backup/pg-backup.sh --dry-run
   /opt/fluxradar/current/deploy/backup/pg-backup.sh
   /opt/fluxradar/current/deploy/backup/pg-restore.sh --verify-latest
   ```

The bucket is the same Hetzner Object Storage the application uses
(`HETZNER_S3_*`). A separate bucket, or a bucket with object-lock, is the next
step up and needs no code change — only different values.

Every deploy says where that setup stands, because nothing else does:
`deploy/normalize-env-file.cjs` warns when none of the backup variables is set
("No database backup is configured") and when only some are — step 2 above is
exactly that intermediate state, so neither blocks a deploy. A policy number
that is *present and unusable* does block it: a non-numeric value, or a
`FLUXRADAR_BACKUP_MAX_AGE_HOURS` / `FLUXRADAR_BACKUP_MIN_KEEP` of 0, which no
snapshot can satisfy. The same limits are re-checked by the backup CLI when it
reads its configuration, so a hand-edited `.env.production` on the server fails
the next backup run instead of a later restore.

`DEPLOY-004` and `DEPLOY-005` run all of this in CI against a stub bucket and a
recorded `docker`, including every refusal on the destructive path.

## The deploy, stage by stage

`deploy.yml` is a chain of jobs, not one long step, so a red run says *which*
phase failed and the two image builds that dominate its wall clock happen at the
same time.

| Stage | Needs | What it does | Can it break production? |
| --- | --- | --- | --- |
| `quality` | — | `quality.yml`, without the image build | No |
| `preflight` | `quality` | Reclaims this workflow's own stale staging dirs under `incoming/` | No |
| `image` | `preflight` | A matrix (`api`, `web`): builds, saves, ships and `docker load`s each image, in parallel | No |
| `package` | `preflight` | Builds the release archive and the env file, uploads both, extracts into `releases/<commit>` | No |
| `backup` | `image`, `package` | Snapshots the database **if** this release adds migrations | No |
| `release` | `backup` | Runs `deploy/release.sh` from the new release directory: migrates, proves a rollback is possible, starts the containers, switches traffic | Yes, from the switch onwards |
| `verify` | `release` | `deploy/verify-release.sh`: the public smoke test, and the rollback when it fails | It undoes one |
| `recover` | `release`, `verify` | Runs `verify-release.sh` again when the release is live and `verify` did not finish green | It undoes one |

Everything up to and including `backup` leaves the previous release serving and
untouched; a failure there is a workflow that went red and a production that
never noticed. `release` is where that stops being true, and it is the stage that
carries the rollback machinery described below.

**Why `recover` is conditioned the way it is.** A rollback is only correct once
traffic has been switched. A bare `if: failure()` cannot tell whether that
happened: after a failure that never reached production it would read
`runtime/rollback.env` — written by the *previous* deploy — and restore that
target over a release serving perfectly well. `needs.release.result == 'success'`
*can* tell, because the release script exits 0 only after the switch and every
check after it. So `recover` runs with

```yaml
if: always() && needs.release.result == 'success' && needs.verify.result != 'success'
```

— exactly when a release is live and its outside verification did not finish
green. That is the gap the staged pipeline opened: a job boundary now sits
between the traffic switch and the public smoke test, and a `verify` job that
failed *before* its smoke test ran (checkout, SSH setup, a lost runner), was
cancelled or timed out used to leave a switched, never-verified release in front
of traffic. `always()` is what keeps `recover` running on a cancellation, and the
release condition is what keeps that safe.

`recover` runs the same `deploy/verify-release.sh` as `verify`, and it asks the
site **first**: after a `verify` that already rolled back, the previous release
answers and nothing is touched. A rollback it does start is refused by
`rollback-release.sh` (exit `4`) when the live release is already the target.
`DEPLOY-012` runs the script and asserts the condition.

## Release rollback

The deploy workflow builds immutable API/web images in GitHub Actions, loads
them on Hetzner, keeps each extracted release under `releases/<commit>` and
updates `current` only after the new API passes the database-aware readiness
probe.

### Rolling back on purpose

A release that passed every check and turned out to be wrong an hour later is not
a failed rollout, and nothing in the deploy covers it. Run the **Roll back
production** workflow (`.github/workflows/rollback.yml`) from the Actions tab and
type `roll back production` to confirm. It runs `deploy/rollback-release.sh` —
the same script the deploy runs, from the release that is live — against the
target that release recorded before it switched traffic, and then re-checks
`fluxradar.net` from outside. It shares the `production-deploy` concurrency
group, so it can never run while a release is switching traffic underneath it.

It never invents a target: when `runtime/rollback.env` names no earlier release
the script changes nothing and the workflow fails loudly, because the answer then
is to deploy a known-good commit, not to tear down the only release there is.

**Pressing it twice does nothing the second time.** `runtime/rollback.env`
records one step back and no rollback rewrites it, so once a rollback has run —
by hand, or by a deploy that rolled itself back — the release that is live *is*
the recorded target. `rollback-release.sh` refuses that case before it touches
anything and exits `4` (*nothing to roll back*); the workflow says so, reports
whether the live release passes the public smoke test, and fails, because the
rollback that was asked for did not happen. Before this guard, the second run
removed the containers serving production and recreated them — up to a minute of
downtime reported as `ROLLBACK OK`. A redeploy of the commit that is already
live arrives at the same state, and both deploy-time callers report it the same
way. `DEPLOY-011` covers it.

| `rollback-release.sh` exit | Meaning |
| --- | --- |
| `0` | The target is serving again, proven by a readiness probe. |
| `1` | It tried and could not restore; production needs manual recovery. |
| `3` | There is no target (a first deploy); nothing was changed. |
| `4` | The release named as failed *is* the target; nothing was changed. |

### What a failed rollout does, exactly

There are three phases, and the contract is different in each. `DEPLOY-010`,
`DEPLOY-011` and `DEPLOY-012` run every one of them.

| Phase | What fails there | What happens |
| --- | --- | --- |
| Before the traffic switch | migration, rollback compatibility gate, readiness | The previous release never stops serving. The new containers are removed; nothing else is touched. |
| After the traffic switch, while the release script runs | Caddy, `caddy validate`, the loopback smoke, the `current` symlink | `deploy/rollback-release.sh` restores the previous release and the workflow fails. |
| After the release script exits — the public smoke test | DNS, certificate, the site as seen from outside | The same `deploy/rollback-release.sh` runs over SSH, the site is re-checked from the runner, and the workflow fails. |
| After the release script exits — `verify` never finished | `verify`'s own checkout or SSH setup, a lost runner, a cancellation, a timeout | `recover` runs the public smoke test; if it fails, the same rollback, and the workflow fails. |
| Either of those, on the **first** deploy of a host | anything post-switch | There is no earlier release, so the rollback changes **nothing** and reports `ROLLBACK IMPOSSIBLE`. The release that failed keeps serving — tearing it down would leave the host serving nothing — and the workflow fails with a CRITICAL line asking for manual action. |

Once the release is live and recorded, the retention sweep that trims old
releases is the only thing left. It never rolls anything back: a failure there
is reported and the release keeps serving.

The rollback is a script rather than a step so that all of it is the same
rollback, and it reports what it did:

- `ROLLBACK OK` (exit 0) — the previous release is serving again. This line is
  printed only after the restored release has ANSWERED: each restored container
  is asked its own readiness probe (`/health/ready` for the API, `/health` for
  web) and the public hostname is fetched through Caddy on `127.0.0.1`, with
  bounded retries. A rewritten Caddyfile is not evidence that anything serves.
- `ROLLBACK OK (DEGRADED)` (exit 0) — the previous release is serving and proven
  the same way, but its own release directory had been swept off disk, so the
  failed release's `docker-compose.yml` and `deploy/Caddyfile` were used.
  Restore the directory before the next deploy.
- `ROLLBACK IMPOSSIBLE` (exit 3) — there was no earlier release (a first
  deploy). **Nothing was changed**: the release that failed keeps its containers
  and its proxy configuration, because removing them would leave the host
  serving nothing at all. Deploy a working release; the workflow reports this as
  a CRITICAL needing manual action.
- `ROLLBACK FAILED` (exit 1) — it could not restore, including the case where
  Caddy was reconfigured but the restored upstreams never answered. Production
  needs the manual procedure below; `current` and `runtime/active.env` are left
  describing the release that was live.

It never exits 0 without one of the two OK lines, the deploy log never claims a
rollback it did not perform, and no non-zero exit is swallowed by either caller.

Two details of how it restores a release are deliberate:

- when the previous release's containers are gone — which is the normal state
  once the release script has finished — it recreates them from
  `fluxradar-api:<commit>` / `fluxradar-web:<commit>` and takes the upstream
  addresses from the containers that are running afterwards, never from the
  addresses recorded before, which a recreate invalidates;
- it starts them on the **failed release's** `.env.production`. That is the file
  the rollback compatibility gate already started this same image against,
  before any traffic moved, so it is the only environment the previous release
  is *proven* to boot and read the migrated database on.

### Rolling back by hand

To undo the release that is live now, run the same script the deploy runs. It
reads its target from `runtime/rollback.env`, which the deploy wrote before it
switched traffic:

```sh
APP_DIR=/opt/fluxradar
RELEASE_ID=<the release that is live now>
bash "$APP_DIR/releases/$RELEASE_ID/deploy/rollback-release.sh" \
  "$APP_DIR" "$APP_DIR/releases/$RELEASE_ID"
```

To go back to some *other* known-good commit whose image is still loaded, SSH to
the server and run the following. During a normal rollout the previous
containers remain available until the new smoke test passes; after success they
are removed, so this procedure recreates them only when needed:

```sh
APP_DIR=/opt/fluxradar
RELEASE_ID=<known-good-commit>
cd "$APP_DIR/releases/$RELEASE_ID"
API_CONTAINER="fluxradar-api-$RELEASE_ID"
WEB_CONTAINER="fluxradar-web-$RELEASE_ID"
if docker container inspect "$API_CONTAINER" >/dev/null 2>&1; then
  docker start "$API_CONTAINER"
else
  docker run -d --name "$API_CONTAINER" --restart unless-stopped \
    --network fluxradar_default --env-file .env.production \
    --env NODE_ENV=production --env PORT=3310 \
    --env FRONTEND_ORIGIN=https://fluxradar.net \
    "fluxradar-api:$RELEASE_ID"
fi
if docker container inspect "$WEB_CONTAINER" >/dev/null 2>&1; then
  docker start "$WEB_CONTAINER"
else
  docker run -d --name "$WEB_CONTAINER" --restart unless-stopped \
    --network fluxradar_default "fluxradar-web:$RELEASE_ID"
fi
awk -v api="$API_CONTAINER:3310" -v web="$WEB_CONTAINER:80" '{
  gsub(/\{\$FLUXRADAR_API_UPSTREAM\}/, api)
  gsub(/\{\$FLUXRADAR_WEB_UPSTREAM\}/, web)
  print
}' deploy/Caddyfile > "$APP_DIR/runtime/Caddyfile.next"
cat "$APP_DIR/runtime/Caddyfile.next" > "$APP_DIR/runtime/Caddyfile"
rm -f "$APP_DIR/runtime/Caddyfile.next"
CADDY_CONTAINER="$(docker compose --env-file .env.production -p fluxradar ps -q caddy)"
docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile
ln -sfn "$APP_DIR/releases/$RELEASE_ID" "$APP_DIR/current.next"
mv -Tf "$APP_DIR/current.next" "$APP_DIR/current"
cat > "$APP_DIR/runtime/active.env" <<STATE
FLUXRADAR_ACTIVE_RELEASE=$APP_DIR/releases/$RELEASE_ID
FLUXRADAR_API_UPSTREAM=$API_CONTAINER:3310
FLUXRADAR_WEB_UPSTREAM=$WEB_CONTAINER:80
FLUXRADAR_API_CONTAINER=$API_CONTAINER
FLUXRADAR_WEB_CONTAINER=$WEB_CONTAINER
STATE
chmod 600 "$APP_DIR/runtime/active.env"
```

The migration step runs before the traffic switch while the previous release
may still be serving requests. Keep production migrations additive and
expand/contract: defer column drops, renames and incompatible constraints to a
later release after all old containers are gone.

### The rollback compatibility gate

`prisma migrate deploy` runs before the new containers take traffic, and it cannot
be undone. Every remaining way the deploy can fail leaves the **previous** release
in front of traffic. So a migration that the previous release cannot survive does
not merely fail a deploy — it turns a failed deploy into a broken production, with
no automatic way back.

The workflow therefore proves compatibility instead of assuming it. Immediately
after `migrate deploy`, and before anything is switched, it starts the *previous*
release's own image as a throwaway container against the migrated database and the
new environment file, and requires **two** things of it.

**The probe container is read-only, and that is enforced by how it is started.**
It runs with `--entrypoint node` and an idle timer as its command, so the image's
production command never executes. This matters more than it sounds: that command
is a full API instance, and on boot and on timers it sweeps data retention
(deleting expired scans, reports and webhook rows), recovers and *claims* queued
scan jobs, drains the queue — real crawls, real AI calls, real customer email —
and sweeps pending refunds. All of that used to happen inside a verification
container that the deploy removed seconds later, against the live database, while
the release being deployed was doing the same work. A step that verifies
production must not be able to change it.

With nothing booted, the two checks are asked directly, by two scripts copied in
from the release being deployed and executed against the **old image's** modules:

1. **`deploy/rollback-readonly-probe.cjs` — would it start, and can it reach the
   database?** It calls the previous release's own boot-time validators
   (`validateRuntimeConfig`, `readFastSpringConfig`), which is what catches an
   environment variable it requires and the new release no longer does, and then runs `SELECT 1` inside a
   transaction it first marks `READ ONLY` — verifying the mark before it queries.
   A validator that this release's layout does not contain is skipped by name; a
   validator that is present and throws fails the deploy, and finding none at all
   fails it too (unable to verify is not verified).
2. **`deploy/rollback-schema-probe.cjs` — can it still read every model it knows
   about?** Reachability alone cannot answer this: `SELECT 1` succeeds against any
   reachable database, including one whose columns the old client no longer finds.
   This probe loads the old image's `@prisma/client` and its generated datamodel
   and issues one read-only `findFirst` per model. Prisma names every scalar
   column it knows about in those SELECTs, so a dropped or renamed column, or a
   removed table, fails with the old client's own error. It enumerates the whole
   datamodel rather than a fixed list, so it covers any future contract-phase
   migration, not only the billing tables.

If either check fails the deploy stops with production untouched, and the failing
variables or models are printed in the workflow log. `DEPLOY-006` extracts the
release script's own `docker run` lines and asserts the entrypoint override, and runs
the probe against a real database to prove it passes, fails closed, and writes
nothing.

**A missing rollback image fails the deploy.** If `current` points at a previous
release but its `fluxradar-api`/`fluxradar-web` image is no longer loaded on the
host, compatibility cannot be proven *and* a rollback could not recreate that
release, so the workflow stops rather than reporting that there is nothing to roll
back to. Restore the image with `docker load`, or — knowing that this deploy has no
verified rollback — set the repository/environment variable
`ALLOW_UNVERIFIED_ROLLBACK` to `true`, which downgrades it to a loud warning. On a
genuine first deploy (no `current` symlink at all) there is no rollback target and
the gate is skipped.

"Genuine first deploy" is decided by whether `$APP_DIR/current` **exists**, not by
what `readlink -f` prints: GNU `readlink -f` resolves a path whose last component
is missing, so a first deploy used to yield the rollback target `current` and abort
looking for the image `fluxradar-api:current`. Anything that exists — a live
symlink, a dangling one, even a plain directory — counts as a rollback target and
keeps the gate running (fail closed). `DEPLOY-001` extracts those exact lines from
`deploy/release.sh` and runs them against both GNU and BSD `readlink`.

Two rules follow, and `BILLING-007` enforces the first one in CI:

1. **Migrations stay additive.** No `RENAME COLUMN`, `DROP COLUMN`, `DROP TABLE`,
   `DROP INDEX`, `DROP CONSTRAINT`, and no `SET NOT NULL` on a column the same
   migration did not add. A migration that genuinely must be destructive declares
   `-- fluxradar:contract-phase` in its header, and may only ship once no container
   of any release that reads the old shape can be started again. `BILLING-007` also
   runs the schema-surface probe against a throwaway migrated database — once with
   a column dropped, once with a table dropped — so the gate itself is covered.

   **A new table needs `ON DELETE CASCADE` from the parents an older release
   deletes.** The old release cannot clear rows in a table it does not know about,
   so a `RESTRICT` foreign key (Prisma's default) makes its account deletion fail
   after a rollback. `CheckoutSession` cascades from `Account` and `SiteProfile`
   for exactly this reason.
2. **Do not remove a variable the previous release still requires** from
   `PRODUCTION_ENV_FILE` in the same deploy that stops requiring it.

**`20260906180000_fastspring_provider_neutral_billing`** is the expand phase of
exactly such a change. It adds the provider-neutral billing columns beside the
`paddle*` ones, backfills them, and installs `BEFORE INSERT OR UPDATE` triggers
that mirror the two id families into each other — so a row written by either
release is readable by both, in both directions. Nothing is renamed or dropped, and
`down.sql` beside the migration reverses it manually if the work is abandoned (it
must never run during an automatic rollback).

**`20260906190000_fastspring_trigger_update_sync`** completes it. The original
trigger bodies mirrored each column pair with `COALESCE`, which fills whichever
side an INSERT omitted but does nothing on an UPDATE, where both columns already
hold a value — so a statement that rewrote one id left the other reading the old
one and the two families diverged. The replacement mirrors the side the statement
actually changed (the provider-neutral column wins a tie) and keeps the INSERT
behaviour. It only runs `CREATE OR REPLACE FUNCTION`, so it adds no object the
contract phase below does not already drop.

Its **contract phase** ships later, as its own migration marked
`-- fluxradar:contract-phase`, once the FastSpring release has been stable long
enough that no earlier release can come back:

```sql
-- fluxradar:contract-phase — only after no release reading paddle* can return.
DROP TRIGGER "Purchase_sync_provider_ids" ON "Purchase";
DROP TRIGGER "WebhookEvent_sync_provider_ids" ON "WebhookEvent";
DROP TRIGGER "RefundRecord_sync_provider_ids" ON "RefundRecord";
DROP FUNCTION "fluxradar_sync_purchase_ids"();
DROP FUNCTION "fluxradar_sync_webhook_event_ids"();
DROP FUNCTION "fluxradar_sync_refund_record_ids"();
DROP INDEX "Purchase_paddleTransactionId_key";
DROP INDEX "WebhookEvent_paddleEventId_key";
DROP INDEX "WebhookEvent_paddleTransactionId_idx";
ALTER TABLE "Purchase" DROP COLUMN "paddleTransactionId";
ALTER TABLE "WebhookEvent" DROP COLUMN "paddleEventId", DROP COLUMN "paddleTransactionId";
ALTER TABLE "RefundRecord"
  DROP COLUMN "paddleTransactionId", DROP COLUMN "paddleEventId", DROP COLUMN "paddleSignature";
```

The rollback probe runs the *previous* release's Prisma client, so this can only
ship after a release whose client no longer selects these columns. That release
is D-229: it removed the `paddle*` fields from `schema.prisma` (the columns stay,
filled by their triggers) and every other trace of Paddle from the code. The
probe checks only the previous release, but the workflow keeps **two** rollback
candidates, and a manual rollback to one that still selects these columns would
fail. So ship the contract phase once both retained candidates are D-229 or
later — one ordinary release after D-229 is enough. It also removes the
`paddle*` index names `billing/prisma-errors.ts` still recognises, the trigger
tests in `BILLING-007`, and the `'paddle'` default of the three `provider`
columns.

Keep the previous release until the replacement has passed the internal and
public smoke tests. The workflow retains the active release and two rollback
candidates, then removes older release directories and their tagged images.
