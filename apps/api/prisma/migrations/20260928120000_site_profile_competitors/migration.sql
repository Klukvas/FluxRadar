-- T7: up to 5 competitor brand names per SiteProfile, stored as a JSON array
-- of strings. Nullable rather than defaulted to "[]" — "no competitors
-- configured" and "an empty list" are the same state, and a nullable column
-- says so directly instead of needing a sentinel value.
--
-- Not read anywhere the AI-processing pipeline reads profile context from
-- (GeoProfileContext / CONTEXT_FIELDS): competitor names are matched locally,
-- after the fact, against answers this scan already stored.
ALTER TABLE "SiteProfile" ADD COLUMN "competitorsJson" TEXT;
