-- Provenance for messenger_account_links: auto-link vs admin-managed bind.
-- Idempotent ADD COLUMN IF NOT EXISTS. Existing rows stay `auto`.
-- Hand-written because drizzle-kit generate is broken here (schema glob eats
-- test files); `meta/0031_snapshot.json` is the 0030 ancestry plus this column.

ALTER TABLE "messenger_account_links" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'auto' NOT NULL;
