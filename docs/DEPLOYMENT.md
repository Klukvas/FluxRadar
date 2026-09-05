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
committed to the repository. It must include `POSTGRES_DB`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `DATABASE_URL` pointing to the `postgres` compose service,
`FLUXRADAR_ENV_FILE=.env.production`, `INTEGRATION_ENCRYPTION_KEY`,
`RESEND_API_KEY` and `RESEND_FROM_EMAIL`. `RESEND_REPLY_TO` is optional.
The API refuses to start in production when the dedicated encryption key or
Resend sender configuration is missing.

The optional GitHub `production` environment variable
`FLUXRADAR_INTERNAL_FREE_EMAILS` is merged into that file by the deploy
workflow. Keep it as an exact comma-separated list for internal test accounts;
leave it unset when internal free access should be disabled.

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
