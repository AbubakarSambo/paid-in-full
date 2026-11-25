-- DropForeignKey
ALTER TABLE "batch_items" DROP CONSTRAINT "batch_items_vendor_id_fkey";

-- DropForeignKey
ALTER TABLE "wht_ledger" DROP CONSTRAINT "wht_ledger_vendor_id_fkey";

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "created_by_id" TEXT,
ADD COLUMN     "invoice_footer" TEXT,
ADD COLUMN     "payout_narration_name" TEXT,
ADD COLUMN     "require_reauth_for_disbursement" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "session_timeout_minutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "signature_url" TEXT,
ADD COLUMN     "theme_color" TEXT;

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "notify_channel" TEXT NOT NULL DEFAULT 'whatsapp',
ADD COLUMN     "notify_opt_in" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "cost_centers" ADD COLUMN     "color" TEXT,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "has_locations" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "code" TEXT,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "pay_categories" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "budgets" ADD COLUMN     "location_id" TEXT,
ADD COLUMN     "pay_category_id" TEXT;

-- AlterTable
ALTER TABLE "requisitions" ADD COLUMN     "approval_round" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "final_approved_at" TIMESTAMP(3),
ADD COLUMN     "final_approved_by_id" TEXT,
ADD COLUMN     "hod_name" TEXT,
ADD COLUMN     "pnl_period" TEXT,
ADD COLUMN     "staff_account_note" TEXT;

-- AlterTable
ALTER TABLE "queue_items" ADD COLUMN     "budget_tag" TEXT;

-- AlterTable
ALTER TABLE "batches" ADD COLUMN     "payout_batch_reference" TEXT;

-- AlterTable
ALTER TABLE "batch_items" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_id" TEXT,
ADD COLUMN     "attachment_group_id" TEXT,
ADD COLUMN     "created_by_id" TEXT,
ADD COLUMN     "legacy_status" TEXT,
ADD COLUMN     "legacy_vendor_id" TEXT,
ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "paid_by_id" TEXT,
ADD COLUMN     "pay_started_at" TIMESTAMP(3),
ADD COLUMN     "queued_at" TIMESTAMP(3),
ADD COLUMN     "requisition_id" TEXT,
ALTER COLUMN "vendor_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "batch_item_payouts" ADD COLUMN     "message" TEXT,
ADD COLUMN     "payout_group_id" TEXT;

-- AlterTable
ALTER TABLE "wallet_ledger_entries" ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "source_key" TEXT;

-- AlterTable
ALTER TABLE "wallet_topups" ADD COLUMN     "raw_payload" JSONB;

-- AlterTable
ALTER TABLE "wallet_sweeps" ADD COLUMN     "clearing" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ledger_available" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "live_wallet_balance" DECIMAL(14,2),
ADD COLUMN     "raw" JSONB,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "released_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ok',
ALTER COLUMN "amount" SET DEFAULT 0,
ALTER COLUMN "monnify_reference" DROP NOT NULL;

-- AlterTable
ALTER TABLE "payout_funding_waits" ADD COLUMN     "notified_at" TIMESTAMP(3),
ADD COLUMN     "ready_at_block" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "wht_ledger" ADD COLUMN     "coa" TEXT,
ADD COLUMN     "net_amount" DECIMAL(14,2),
ADD COLUMN     "payout_group_id" TEXT,
ADD COLUMN     "remit_status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "vendor_name" TEXT,
ADD COLUMN     "vendor_payout_reference" TEXT,
ADD COLUMN     "wht_payout_reference" TEXT,
ALTER COLUMN "vendor_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "customer_credits" ADD COLUMN     "created_by_id" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NGN';

