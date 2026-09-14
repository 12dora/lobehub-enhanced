-- Denormalized pinyin search columns on users for admin pickers.
-- Prefix indexes (text_pattern_ops) so 1–3 letter queries (shao / sjj) use btree.
-- Contains ILIKE '%q%' on name/username/email uses gin_trgm_ops (pg_trgm).
-- Existing rows are filled by the one-shot startup backfill (pinyin-pro is JS).
--
-- Idempotent / convergent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Hand-written because drizzle-kit generate is broken here (schema glob eats
-- test files); `meta/0030_snapshot.json` is the 0029 ancestry plus these columns.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pinyin_full" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pinyin_initials" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_pinyin_full_pattern_idx"
  ON "users" USING btree ("pinyin_full" text_pattern_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_pinyin_initials_pattern_idx"
  ON "users" USING btree ("pinyin_initials" text_pattern_ops);
--> statement-breakpoint

-- Contains `lower(field) LIKE '%q%'` for admin pickers (optional where pg_trgm exists).
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'pg_trgm unavailable; skipping users trigram indexes';
      RETURN;
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "users_full_name_trgm_idx"
      ON "users" USING gin (lower("full_name") gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "users_username_trgm_idx"
      ON "users" USING gin (lower("username") gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "users_email_trgm_idx"
      ON "users" USING gin (lower("email") gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "users_normalized_email_trgm_idx"
      ON "users" USING gin (lower("normalized_email") gin_trgm_ops);
  END IF;
END $$;
