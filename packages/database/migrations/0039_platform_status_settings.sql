CREATE TABLE IF NOT EXISTS "platform_status_settings" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"robot_secret" text,
	"robot_webhook" text,
	"jobs_cleared_at" timestamp with time zone,
	"api_token_hash" text,
	"api_token_hint" text,
	"api_token_created_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_status_settings_id_singleton" CHECK ("platform_status_settings"."id" = 'global'),
	CONSTRAINT "platform_status_settings_revision_check" CHECK ("platform_status_settings"."revision" >= 1)
);
