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
and `FLUXRADAR_ENV_FILE=.env.production`.

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