-- AlterTable
ALTER TABLE "invoice_template_items" ADD COLUMN     "discount_type" "DiscountType",
ADD COLUMN     "discount_value" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "cc_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "collection_provisioned_at" TIMESTAMP(3),
ADD COLUMN     "converted_at" TIMESTAMP(3),
ADD COLUMN     "fx_locked_at" TIMESTAMP(3),
ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "share_token_created_at" TIMESTAMP(3),
ADD COLUMN     "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tax_rate" DECIMAL(9,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN     "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discount_type" "DiscountType",
ADD COLUMN     "discount_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tax_inclusive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vat_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "wht_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invoice_sends" ADD COLUMN     "error" TEXT,
ADD COLUMN     "message" TEXT,
ADD COLUMN     "provider_message_id" TEXT,
ADD COLUMN     "sent_by_id" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'sent';

-- AlterTable
ALTER TABLE "billing_plans" ADD COLUMN     "code" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NGN',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "prepay_monthly_amount" DECIMAL(14,2),
ADD COLUMN     "prepay_months" INTEGER,
ADD COLUMN     "product_type" TEXT,
ADD COLUMN     "setup_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "workspace_subscriptions" ADD COLUMN     "client_status" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NGN',
ADD COLUMN     "grace_until" DATE,
ADD COLUMN     "prepay_months" INTEGER,
ADD COLUMN     "setup_fee_paid_at" TIMESTAMP(3),
ADD COLUMN     "trial_granted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "customer_subscriptions" ADD COLUMN     "billing_day" INTEGER,
ADD COLUMN     "created_by_id" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NGN',
ADD COLUMN     "start_date" DATE;

-- AlterTable
ALTER TABLE "email_send_log" ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "message_id" TEXT,
ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "suppressed_emails" ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "app_config" ADD COLUMN     "is_sensitive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "client_errors" ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "severity" TEXT NOT NULL DEFAULT 'error',
ADD COLUMN     "source" TEXT,
ADD COLUMN     "user_email" TEXT,
ADD COLUMN     "user_id" TEXT,
ADD COLUMN     "workspace_id" TEXT;

-- CreateTable
CREATE TABLE "procurement_approvers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "approval_role" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_approvers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requisition_approvals" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "requisition_id" TEXT NOT NULL,
    "approval_round" INTEGER NOT NULL DEFAULT 0,
    "approver_user_id" TEXT NOT NULL,
    "approval_role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requisition_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "requisition_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "received_qty" DECIMAL(14,3),
    "condition" TEXT,
    "notes" TEXT,
    "first_by_id" TEXT,
    "first_at" TIMESTAMP(3),
    "second_by_id" TEXT,
    "second_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "procurement_approvers_workspace_id_user_id_approval_role_key" ON "procurement_approvers"("workspace_id", "user_id", "approval_role");

-- CreateIndex
CREATE INDEX "requisition_approvals_workspace_id_idx" ON "requisition_approvals"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "requisition_approvals_requisition_id_approval_round_approva_key" ON "requisition_approvals"("requisition_id", "approval_round", "approval_role");

-- CreateIndex
CREATE UNIQUE INDEX "requisition_approvals_requisition_id_approval_round_approve_key" ON "requisition_approvals"("requisition_id", "approval_round", "approver_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_requisition_id_key" ON "goods_receipts"("requisition_id");

-- CreateIndex
CREATE INDEX "goods_receipts_workspace_id_idx" ON "goods_receipts"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_ledger_entries_source_key_key" ON "wallet_ledger_entries"("source_key");

-- CreateIndex
CREATE INDEX "wallet_sweeps_workspace_id_created_at_idx" ON "wallet_sweeps"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "wht_ledger_payout_group_id_key" ON "wht_ledger"("payout_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_plans_code_key" ON "billing_plans"("code");

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wht_ledger" ADD CONSTRAINT "wht_ledger_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_approvers" ADD CONSTRAINT "procurement_approvers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_approvers" ADD CONSTRAINT "procurement_approvers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisition_approvals" ADD CONSTRAINT "requisition_approvals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisition_approvals" ADD CONSTRAINT "requisition_approvals_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisition_approvals" ADD CONSTRAINT "requisition_approvals_approver_user_id_fkey" FOREIGN KEY ("approver_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

