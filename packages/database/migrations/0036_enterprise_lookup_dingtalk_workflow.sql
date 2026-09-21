-- Enterprise lookup daily usage + DingTalk approval automation rules.
-- Widen platform_infra_settings id CHECK to include 'enterprise_lookup'.
-- Idempotent CREATE TABLE/INDEX/CONSTRAINT so re-runs are safe.
-- Hand-written because drizzle-kit generate would also rewrite
-- docs/development/database-schema.dbml (outside this batch's file set).
-- Snapshot ancestry is copied from 0035 + the new tables / CHECK delta.

ALTER TABLE "platform_infra_settings" DROP CONSTRAINT IF EXISTS "platform_infra_settings_id_check";
--> statement-breakpoint
ALTER TABLE "platform_infra_settings" ADD CONSTRAINT "platform_infra_settings_id_check" CHECK ("id" IN ('object_storage', 'mail', 'enterprise_lookup'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_lookup_daily_usage" (
	"user_id" text NOT NULL,
	"usage_date" date NOT NULL,
	"provider" text NOT NULL,
	"call_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enterprise_lookup_daily_usage_user_id_usage_date_provider_pk" PRIMARY KEY("user_id","usage_date","provider")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dingtalk_approval_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"name" text NOT NULL,
	"process_code" text NOT NULL,
	"process_name" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"action" text NOT NULL,
	"remark" text,
	"redirect_to_staff_id" text,
	"redirect_to_name" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"disabled_reason" text,
	"daily_count" integer DEFAULT 0 NOT NULL,
	"daily_count_date" date,
	"last_run_at" timestamp with time zone,
	"created_by_topic_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dingtalk_approval_rule_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"user_id" text NOT NULL,
	"process_instance_id" text NOT NULL,
	"task_id" text NOT NULL,
	"instance_title" text,
	"originator_name" text,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enterprise_lookup_daily_usage" DROP CONSTRAINT IF EXISTS "enterprise_lookup_daily_usage_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "enterprise_lookup_daily_usage" ADD CONSTRAINT "enterprise_lookup_daily_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dingtalk_approval_rules" DROP CONSTRAINT IF EXISTS "dingtalk_approval_rules_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "dingtalk_approval_rules" ADD CONSTRAINT "dingtalk_approval_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dingtalk_approval_rule_runs" DROP CONSTRAINT IF EXISTS "dingtalk_approval_rule_runs_rule_id_dingtalk_approval_rules_id_fk";
--> statement-breakpoint
ALTER TABLE "dingtalk_approval_rule_runs" ADD CONSTRAINT "dingtalk_approval_rule_runs_rule_id_dingtalk_approval_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."dingtalk_approval_rules"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dingtalk_approval_rule_runs" DROP CONSTRAINT IF EXISTS "dingtalk_approval_rule_runs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "dingtalk_approval_rule_runs" ADD CONSTRAINT "dingtalk_approval_rule_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dingtalk_approval_rules_user_id_idx" ON "dingtalk_approval_rules" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dingtalk_approval_rules_enabled_process_code_idx" ON "dingtalk_approval_rules" USING btree ("enabled","process_code");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dingtalk_approval_rule_runs_rule_id_task_id_unique" ON "dingtalk_approval_rule_runs" USING btree ("rule_id","task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dingtalk_approval_rule_runs_user_id_created_at_idx" ON "dingtalk_approval_rule_runs" USING btree ("user_id","created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dingtalk_approval_rule_runs_rule_id_created_at_idx" ON "dingtalk_approval_rule_runs" USING btree ("rule_id","created_at" DESC);
