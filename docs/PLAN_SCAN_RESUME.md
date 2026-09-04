# Scan resume and job recovery plan

## Goal

After a browser refresh, closing and reopening the scan URL, or a normal API
restart, a user must be able to find the same scan and see its current state.
The scan must remain owned by the authenticated account and must not be
re-created or charged a second time.

## Decisions

- Keep the persisted PostgreSQL `Scan` and `Job` records as the source of truth.
- Keep the existing one-second polling endpoint for progress. A refresh-safe
  resume flow is required before adding SSE/WebSockets; after reconnect, polling
  rehydrates the current server state without duplicate work.
- Use a deep link containing the scan ID and restore it only after normal
  authentication and tenant-scoped API authorization.
- Recover jobs left `Claimed` by a process that has stopped before draining the
  queue on API startup. The recovery must be atomic and must not reset retry
  counters or create another job.

## Implementation scope

1. **Frontend deep link and boot recovery**
   - Add a scan URL route that survives a hard refresh.
   - Navigate to that route after scan creation.
   - On boot, authenticate first, load the requested scan, and route active
     scans to progress and terminal scans to the report.
   - Preserve the existing loading, unauthorized, not-found and error states.

2. **Server-side active-scan recovery**
   - Expose or use an account-scoped way to find the latest active scan when a
     user returns without a scan URL.
   - Keep all scan reads scoped by `accountId`.
   - Do not bypass the existing billing, plan, or retention gates.

3. **Queue recovery**
   - Add a startup recovery step for stale `Claimed` jobs left by a previous
     API process, then run the existing pending-job drain.
   - Make recovery safe under concurrent startup and keep the existing atomic
     claim behavior.
   - Do not mark a running scan completed merely because the browser refreshed.

4. **Tests and verification**
   - Test refresh/deep-link parsing and active/terminal restoration.
   - Test account isolation for a scan ID.
   - Test that a claimed job is recovered once and can be processed.
   - Test that duplicate refreshes do not create a second scan or job.
   - Run lint, typecheck, build, unit/integration tests and production smoke
     checks without making real AI requests in test fixtures.

## Acceptance criteria

- Refreshing an active scan keeps the scan running on the server and returns the
  user to its progress screen.
- Refreshing after completion opens the persisted report.
- Opening another account's scan URL returns the existing safe not-found/auth
  behavior.
- A restart does not leave a previously claimed scan permanently stuck.
- No duplicate scan, job, purchase or entitlement is created during recovery.
- Existing free-check anti-abuse and paid billing behavior remain unchanged.

## Out of scope

- Real-time SSE/WebSocket transport.
- Changes to Paddle, pricing, or scan module behavior.
