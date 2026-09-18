-- Narrow reminder_recipients unique indexes so department uniqueness only
-- applies to kind='department' rows. User rows store leaf dept_id, so the old
-- (reminder_id, kind, dept_id) WHERE dept_id IS NOT NULL index collided for
-- two users in the same department.
-- Idempotent DROP + CREATE. Existing prod data is compatible.

DROP INDEX IF EXISTS "reminder_recipients_user_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "reminder_recipients_dept_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reminder_recipients_user_unique" ON "reminder_recipients" USING btree ("reminder_id","staff_id") WHERE "reminder_recipients"."kind" = 'user';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reminder_recipients_dept_unique" ON "reminder_recipients" USING btree ("reminder_id","dept_id") WHERE "reminder_recipients"."kind" = 'department';
