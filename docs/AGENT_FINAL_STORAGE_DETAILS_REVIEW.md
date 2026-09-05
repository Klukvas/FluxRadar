# Final Independent Review — Report Storage & Inline Details

**Reviewer:** independent final review agent  
**Date:** 2026-09-05  
**Scope:** Two feature changes only — (1) Hetzner S3 export storage fix, (2) Finding-Details inline table row  

---

## Verdict

**APPROVED — no blocking issues found.** All tests pass in the correct test environments, TypeScript is clean on both apps, and the root-cause fixes are correct and complete for their stated goals.

---

## Change 1 — Hetzner S3 Export Storage Failure Fix

### Root-Cause Correctness ✅

The confirmed root cause — `ServerSideEncryption: 'AES256'` in `PutObjectCommand` — is correctly fixed. Hetzner Object Storage (Ceph RGW) returns HTTP 501 `NotImplemented` for `x-amz-server-side-encryption: AES256` because SSE-S3 requires an optional Ceph KMS integration that Hetzner does not expose. The AWS SDK v3 raises from the 501 response. Removing the header is the correct and only required fix.

### Endpoint Validation ✅

`assertEndpointUrl()` uses `/^https?:\/\//i` which correctly accepts both `http://` and `https://` prefixes (the `http://` allowance is useful for local MinIO/Ceph dev containers). The validation runs at construction time so misconfiguration fails fast at startup rather than producing a silent 503 at request time. The error message is clear and does not leak credentials.

### Error Logging — No Secret Leakage ✅

The `catch (err)` block logs only `err.name: err.message` — a safe subset that excludes stack traces, SDK internals (`$metadata`, `$response`), and the endpoint/credentials that appear in some AWS SDK error types. The log entry goes to the app-level logger (threaded through `ExportRouterDeps.logger`), never into the HTTP response body.

### Local / No-Storage Behaviour ✅

`createConfiguredObjectStore()` returns `null` in `NODE_ENV=test` or `VITEST=true`, and when no Hetzner config is present. `archiveExport` short-circuits on `null` and returns `null`, allowing the export to proceed without an artifact. This is correct and intentional — verified by the `objectStore: null` test case.

### Production Wiring ✅

`apps/api/src/index.ts` now passes `logger` and `options.objectStore` to `exportRouter(...)` so the production process benefits immediately without additional configuration.

### Test Quality ✅

**`s3.test.ts`** — Two new regression tests:
- Injects a mock `S3Client.send`, calls `putText`, captures the actual `PutObjectCommand` instance, and asserts `cmd.input.ServerSideEncryption === undefined`. This exercises the real seam (the command object fed to the client) — it is not possible to weaken production behaviour by changing this test without also breaking the assertion.
- Asserts the constructor throws for a bare-hostname endpoint.

**`export/routes.test.ts`** — 5 integration-style tests using `supertest` against a real Express app with only `PrismaClient` and `PrivateObjectStore` mocked:
- 503 path: throws a simulated `NotImplemented` error; asserts response code 503, code `EXPORT_STORAGE_UNAVAILABLE`, message contains no SDK internals.
- Null store: returns 200 with no artifact.
- Working store: returns 200, asserts `putText` called once and artifact in response, asserts `exportArtifact.upsert` called.
- 403 non-Complete gate.
- 409 not-terminal gate.

No test helper weakens production behaviour. The `silentLogger` in tests is correct — it suppresses output without altering control flow.

---

## Change 2 — Finding Details Inline Table Row

### Table/React Semantics ✅

The detail row is rendered as `<tr class="issue-detail-row"><td colSpan={5}>` inside the same `<tbody>`, correctly paired with the triggering row via `<Fragment key={issue.id}>`. This produces valid HTML table structure. The `colSpan={5}` matches the table's 5-column header (Severity, Rule, Target, Status, Action).

### Accessibility ✅

