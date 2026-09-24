-- DingTalk personal-data authorizations (one row per AIHub user).
-- The dws token stays in the sidecar; this table stores only the profile binding.
-- Idempotent CREATE TABLE / FK / INDEX so re-runs are safe.
-- Hand-written because drizzle-kit generate would also rewrite
-- docs/development/database-schema.dbml (outside this batch's file set).
-- Snapshot ancestry is copied from 0036 plus this table.

CREATE TABLE IF NOT EXISTS "dingtalk_personal_authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"corp_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"profile" text NOT NULL,
	"dingtalk_user_name" text,
	"corp_name" text,
	"status" text NOT NULL,
	"authorized_at" timestamp with time zone NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dingtalk_personal_authorizations" DROP CONSTRAINT IF EXISTS "dingtalk_personal_authorizations_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "dingtalk_personal_authorizations" ADD CONSTRAINT "dingtalk_personal_authorizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dingtalk_personal_authorizations_user_id_unique" ON "dingtalk_personal_authorizations" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dingtalk_personal_authorizations_corp_id_staff_id_idx" ON "dingtalk_personal_authorizations" USING btree ("corp_id","staff_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dingtalk_personal_authorizations_profile_active_unique" ON "dingtalk_personal_authorizations" USING btree ("profile") WHERE "dingtalk_personal_authorizations"."status" = 'active';
