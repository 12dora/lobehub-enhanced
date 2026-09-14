-- Denormalized pinyin search columns on users for admin pickers.
-- Prefix indexes (text_pattern_ops) so 1–3 letter queries (shao / sjj) use btree.
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
