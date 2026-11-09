-- AlterTable
ALTER TABLE "batch_item_payouts" ADD COLUMN     "client_request_id" TEXT,
ADD COLUMN     "status_checked_at" TIMESTAMP(3),
ADD COLUMN     "transfer_reference" TEXT;

-- AlterTable
ALTER TABLE "batch_items" ADD COLUMN     "retried_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "customer_subscriptions" ADD COLUMN     "mandate_details" JSONB;

-- AlterTable
ALTER TABLE "email_verification_tokens" ADD COLUMN     "workspace_id" TEXT;

-- AlterTable
ALTER TABLE "invoice_templates" ADD COLUMN     "settings" JSONB;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "early_pay_discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "late_fee_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "late_fee_applied_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "user_security" ADD COLUMN     "pin_failed_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pin_locked_until" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "google_sub" TEXT,
ADD COLUMN     "has_password" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "billing_account_bank" TEXT,
ADD COLUMN     "billing_account_name" TEXT,
ADD COLUMN     "billing_account_number" TEXT,
ADD COLUMN     "billing_account_ref" TEXT;

-- CreateIndex
CREATE INDEX "batch_item_payouts_transfer_reference_idx" ON "batch_item_payouts"("transfer_reference");

-- CreateIndex
CREATE INDEX "batch_item_payouts_client_request_id_idx" ON "batch_item_payouts"("client_request_id");

