-- Retires the Paused scan status: a guard, and the marker a later contract
-- migration names. It changes no data and no schema.
--
-- PR #75 removed scan pausing but kept everything a leftover paused scan needed
-- (the Paused status, the resume sweep, the worker's settle hook,
-- Scan."pauseRequestedAt"). This release removes all of it: no code reads,
-- writes, resumes or cancels a Paused scan any more. A Paused row that reached
-- this release would sit in the workspace for good, its job parked where the
-- queue never looks, with nothing left to settle it. So the deploy must stop
-- here instead — before the new release takes traffic, while the live one,
-- which still settles such rows, keeps serving. Production held none on
-- 2026-10-19 (owner's read-only check); this makes that a precondition rather
-- than a snapshot.
--
-- If it fires: roll nothing forward. Let the live release's sweep settle the
-- rows (it runs every 5 minutes), mark this migration rolled back
-- (`prisma migrate resolve --rolled-back 20261019120000_retire_paused_status`)
-- and deploy again.
--
-- The column itself stays. The release before this one still declares
-- "pauseRequestedAt" in schema.prisma, so its Prisma client selects it, and a
-- rollback to it must keep working (D-230). This release no longer declares it.
-- The contract migration that drops it ships in a later release and names this
-- one as its prerequisite:
--
--   -- fluxradar:contract-requires 20261019120000_retire_paused_status
--
-- so deploy/contract-phase-gate.sh refuses it until every rollback candidate
-- ships this migration, i.e. no longer selects the column.
--
-- Safe to re-run: it only reads, and raises or does nothing.

DO $$
DECLARE
  paused_scans integer;
  flagged_scans integer;
  parked_jobs integer;
BEGIN
  SELECT count(*) INTO paused_scans FROM "Scan" WHERE "status" = 'Paused';
  SELECT count(*) INTO flagged_scans FROM "Scan" WHERE "pauseRequestedAt" IS NOT NULL;
  SELECT count(*) INTO parked_jobs FROM "Job" WHERE "status" = 'Paused';
  IF paused_scans > 0 OR flagged_scans > 0 OR parked_jobs > 0 THEN
    RAISE EXCEPTION
      'retire_paused_status: % Scan row(s) with status Paused, % with pauseRequestedAt set, % Job row(s) with status Paused. This release no longer settles paused scans; let the live release''s legacy sweep settle them, then mark this migration rolled back and deploy again.',
      paused_scans, flagged_scans, parked_jobs;
  END IF;
END
$$;
