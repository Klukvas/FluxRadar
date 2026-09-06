-- Manual reversal of 20260906200000_cumulative_provider_refunds. Prisma has no
-- down migrations, and an automatic release rollback must NOT run this: the table
-- is additive and invisible to the previous release, so a rollback has nothing to
-- undo. Running it DESTROYS the record of which refunds were already counted, so
-- a partial return delivered afterwards starts the sum from zero again.
--
--   psql "$DATABASE_URL" -f down.sql
--   DELETE FROM "_prisma_migrations"
--     WHERE migration_name = '20260906200000_cumulative_provider_refunds';

DROP TABLE IF EXISTS "ProviderRefund";
