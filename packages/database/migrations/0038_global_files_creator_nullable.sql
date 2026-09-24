-- global_files.creator: make the column nullable again.
-- The FK is ON DELETE SET NULL (baseline 0000), but 0001 added NOT NULL, so
-- deleting any user who ever uploaded a file failed with a not-null violation
-- (admin hard delete, self delete, tests). Nothing reads creator for access
-- control; it is only written on insert. Shared blobs stay intact for the other
-- users that reference them; blobs owned only by the deleted user keep their row
-- with creator NULL, matching upstream LobeHub.
-- Hand-written; snapshot copied from 0037 with creator.notNull = false.

ALTER TABLE "global_files" ALTER COLUMN "creator" DROP NOT NULL;