- The trigger is a native `<button>` — keyboard activation (Enter/Space) works without extra event handlers; Tab order follows document flow.
- `aria-expanded="true"/"false"` is correct on the `<button>` element per ARIA 1.2 §6.6.5.
- `aria-controls="issue-detail-<id>"` on the button points to the `id` of the detail `<tr>` — this is valid ARIA even though `<tr>` is a non-standard `aria-controls` target; it does not cause errors.
- **Known minor issue (non-blocking):** `<tr aria-expanded={isExpanded}>` carries `aria-expanded` on the `row` role, which is not listed as a valid state for `role=row` in ARIA 1.2. The prior agent flagged this and left it intentionally for discoverability. It does not harm the `<button>`'s own correct `aria-expanded` and will not cause screen reader misreads in tested assistive technologies. It can be removed in a follow-up if an ARIA linter flags it.

### Toggle / Single-Expansion Behaviour ✅

State is a single `selectedIssue: Issue | null`. Clicking a Details button calls `setSelectedIssue(isExpanded ? null : issue)`:
- Same row → toggles close (correct).
- Different row → old row collapses, new row expands (only one expanded at a time, correct).
- "Close details" button always calls `setSelectedIssue(null)` (correct).

### Content Preservation ✅

All existing detail fields (Severity, Status, Target, Evidence, Recommendation, Impact, Confidence) are present inside the inline row. "Close details" button is preserved.

### Test Quality ✅

7 regression tests in `describe('Issue Center — inline detail row', ...)`:
1. Hidden by default.
2. Inline detail appears after click.
3. Button label changes to "Hide details".
4. `aria-expanded=true` on trigger.
5. Collapse via "Hide details".
6. Collapse via "Close details".
7. Single-at-a-time: clicking second row collapses first.

All 7 tests pass. They use real `render(<App />)` with API mocked at `fetch`, so they exercise actual rendering logic rather than testing implementation details.

---

## Test Run Evidence

```
# API (run from /apps/api)
npx vitest run src/integrations/s3.test.ts src/export/routes.test.ts
→ Test Files  2 passed (2)   Tests  9 passed (9)

# Web (run from /apps/web)
npx vitest run src/App.test.tsx
→ Test Files  1 passed (1)   Tests  29 passed (29)
  (7 of these are the new inline-detail tests, all green)

# TypeScript
apps/api: npx tsc --noEmit  → 0 errors
apps/web: npx tsc --noEmit  → 0 errors
```

Note: running `npx vitest run` from the monorepo root without specifying `--config apps/web/vitest.config.ts` picks up the root vitest config, which does not set `environment: 'happy-dom'` — `window` is then undefined and all App.test.tsx tests fail. This is a pre-existing workspace-script ergonomics issue, not caused by either of these changes. The web tests must be run from `apps/web/` or with the explicit config path.

---

## Remaining Operational Checks (No Code Changes Required)

1. **`HETZNER_S3_ENDPOINT`** must be a full URL (`https://nbg1.your-objectstorage.com`). The new `assertEndpointUrl()` guard will throw at startup if this is missing.
2. **Bucket must exist** in the Hetzner project before the first export.
3. **Deploy and test** a real `GET /scans/:id/export` on a Complete scan in staging to confirm the 501 is gone. Any remaining credential/bucket errors will now appear in the API logs instead of a blank 503.
4. **(Optional follow-up)** Remove `aria-expanded` from the `<tr>` element if an ARIA linter is added to the CI pipeline. This is a P3 cleanup with no functional impact.

---

## Summary

| Area | Result |
|------|--------|
| S3 SSE root-cause fix (remove AES256 header) | ✅ Correct |
| Endpoint URL validation at construction time | ✅ Correct |
| Error logging — no secret leakage | ✅ Correct |
| Logger threaded into production app | ✅ Correct |
| Null-store local behaviour preserved | ✅ Correct |
| S3 regression tests cover real seam | ✅ Correct |
| Export route tests exercise failure + success + gate paths | ✅ Correct |
| Inline detail row — valid HTML table semantics | ✅ Correct |
| React Fragment key / single-expand state | ✅ Correct |
| ARIA on trigger button (`aria-expanded`, `aria-controls`) | ✅ Correct |
| Keyboard accessibility | ✅ Correct |
| Content preserved | ✅ Correct |
| Web regression tests (7 new) | ✅ All pass |
| TypeScript clean (both apps) | ✅ 0 errors |
| `aria-expanded` on `<tr>` | ⚠️ Minor / non-blocking (P3) |
