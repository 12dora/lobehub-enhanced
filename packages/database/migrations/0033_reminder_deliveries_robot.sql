-- Dual-delivery tracking for 服务号 robot 1:1 messages on reminder_deliveries.
-- provider_task_id stays the work-notice task_id; these columns record the robot channel.

ALTER TABLE "reminder_deliveries" ADD COLUMN IF NOT EXISTS "robot_message_id" text;--> statement-breakpoint
ALTER TABLE "reminder_deliveries" ADD COLUMN IF NOT EXISTS "robot_status" text;--> statement-breakpoint
ALTER TABLE "reminder_deliveries" ADD COLUMN IF NOT EXISTS "robot_failed_reason" text;
