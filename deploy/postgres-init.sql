-- The application database is created by the official Postgres image from
-- POSTGRES_DB. Keep API tests in a separate database so they can truncate
-- disposable state without touching local development data.
CREATE DATABASE fluxradar_test OWNER fluxradar;
