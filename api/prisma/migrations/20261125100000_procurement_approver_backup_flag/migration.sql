-- Lovable procurement_approvers.is_backup (found by the import dry-run): additive, defaults to false.
ALTER TABLE "procurement_approvers" ADD COLUMN "is_backup" BOOLEAN NOT NULL DEFAULT false;
