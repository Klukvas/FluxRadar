# FluxRadar integrations

## Current release scope

The current implementation includes the following integration surface:

| Integration | Type | Current behavior |
|---|---|---|
| Google Search Console | User OAuth | OAuth connection, encrypted token storage and connection status. Read-only scopes only. |
| Google Analytics 4 | User OAuth | Uses the same Google authorization connection as Search Console. Read-only scopes only. |
| Bing Webmaster Tools | User OAuth | OAuth connection, encrypted token storage and connection status. `webmaster.read` only. |
| PageSpeed Insights | Platform API | Optional PageSpeed API key; the Complete Performance module stores a normalized lab snapshot. |
| Chrome UX Report (CrUX) | Platform API | Optional CrUX API key; field Core Web Vitals are merged into the Performance snapshot. |
| Anthropic | Platform API | Real Messages API adapter when `ANTHROPIC_API_KEY` is configured; deterministic mock fallback for local development. |
| Hetzner Object Storage | Platform S3 | Complete JSON/CSV exports are archived as private tenant-scoped objects when S3 configuration is present. |

Google and Bing OAuth state is one-time, expires after ten minutes and is stored only as a SHA-256 hash. Access and refresh tokens are encrypted before they reach PostgreSQL. The UI never receives the raw tokens.

## Server configuration

Copy `.env.example` and configure only the services enabled for the environment:

```text
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=https://api.example.com/integrations/google/callback
BING_OAUTH_CLIENT_ID=
BING_OAUTH_CLIENT_SECRET=
BING_OAUTH_REDIRECT_URI=https://api.example.com/integrations/bing/callback
ANTHROPIC_API_KEY=
PAGESPEED_API_KEY=
CRUX_API_KEY=
HETZNER_S3_ENDPOINT=
HETZNER_S3_REGION=
HETZNER_S3_BUCKET=
HETZNER_S3_ACCESS_KEY=
HETZNER_S3_SECRET_KEY=
INTEGRATION_ENCRYPTION_KEY=
```

`INTEGRATION_ENCRYPTION_KEY` must be set explicitly in production. The local fallback to `SESSION_SECRET` exists only to keep a fresh development checkout usable.

## User-facing flow

1. The user opens **Integrations** in an authenticated workspace.
2. FluxRadar redirects them to Google or Bing; the user approves read-only access.
3. The callback exchanges the authorization code and stores encrypted tokens.
4. The user can disconnect the provider; deleting the connection removes its stored tokens.
5. A public-site scan remains available without any user integration. External data is optional and must degrade to `Unavailable` rather than lower a score because a provider is absent.

## Deferred roadmap

Cloudflare and WordPress are deliberately excluded from the current implementation. They remain planned as separate read-only connections:

- Cloudflare: scoped read-only API token, never a dashboard password;
- WordPress: dedicated user plus revocable Application Password, never the main administrator password.

Google Drive is also not part of the current scope; report artifacts use the FluxLab Hetzner S3 bucket.
