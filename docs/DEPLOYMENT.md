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

## Required GitHub environment

The `production` environment contains these secrets:

- `PRODUCTION_SSH_HOST`
- `PRODUCTION_SSH_USER`
- `PRODUCTION_SSH_PRIVATE_KEY`
- `PRODUCTION_SSH_KNOWN_HOSTS`
- `PRODUCTION_APP_DIR`
- `PRODUCTION_ENV_FILE`

The last secret is the complete production environment file and must never be
committed to the repository, and the deploy workflow never overwrites it
blindly. It must include `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`DATABASE_URL` pointing to the `postgres` compose service,
`FLUXRADAR_ENV_FILE=.env.production` and `INTEGRATION_ENCRYPTION_KEY`. The API
refuses to start in production when `DATABASE_URL` or the dedicated
`INTEGRATION_ENCRYPTION_KEY` is missing; every integration is optional, but none
of them may be *half* configured (see *Optional, but never half configured*).

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

PageSpeed, CrUX and Resend cannot fail the boot (Resend is reported as `invalid`
when only one half of the key/sender pair is present, but transactional email
stays optional). Their state is visible in the startup log instead.

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

### `PADDLE_WEBHOOK_SECRET`

`PADDLE_WEBHOOK_SECRET` is not required by *this* release: the MockPaddle webhook
is a development affordance and its route is not mounted in production. **Keep the
value in `PRODUCTION_ENV_FILE`** anyway — releases that predate this one read it
during startup, so removing it would turn a rollback into a crash loop. The
normalizer warns (by name) when it is absent, and the rollback probe described
under *Release rollback* fails the deploy if the previous release cannot boot
without it.

It may be removed from the environment only once **no release that requires it can
be started again** — concretely, in or after the same release that ships the
`paddle*` contract-phase migration described at the end of this document, when the
retained rollback candidates no longer include such a release.

Transactional email via Resend is optional until it is connected. If
`RESEND_API_KEY`/`RESEND_FROM_EMAIL` are absent (`RESEND_REPLY_TO` is always
optional), the API still boots, email-dependent flows stay safely disabled, and
they report a `not-configured` status instead of pretending a message was sent.

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
| `PRODUCTION_HETZNER_S3_ACCESS_KEY`        | `HETZNER_S3_ACCESS_KEY`    |
| `PRODUCTION_HETZNER_S3_SECRET_KEY`        | `HETZNER_S3_SECRET_KEY`    |
| `PRODUCTION_HETZNER_S3_ENDPOINT`         | `HETZNER_S3_ENDPOINT`      |
| `PRODUCTION_HETZNER_S3_REGION`           | `HETZNER_S3_REGION`        |
| `PRODUCTION_HETZNER_S3_BUCKET`            | `HETZNER_S3_BUCKET`        |

The model identifier is not a secret, so it is a production environment
**variable** rather than a secret: set `PRODUCTION_ANTHROPIC_MODEL` to override
`ANTHROPIC_MODEL`, or leave it unset to keep whatever `PRODUCTION_ENV_FILE`
defines. With neither present the API uses its own default,
`DEFAULT_ANTHROPIC_MODEL` in `apps/api/src/integrations/anthropic-config.ts` —
currently `claude-sonnet-5`, the model this release is written against. A base
env file left on a **retired** model identifier no longer needs a workflow
override to correct it: with `ANTHROPIC_API_KEY` present, the API refuses to boot
and names `ANTHROPIC_MODEL` (never its value).

FastSpring has no optional deploy secret yet: set the `FASTSPRING_*` block
directly in `PRODUCTION_ENV_FILE` when you are ready to connect payments.
`FASTSPRING_MODE=live` additionally requires `FASTSPRING_STORE_VERIFIED=verified`,
which may only be set after the FastSpring store itself has been checked — see
`docs/FASTSPRING.md` §3/§4. Without it the production boot fails on purpose.

`PRODUCTION_INTEGRATION_ENCRYPTION_KEY` upserts the same key the base file may
already define; supply it only when rotating or when the base file omits it.
Resend has no optional deploy secret — set `RESEND_API_KEY`/`RESEND_FROM_EMAIL`
directly in `PRODUCTION_ENV_FILE` when you are ready to connect email.

The optional GitHub `production` environment variable
`FLUXRADAR_INTERNAL_FREE_EMAILS` is merged into that file the same way. Keep it
as an exact comma-separated list for internal test accounts; leave it unset when
internal free access should be disabled.

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

The deployed application still rejects `/billing/dev-checkout` in production for
ordinary accounts, and the legacy `/webhooks/paddle` route is not mounted there
at all. An exact, comma-separated `FLUXRADAR_INTERNAL_FREE_EMAILS` allowlist may
be supplied in the private production environment file for internal testing.
Matching accounts can create Basic/Complete scans without a payment; those scans
deliberately do not create Purchase or Entitlement records. Keep the allowlist
limited to team accounts because the scan still consumes server and AI
resources.

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

## Release rollback

The deploy workflow builds immutable API/web images in GitHub Actions, loads
them on Hetzner, keeps each extracted release under `releases/<commit>` and
updates `current` only after the new API passes the database-aware readiness
probe. A failed rollout restores the previous images/release and switches the
symlink back automatically. For a manual rollback after the first blue-green
deployment, SSH to the server and run the following with the desired
known-good commit whose image is still loaded. During a normal rollout the
previous containers remain available until the new smoke test passes; after
success they are removed, so this procedure recreates them only when needed:

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
new environment file, and requires **two** things of it:

1. **`/health/ready` passes.** This runs the old release's real startup path, so it
   catches an environment variable it validates at boot but the new release no
   longer requires.
2. **Its own Prisma client can still read every model it knows about.** The
   readiness check alone cannot answer this — it is a `SELECT 1`, which succeeds
   against any reachable database, including one whose columns the old client no
   longer finds. `deploy/rollback-schema-probe.cjs` is copied into the running
   container and executed there, so it loads the **old image's** `@prisma/client`
   and its generated datamodel, then issues one read-only `findFirst` per model.
   Prisma names every scalar column it knows about in those SELECTs, so a dropped
   or renamed column, or a removed table, fails the probe with the old client's own
   error. It enumerates the whole datamodel rather than a fixed list, so it covers
   any future contract-phase migration, not only the billing tables.

If either check fails the deploy stops with production untouched, and the failing
models are printed in the workflow log.

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
the workflow and runs them against both GNU and BSD `readlink`.

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

The matching `paddle*` fields must be removed from `schema.prisma` in the same
release, and `PADDLE_WEBHOOK_SECRET` may be dropped from the environment then too.

Keep the previous release until the replacement has passed the internal and
public smoke tests. The workflow retains the active release and two rollback
candidates, then removes older release directories and their tagged images.
