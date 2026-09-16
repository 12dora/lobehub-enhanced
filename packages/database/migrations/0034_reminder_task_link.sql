-- Link reminder profile rows to tasks (定时提醒 as a task).
-- Legacy rows keep task_id NULL and stay on the reminderWorker sweep.

ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "task_id" text;--> statement-breakpoint
ALTER TABLE "reminders" DROP CONSTRAINT IF EXISTS "reminders_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reminders_task_id_unique" ON "reminders" USING btree ("task_id") WHERE "reminders"."task_id" is not null;
