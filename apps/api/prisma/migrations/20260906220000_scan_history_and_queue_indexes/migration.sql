-- Access paths for scan history, the job queue and the profile guards.
--
-- EXPAND PHASE — additive only. It creates indexes and nothing else: no column
-- is added, renamed, dropped or narrowed, and no row is rewritten, so the
-- previous release (which does not know these indexes exist) keeps working
-- unchanged if the deploy is rolled back. No data can be lost by applying or by
-- reverting it.
--
-- What each one is for, and why it is needed now:
--
--   Scan(accountId, createdAt, id)
--   Scan(accountId, siteProfileId, createdAt, id)
--     GET /scans and GET /profiles/:id/scans read history one page at a time,
--     newest first, ordered by (createdAt DESC, id DESC). Until this release
--     they read EVERY scan of the account and sliced the page in JavaScript;
--     they now ask PostgreSQL for the page. Without a matching index that is a
--     sequential scan plus a sort of the account's whole history on every list
--     request — the cost grows with how long a customer has been paying us.
--     The id tie-breaker is part of the index because it is part of the ORDER BY:
--     two scans created in the same millisecond must not swap places between
--     page 1 and page 2 and hide a row.
--
--   Scan(accountId, plan)
--     The Basic/Complete history gate asks "does this account (or this profile)
--     own a scan of plan X" before serving any page. It is an existence probe
--     and must be answered from the index rather than by reading rows.
--
--   Scan(accountId, status)
--     GET /scans/active looks up the single in-flight scan of an account on
--     every workspace load and on every poll while a scan runs.
--
--   Scan(siteProfileId), Purchase(siteProfileId), CheckoutSession(siteProfileId, status)
--     The profile guards: deletion counts the scans and purchases that block it,
--     and both deletion and a domain change ask whether a checkout that can
--     still be paid is bound to the profile. These are also the foreign-key
--     lookups PostgreSQL performs on every write to SiteProfile.
--
--   Job(status, createdAt, id)
--     The queue claim reads the oldest Pending job every 30 seconds and the
--     recovery pass reads Claimed jobs whose lease expired. Job keeps one row
--     per scan forever, so without this index both are a sequential scan whose
--     cost grows with the product's whole history rather than with the depth of
--     the queue.
--
-- Plain CREATE INDEX, not CONCURRENTLY: Prisma runs each migration inside a
-- transaction, where CONCURRENTLY is not allowed. At current table sizes the
-- build is milliseconds. Should that stop being true, these indexes have to be
-- created out of band before the deploy — IF NOT EXISTS then makes this
-- migration a no-op instead of a conflict.

CREATE INDEX IF NOT EXISTS "Scan_accountId_createdAt_id_idx"
  ON "Scan"("accountId", "createdAt", "id");

CREATE INDEX IF NOT EXISTS "Scan_accountId_siteProfileId_createdAt_id_idx"
  ON "Scan"("accountId", "siteProfileId", "createdAt", "id");

CREATE INDEX IF NOT EXISTS "Scan_accountId_plan_idx"
  ON "Scan"("accountId", "plan");

CREATE INDEX IF NOT EXISTS "Scan_accountId_status_idx"
  ON "Scan"("accountId", "status");

CREATE INDEX IF NOT EXISTS "Scan_siteProfileId_idx"
  ON "Scan"("siteProfileId");

CREATE INDEX IF NOT EXISTS "Purchase_siteProfileId_idx"
  ON "Purchase"("siteProfileId");

CREATE INDEX IF NOT EXISTS "CheckoutSession_siteProfileId_status_idx"
  ON "CheckoutSession"("siteProfileId", "status");

CREATE INDEX IF NOT EXISTS "Job_status_createdAt_id_idx"
  ON "Job"("status", "createdAt", "id");
