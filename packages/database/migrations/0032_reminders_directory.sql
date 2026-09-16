-- Timed reminders + DingTalk directory (org-chart mirror for 服务号).
-- Idempotent CREATE TABLE/INDEX/CONSTRAINT so re-runs are safe.

CREATE TABLE IF NOT EXISTS "dingtalk_departments" (
	"dept_id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"name_pinyin_full" text DEFAULT '' NOT NULL,
	"name_pinyin_initials" text DEFAULT '' NOT NULL,
	"path_names" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dingtalk_directory_users" (
	"staff_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_pinyin_full" text DEFAULT '' NOT NULL,
	"name_pinyin_initials" text DEFAULT '' NOT NULL,
	"avatar" text,
	"union_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"leaf_dept_id" text,
	"leaf_dept_name" text DEFAULT '' NOT NULL,
	"dept_path" text DEFAULT '' NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dingtalk_user_departments" (
	"staff_id" text NOT NULL,
	"dept_id" text NOT NULL,
	CONSTRAINT "dingtalk_user_departments_staff_id_dept_id_pk" PRIMARY KEY("staff_id","dept_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reminders" (
	"id" text PRIMARY KEY NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_agent_id" text,
	"creator_name" text NOT NULL,
	"content" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"fire_at" timestamp with time zone NOT NULL,
	"repeat_rule" jsonb,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"fired_count" integer DEFAULT 0 NOT NULL,
	"last_fired_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"source" text DEFAULT 'tool' NOT NULL,
	"topic_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reminder_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"reminder_id" text NOT NULL,
	"fired_at" timestamp with time zone NOT NULL,
	"staff_id" text NOT NULL,
	"user_id" text,
	"status" text NOT NULL,
	"failed_reason" text,
	"provider_task_id" text,
	"hidden_by_recipient" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reminder_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"reminder_id" text NOT NULL,
	"kind" text NOT NULL,
	"staff_id" text,
	"dept_id" text,
	"display_name" text NOT NULL,
	"dept_name" text DEFAULT '' NOT NULL,
	"dept_path" text DEFAULT '' NOT NULL,
	"member_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dingtalk_user_departments" DROP CONSTRAINT IF EXISTS "dingtalk_user_departments_staff_id_dingtalk_directory_users_staff_id_fk";
--> statement-breakpoint
ALTER TABLE "dingtalk_user_departments" ADD CONSTRAINT "dingtalk_user_departments_staff_id_dingtalk_directory_users_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."dingtalk_directory_users"("staff_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dingtalk_user_departments" DROP CONSTRAINT IF EXISTS "dingtalk_user_departments_dept_id_dingtalk_departments_dept_id_fk";
--> statement-breakpoint
ALTER TABLE "dingtalk_user_departments" ADD CONSTRAINT "dingtalk_user_departments_dept_id_dingtalk_departments_dept_id_fk" FOREIGN KEY ("dept_id") REFERENCES "public"."dingtalk_departments"("dept_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reminder_deliveries" DROP CONSTRAINT IF EXISTS "reminder_deliveries_reminder_id_reminders_id_fk";
--> statement-breakpoint
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_reminder_id_reminders_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reminder_recipients" DROP CONSTRAINT IF EXISTS "reminder_recipients_reminder_id_reminders_id_fk";
--> statement-breakpoint
ALTER TABLE "reminder_recipients" ADD CONSTRAINT "reminder_recipients_reminder_id_reminders_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reminders" DROP CONSTRAINT IF EXISTS "reminders_created_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dingtalk_departments_parent_id_idx" ON "dingtalk_departments" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dingtalk_departments_name_idx" ON "dingtalk_departments" USING btree ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dingtalk_departments_name_pinyin_full_idx" ON "dingtalk_departments" USING btree ("name_pinyin_full");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dingtalk_departments_name_pinyin_initials_idx" ON "dingtalk_departments" USING btree ("name_pinyin_initials");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dingtalk_directory_users_name_idx" ON "dingtalk_directory_users" USING btree ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dingtalk_directory_users_name_pinyin_full_idx" ON "dingtalk_directory_users" USING btree ("name_pinyin_full");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dingtalk_directory_users_name_pinyin_initials_idx" ON "dingtalk_directory_users" USING btree ("name_pinyin_initials");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dingtalk_user_departments_dept_id_idx" ON "dingtalk_user_departments" USING btree ("dept_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminder_deliveries_staff_id_fired_at_idx" ON "reminder_deliveries" USING btree ("staff_id","fired_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminder_deliveries_reminder_id_idx" ON "reminder_deliveries" USING btree ("reminder_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reminder_recipients_user_unique" ON "reminder_recipients" USING btree ("reminder_id","kind","staff_id") WHERE "reminder_recipients"."staff_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reminder_recipients_dept_unique" ON "reminder_recipients" USING btree ("reminder_id","kind","dept_id") WHERE "reminder_recipients"."dept_id" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminder_recipients_reminder_id_idx" ON "reminder_recipients" USING btree ("reminder_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminders_status_fire_at_idx" ON "reminders" USING btree ("status","fire_at");
