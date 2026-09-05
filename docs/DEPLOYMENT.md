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
refuses to start in production only when `DATABASE_URL`,
`PADDLE_WEBHOOK_SECRET` or the dedicated `INTEGRATION_ENCRYPTION_KEY` is
missing; every other integration is optional.

Transactional email via Resend is optional until it is connected. If
`RESEND_API_KEY`/`RESEND_FROM_EMAIL` are absent (`RESEND_REPLY_TO` is always
optional), the API still boots, email-dependent flows stay safely disabled, and
they report a `not-configured` status instead of pretending a message was sent.

## Optional integration secrets

The base `PRODUCTION_ENV_FILE` above always wins unless a matching optional
secret is provided. To connect integrations one at a time without editing the
base file, define any of these separate `production` environment secrets. The
deploy workflow merges each non-empty value into the release env file (an unset
or empty secret is skipped and never adds a blank override; values are never
echoed to the workflow log):

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

The deployed application rejects `/billing/dev-checkout` in production for
ordinary accounts until live Paddle checkout is configured. An exact,
comma-separated `FLUXRADAR_INTERNAL_FREE_EMAILS` allowlist may be supplied in
the private production environment file for internal testing. Matching accounts
can create Basic/Complete scans without a payment; those scans deliberately do
not create Purchase or Entitlement records. Keep the allowlist limited to team
accounts because the scan still consumes server and AI resources.

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

Keep the previous release until the replacement has passed the internal and
public smoke tests. The workflow retains the active release and two rollback
candidates, then removes older release directories and their tagged images.
