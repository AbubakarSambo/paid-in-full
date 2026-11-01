-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('STARTER', 'GROWTH', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('LEAD', 'TRIAL', 'ACTIVE', 'DEAD', 'PAUSED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('VIEWER', 'REQUESTER', 'PROCUREMENT', 'POSTER', 'APPROVER', 'PAYER', 'ADMIN');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'CLIENT_SETUP');

-- CreateEnum
CREATE TYPE "MandateStatus" AS ENUM ('INVITED', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PROCUREMENT_CLEARED', 'RETURNED', 'QUEUED', 'REJECTED');

-- CreateEnum
CREATE TYPE "QueueItemStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BatchPayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'PARTIAL', 'SUCCESS', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BatchItemPayoutStatus" AS ENUM ('PENDING', 'SENDING', 'SUCCESS', 'FAILED', 'REVERSED', 'CANCELLED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PayoutLeg" AS ENUM ('VENDOR', 'WHT');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('TOPUP', 'SWEEP_IN', 'DISBURSEMENT', 'FEE', 'REFUND', 'ADJUSTMENT', 'WHT_WITHHOLDING');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "LedgerStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "TopupSource" AS ENUM ('WEBHOOK', 'MANUAL_RECONCILIATION', 'CARD');

-- CreateEnum
CREATE TYPE "FundingWaitStatus" AS ENUM ('WAITING', 'FUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceDocType" AS ENUM ('INVOICE', 'QUOTE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FLAT');

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('OPEN', 'APPLIED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RecurrenceInterval" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY');

-- CreateEnum
CREATE TYPE "CustomerSubscriptionStatus" AS ENUM ('PENDING_MANDATE', 'ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MandateType" AS ENUM ('CARD', 'DIRECT_DEBIT');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "SettlementItemStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('WEB', 'ANDROID', 'IOS');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "industry" TEXT,
    "tin" TEXT,
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'TRIAL',
    "tier" TEXT,
    "monthly_amount" DECIMAL(14,2),
    "billing_day" INTEGER,
    "paid_until" TIMESTAMP(3),
    "next_due_date" TIMESTAMP(3),
    "notes" TEXT,
    "plan_tier" "PlanTier" NOT NULL DEFAULT 'STARTER',
    "subscription_status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trial_end_date" TIMESTAMP(3),
    "subscription_end_date" TIMESTAMP(3),
    "is_grandfathered" BOOLEAN NOT NULL DEFAULT false,
    "business_type" TEXT,
    "monnify_reserved_account_number" TEXT,
    "monnify_reserved_account_name" TEXT,
    "monnify_reserved_account_bank" TEXT,
    "monnify_reserved_account_ref" TEXT,
    "monnify_contract_code" TEXT,
    "invoice_prefix" TEXT NOT NULL DEFAULT 'INV',
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 7.5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "accent_skin" TEXT NOT NULL DEFAULT 'default',
    "onboarded" BOOLEAN NOT NULL DEFAULT false,
    "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "platform_role" "PlatformRole",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_security" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pin_hash" TEXT,
    "pin_set_at" TIMESTAMP(3),
    "idle_logout_minutes" INTEGER NOT NULL DEFAULT 15,
    "last_login_at" TIMESTAMP(3),
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),

    CONSTRAINT "user_security_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'VIEWER',
    "is_biller" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invited_by_id" TEXT,
    "joined_at" TIMESTAMP(3),

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_mandates" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'APPROVER',
    "status" "MandateStatus" NOT NULL DEFAULT 'ACTIVE',
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "client_mandates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_mandate_invites" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'APPROVER',
    "token" TEXT NOT NULL,
    "status" "MandateStatus" NOT NULL DEFAULT 'INVITED',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_mandate_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "bank_account_number" TEXT,
    "bank_code" TEXT,
    "bank_name" TEXT,
    "account_name" TEXT,
    "verified_account_name" TEXT,
    "verified_at" TIMESTAMP(3),
    "is_bank_verified" BOOLEAN NOT NULL DEFAULT false,
    "monnify_recipient_code" TEXT,
    "tin" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "wht_exempt" BOOLEAN NOT NULL DEFAULT false,
    "wht_rate" DECIMAL(6,4),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "cost_center_id" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "is_general" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_categories" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "color" TEXT NOT NULL DEFAULT '#22D3EE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "include_in_budgets" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "pay_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coa_tags" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "pay_category_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coa_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "period_month" TEXT NOT NULL,
    "cost_center_id" TEXT,
    "coa_tag_id" TEXT NOT NULL,
    "monthly_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_expenses" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pay_category_id" TEXT,
    "coa_tag_id" TEXT,
    "vendor_id" TEXT,
    "unit_name" TEXT,
    "unit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requisitions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "req_ref" TEXT,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "department_id" TEXT,
    "department_name" TEXT,
    "requested_by_id" TEXT NOT NULL,
    "requester_name" TEXT,
    "vendor_id" TEXT,
    "is_new_vendor" BOOLEAN NOT NULL DEFAULT false,
    "vendor_name" TEXT,
    "vendor_bank" TEXT,
    "vendor_bank_code" TEXT,
    "vendor_acct_no" TEXT,
    "vendor_acct_name" TEXT,
    "description" TEXT NOT NULL,
    "units" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unit_name" TEXT,
    "unit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bundle_id" TEXT,
    "bundle_label" TEXT,
    "cost_center_id" TEXT,
    "location_id" TEXT,
    "pay_category_id" TEXT,
    "coa_tag_id" TEXT,
    "reason" TEXT,
    "remarks" TEXT,
    "review_note" TEXT,
    "attachment_group_id" TEXT,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "cleared_at" TIMESTAMP(3),
    "cleared_by_id" TEXT,
    "returned_at" TIMESTAMP(3),
    "returned_by_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejected_by_id" TEXT,
    "rejection_reason" TEXT,
    "queued_at" TIMESTAMP(3),
    "queued_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_items" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendor_id" TEXT NOT NULL,
    "vendor_name" TEXT,
    "description" TEXT NOT NULL,
    "units" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unit_name" TEXT,
    "unit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "wht_rate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "wht_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "wht_override" BOOLEAN NOT NULL DEFAULT false,
    "wht_source" TEXT,
    "pay_category_id" TEXT,
    "pay_category" TEXT,
    "coa_tag_id" TEXT,
    "coa_tag" TEXT,
    "cost_center_id" TEXT,
    "location_id" TEXT,
    "pnl_period" TEXT,
    "is_urgent" BOOLEAN NOT NULL DEFAULT false,
    "bundle_id" TEXT,
    "bundle_label" TEXT,
    "recurrence_id" TEXT,
    "requisition_id" TEXT,
    "source_invoice_id" TEXT,
    "attachment_group_id" TEXT,
    "invoice_number" TEXT,
    "invoice_date" TIMESTAMP(3),
    "status" "QueueItemStatus" NOT NULL DEFAULT 'PENDING',
    "budget_flag" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT,
    "requested_by_name" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "rejected_reason" TEXT,
    "rejected_by_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "synced_to_sheets" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_item_attachments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "attachment_group_id" TEXT NOT NULL,
    "queue_item_id" TEXT,
    "storage_path" TEXT NOT NULL,
    "file_url" TEXT,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_item_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_item_comments" (
    "id" TEXT NOT NULL,
    "queue_item_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "author_name" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_item_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_payments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "day_of_month" INTEGER NOT NULL,
    "urgent_days" INTEGER NOT NULL DEFAULT 2,
    "pay_category_id" TEXT,
    "coa_tag_id" TEXT,
    "cost_center_id" TEXT,
    "location_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_charged_at" TIMESTAMP(3),
    "next_run_date" DATE,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "batch_ref" TEXT NOT NULL,
    "pay_category_id" TEXT,
    "pay_cat" TEXT,
    "pay_cat_color" TEXT,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total" DECIMAL(14,2) NOT NULL,
    "payout_status" "BatchPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_by_name" TEXT,
    "approved_at" TIMESTAMP(3),
    "disbursed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_id" TEXT,
    "cancelled_reason" TEXT,
    "synced_to_sheets" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_items" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "queue_item_id" TEXT,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendor_id" TEXT NOT NULL,
    "vendor_name" TEXT NOT NULL,
    "vendor_bank" TEXT,
    "vendor_bank_code" TEXT,
    "vendor_acct_no" TEXT,
    "vendor_acct_name" TEXT,
    "description" TEXT NOT NULL,
    "bundle_id" TEXT,
    "bundle_label" TEXT,
    "units" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unit_name" TEXT,
    "unit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "wht_rate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "wht_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payout_status" "BatchItemPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "payout_reference" TEXT,
    "payout_message" TEXT,
    "pay_category_id" TEXT,
    "pay_category" TEXT,
    "coa_tag_id" TEXT,
    "coa_tag" TEXT,
    "cost_center_id" TEXT,
    "location_id" TEXT,
    "pnl_period" TEXT,
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "returned_at" TIMESTAMP(3),
    "returned_by_id" TEXT,
    "synced_to_sheets" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_item_payouts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "batch_item_id" TEXT NOT NULL,
    "leg" "PayoutLeg" NOT NULL DEFAULT 'VENDOR',
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT NOT NULL,
    "destination_account_number" TEXT,
    "destination_bank_code" TEXT,
    "destination_account_name" TEXT,
    "failure_reason" TEXT,
    "provider_response" JSONB,
    "initiated_by_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_item_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_ledger_entries" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "status" "LedgerStatus" NOT NULL DEFAULT 'COMPLETED',
    "amount" DECIMAL(14,2) NOT NULL,
    "balance_before" DECIMAL(14,2),
    "balance_after" DECIMAL(14,2),
    "batch_id" TEXT,
    "reference" TEXT,
    "source_type" TEXT,
    "source_id" TEXT,
    "description" TEXT,
    "actor_user_id" TEXT,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_topups" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" TEXT NOT NULL,
    "payer_name" TEXT,
    "payer_bank" TEXT,
    "payer_account_number" TEXT,
    "source" "TopupSource" NOT NULL DEFAULT 'WEBHOOK',
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "wallet_topups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_sweeps" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "monnify_reference" TEXT NOT NULL,
    "source_account_number" TEXT,
    "source_account_name" TEXT,
    "matched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_sweeps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_funding_waits" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "required_amount" DECIMAL(14,2) NOT NULL,
    "available_amount" DECIMAL(14,2) NOT NULL,
    "status" "FundingWaitStatus" NOT NULL DEFAULT 'WAITING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "payout_funding_waits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wht_rates" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "coa" TEXT NOT NULL,
    "rate" DECIMAL(6,4) NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wht_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wht_ledger" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "batch_item_id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "wht_rate" DECIMAL(6,4) NOT NULL,
    "wht_amount" DECIMAL(14,2) NOT NULL,
    "tax_period" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "remitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wht_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "tax_id" TEXT,
    "notes" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "merged_into_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_credits" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "status" "CreditStatus" NOT NULL DEFAULT 'OPEN',
    "applied_to_invoice_id" TEXT,
    "applied_at" TIMESTAMP(3),
    "source_invoice_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_templates" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "terms" TEXT,
    "currency" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_template_items" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "product_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "wht_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "doc_type" "InvoiceDocType" NOT NULL DEFAULT 'INVOICE',
    "invoice_number" TEXT,
    "quote_number" TEXT,
    "quote_expires_at" TIMESTAMP(3),
    "converted_from_quote_id" TEXT,
    "customer_id" TEXT NOT NULL,
    "customer_address" TEXT,
    "customer_tin" TEXT,
    "workspace_tin" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issue_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3),
    "due_days" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "fx_rate" DECIMAL(18,6),
    "fx_base_currency" TEXT,
    "tax_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "discount_type" "DiscountType",
    "discount_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "vat_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "wht_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "amount_due" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "late_fee_percent" DECIMAL(5,2),
    "late_fee_flat" DECIMAL(14,2),
    "late_fee_grace_days" INTEGER,
    "early_pay_discount_percent" DECIMAL(5,2),
    "early_pay_discount_days" INTEGER,
    "notes" TEXT,
    "terms" TEXT,
    "template_id" TEXT,
    "recurrence_id" TEXT,
    "collection_account_number" TEXT,
    "collection_account_name" TEXT,
    "collection_bank_name" TEXT,
    "collection_account_ref" TEXT,
    "share_token" TEXT,
    "sent_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "synced_to_sheets" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "product_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "wht_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_payments" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "monnify_reference" TEXT,
    "method" TEXT,
    "notes" TEXT,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),
    "recorded_by_id" TEXT,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_recurrences" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "invoice_id" TEXT,
    "interval" "RecurrenceInterval" NOT NULL,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "due_days" INTEGER NOT NULL DEFAULT 14,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "notes" TEXT,
    "terms" TEXT,
    "template_items" JSONB,
    "last_run_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_recurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_sequences" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_sends" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sent_to" TEXT NOT NULL,
    "cc" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_sweeps" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "sheet_row_reference" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" TEXT,
    "status" TEXT,
    "matched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_sweeps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_receipts" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "invoice_payment_id" TEXT,
    "receipt_number" TEXT NOT NULL,
    "pdf_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "unit_name" TEXT,
    "unit_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_plans" (
    "id" TEXT NOT NULL,
    "tier" "PlanTier" NOT NULL,
    "name" TEXT NOT NULL,
    "price_monthly" DECIMAL(14,2) NOT NULL,
    "features" JSONB NOT NULL,

    CONSTRAINT "billing_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_subscriptions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "billing_plan_id" TEXT NOT NULL,
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_payments" (
    "id" TEXT NOT NULL,
    "workspace_subscription_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "monnify_reference" TEXT,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_charge_attempts" (
    "id" TEXT NOT NULL,
    "workspace_subscription_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    "failure_reason" TEXT,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_charge_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_dunning_state" (
    "id" TEXT NOT NULL,
    "workspace_subscription_id" TEXT NOT NULL,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3),
    "suspended_at" TIMESTAMP(3),

    CONSTRAINT "subscription_dunning_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_subscriptions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "plan_name" TEXT,
    "description" TEXT,
    "interval" "RecurrenceInterval" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "CustomerSubscriptionStatus" NOT NULL DEFAULT 'PENDING_MANDATE',
    "authorisation_token" TEXT,
    "mandate_type" "MandateType",
    "mandate_id" TEXT,
    "mandate_reference" TEXT,
    "card_last4" TEXT,
    "card_token" TEXT,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "last_charged_at" TIMESTAMP(3),
    "authorised_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_subscription_charges" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT NOT NULL,
    "failure_reason" TEXT,
    "fee_amount" DECIMAL(14,2),
    "net_amount" DECIMAL(14,2),
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "customer_subscription_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_batches" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "monnify_settlement_ref" TEXT,
    "expected_amount" DECIMAL(14,2) NOT NULL,
    "settled_amount" DECIMAL(14,2),
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "settlement_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_batch_items" (
    "id" TEXT NOT NULL,
    "settlement_batch_id" TEXT NOT NULL,
    "batch_item_payout_ref" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "SettlementItemStatus" NOT NULL DEFAULT 'UNMATCHED',

    CONSTRAINT "settlement_batch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_prefs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_prefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL DEFAULT 'WEB',
    "endpoint" TEXT NOT NULL,
    "p256dh_key" TEXT NOT NULL,
    "auth_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_send_log" (
    "id" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_send_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_send_state" (
    "id" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "last_sent_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_send_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_unsubscribe_tokens" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_unsubscribe_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppressed_emails" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppressed_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_config" (
    "workspace_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("workspace_id","key")
);

-- CreateTable
CREATE TABLE "platform_config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "user_id" TEXT,
    "actor_email" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_errors" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "url" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "result_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_key" ON "email_verification_tokens"("token");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_security_user_id_key" ON "user_security"("user_id");

-- CreateIndex
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_mandates_workspace_id_user_id_key" ON "client_mandates"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_mandate_invites_token_key" ON "client_mandate_invites"("token");

-- CreateIndex
CREATE INDEX "client_mandate_invites_workspace_id_idx" ON "client_mandate_invites"("workspace_id");

-- CreateIndex
CREATE INDEX "vendors_workspace_id_idx" ON "vendors"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_workspace_id_name_key" ON "vendors"("workspace_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_workspace_id_name_key" ON "cost_centers"("workspace_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "departments_workspace_id_name_key" ON "departments"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "locations_cost_center_id_idx" ON "locations"("cost_center_id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_workspace_id_cost_center_id_name_key" ON "locations"("workspace_id", "cost_center_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "pay_categories_workspace_id_name_key" ON "pay_categories"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "coa_tags_workspace_id_idx" ON "coa_tags"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "coa_tags_pay_category_id_name_key" ON "coa_tags"("pay_category_id", "name");

-- CreateIndex
CREATE INDEX "budgets_workspace_id_period_month_idx" ON "budgets"("workspace_id", "period_month");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_workspace_id_period_month_cost_center_id_coa_tag_id_key" ON "budgets"("workspace_id", "period_month", "cost_center_id", "coa_tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_expenses_workspace_id_name_key" ON "stock_expenses"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "requisitions_workspace_id_status_idx" ON "requisitions"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "requisitions_workspace_id_bundle_id_idx" ON "requisitions"("workspace_id", "bundle_id");

-- CreateIndex
CREATE UNIQUE INDEX "requisitions_workspace_id_req_ref_key" ON "requisitions"("workspace_id", "req_ref");

-- CreateIndex
CREATE UNIQUE INDEX "queue_items_requisition_id_key" ON "queue_items"("requisition_id");

-- CreateIndex
CREATE INDEX "queue_items_workspace_id_status_idx" ON "queue_items"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "queue_items_workspace_id_bundle_id_idx" ON "queue_items"("workspace_id", "bundle_id");

-- CreateIndex
CREATE INDEX "queue_items_workspace_id_vendor_id_idx" ON "queue_items"("workspace_id", "vendor_id");

-- CreateIndex
CREATE INDEX "queue_item_attachments_attachment_group_id_idx" ON "queue_item_attachments"("attachment_group_id");

-- CreateIndex
CREATE INDEX "queue_item_attachments_queue_item_id_idx" ON "queue_item_attachments"("queue_item_id");

-- CreateIndex
CREATE INDEX "queue_item_comments_queue_item_id_idx" ON "queue_item_comments"("queue_item_id");

-- CreateIndex
CREATE INDEX "recurring_payments_workspace_id_is_active_idx" ON "recurring_payments"("workspace_id", "is_active");

-- CreateIndex
CREATE INDEX "batches_workspace_id_payout_status_idx" ON "batches"("workspace_id", "payout_status");

-- CreateIndex
CREATE UNIQUE INDEX "batches_workspace_id_batch_ref_key" ON "batches"("workspace_id", "batch_ref");

-- CreateIndex
CREATE INDEX "batch_items_batch_id_idx" ON "batch_items"("batch_id");

-- CreateIndex
CREATE INDEX "batch_items_queue_item_id_idx" ON "batch_items"("queue_item_id");

-- CreateIndex
CREATE INDEX "batch_items_vendor_id_idx" ON "batch_items"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "batch_item_payouts_reference_key" ON "batch_item_payouts"("reference");

-- CreateIndex
CREATE INDEX "batch_item_payouts_batch_item_id_idx" ON "batch_item_payouts"("batch_item_id");

-- CreateIndex
CREATE INDEX "batch_item_payouts_workspace_id_status_idx" ON "batch_item_payouts"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "wallet_ledger_entries_workspace_id_created_at_idx" ON "wallet_ledger_entries"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_ledger_entries_workspace_id_reference_idx" ON "wallet_ledger_entries"("workspace_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_topups_reference_key" ON "wallet_topups"("reference");

-- CreateIndex
CREATE INDEX "wallet_topups_workspace_id_created_at_idx" ON "wallet_topups"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_sweeps_monnify_reference_key" ON "wallet_sweeps"("monnify_reference");

-- CreateIndex
CREATE UNIQUE INDEX "wht_rates_workspace_id_coa_key" ON "wht_rates"("workspace_id", "coa");

-- CreateIndex
CREATE UNIQUE INDEX "wht_ledger_reference_key" ON "wht_ledger"("reference");

-- CreateIndex
CREATE INDEX "wht_ledger_workspace_id_tax_period_idx" ON "wht_ledger"("workspace_id", "tax_period");

-- CreateIndex
CREATE INDEX "wht_ledger_batch_item_id_idx" ON "wht_ledger"("batch_item_id");

-- CreateIndex
CREATE INDEX "customers_workspace_id_idx" ON "customers"("workspace_id");

-- CreateIndex
CREATE INDEX "customer_credits_workspace_id_customer_id_idx" ON "customer_credits"("workspace_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_collection_account_ref_key" ON "invoices"("collection_account_ref");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_share_token_key" ON "invoices"("share_token");

-- CreateIndex
CREATE INDEX "invoices_workspace_id_status_idx" ON "invoices"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_workspace_id_invoice_number_key" ON "invoices"("workspace_id", "invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_workspace_id_quote_number_key" ON "invoices"("workspace_id", "quote_number");

-- CreateIndex
CREATE INDEX "invoice_payments_invoice_id_idx" ON "invoice_payments"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_recurrences_invoice_id_key" ON "invoice_recurrences"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_recurrences_workspace_id_is_active_idx" ON "invoice_recurrences"("workspace_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_sequences_workspace_id_prefix_key" ON "invoice_sequences"("workspace_id", "prefix");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_sweeps_reference_key" ON "invoice_sweeps"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "products_workspace_id_name_key" ON "products"("workspace_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "billing_plans_tier_key" ON "billing_plans"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_subscriptions_workspace_id_key" ON "workspace_subscriptions"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payments_monnify_reference_key" ON "billing_payments"("monnify_reference");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_dunning_state_workspace_subscription_id_key" ON "subscription_dunning_state"("workspace_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_subscriptions_authorisation_token_key" ON "customer_subscriptions"("authorisation_token");

-- CreateIndex
CREATE INDEX "customer_subscriptions_workspace_id_idx" ON "customer_subscriptions"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_subscription_charges_reference_key" ON "customer_subscription_charges"("reference");

-- CreateIndex
CREATE INDEX "customer_subscription_charges_subscription_id_idx" ON "customer_subscription_charges"("subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_batches_batch_id_key" ON "settlement_batches"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_prefs_workspace_id_user_id_channel_event_key" ON "notification_prefs"("workspace_id", "user_id", "channel", "event");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "email_send_state_to_email_template_key" ON "email_send_state"("to_email", "template");

-- CreateIndex
CREATE UNIQUE INDEX "email_unsubscribe_tokens_token_key" ON "email_unsubscribe_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "suppressed_emails_email_key" ON "suppressed_emails"("email");

-- CreateIndex
CREATE INDEX "audit_log_workspace_id_created_at_idx" ON "audit_log"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_workspace_id_action_idx" ON "audit_log"("workspace_id", "action");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_workspace_id_action_key_key" ON "idempotency_keys"("workspace_id", "action", "key");

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_security" ADD CONSTRAINT "user_security_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_mandates" ADD CONSTRAINT "client_mandates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_mandates" ADD CONSTRAINT "client_mandates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_mandate_invites" ADD CONSTRAINT "client_mandate_invites_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_categories" ADD CONSTRAINT "pay_categories_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coa_tags" ADD CONSTRAINT "coa_tags_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coa_tags" ADD CONSTRAINT "coa_tags_pay_category_id_fkey" FOREIGN KEY ("pay_category_id") REFERENCES "pay_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_coa_tag_id_fkey" FOREIGN KEY ("coa_tag_id") REFERENCES "coa_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_expenses" ADD CONSTRAINT "stock_expenses_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_expenses" ADD CONSTRAINT "stock_expenses_pay_category_id_fkey" FOREIGN KEY ("pay_category_id") REFERENCES "pay_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_expenses" ADD CONSTRAINT "stock_expenses_coa_tag_id_fkey" FOREIGN KEY ("coa_tag_id") REFERENCES "coa_tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_expenses" ADD CONSTRAINT "stock_expenses_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_pay_category_id_fkey" FOREIGN KEY ("pay_category_id") REFERENCES "pay_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_coa_tag_id_fkey" FOREIGN KEY ("coa_tag_id") REFERENCES "coa_tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "requisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_pay_category_id_fkey" FOREIGN KEY ("pay_category_id") REFERENCES "pay_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_coa_tag_id_fkey" FOREIGN KEY ("coa_tag_id") REFERENCES "coa_tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_recurrence_id_fkey" FOREIGN KEY ("recurrence_id") REFERENCES "recurring_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_item_attachments" ADD CONSTRAINT "queue_item_attachments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_item_attachments" ADD CONSTRAINT "queue_item_attachments_queue_item_id_fkey" FOREIGN KEY ("queue_item_id") REFERENCES "queue_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_item_attachments" ADD CONSTRAINT "queue_item_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_item_comments" ADD CONSTRAINT "queue_item_comments_queue_item_id_fkey" FOREIGN KEY ("queue_item_id") REFERENCES "queue_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_item_comments" ADD CONSTRAINT "queue_item_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_pay_category_id_fkey" FOREIGN KEY ("pay_category_id") REFERENCES "pay_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_coa_tag_id_fkey" FOREIGN KEY ("coa_tag_id") REFERENCES "coa_tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_pay_category_id_fkey" FOREIGN KEY ("pay_category_id") REFERENCES "pay_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_queue_item_id_fkey" FOREIGN KEY ("queue_item_id") REFERENCES "queue_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_pay_category_id_fkey" FOREIGN KEY ("pay_category_id") REFERENCES "pay_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_coa_tag_id_fkey" FOREIGN KEY ("coa_tag_id") REFERENCES "coa_tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_item_payouts" ADD CONSTRAINT "batch_item_payouts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_item_payouts" ADD CONSTRAINT "batch_item_payouts_batch_item_id_fkey" FOREIGN KEY ("batch_item_id") REFERENCES "batch_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_topups" ADD CONSTRAINT "wallet_topups_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_sweeps" ADD CONSTRAINT "wallet_sweeps_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_funding_waits" ADD CONSTRAINT "payout_funding_waits_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_funding_waits" ADD CONSTRAINT "payout_funding_waits_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wht_rates" ADD CONSTRAINT "wht_rates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wht_ledger" ADD CONSTRAINT "wht_ledger_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wht_ledger" ADD CONSTRAINT "wht_ledger_batch_item_id_fkey" FOREIGN KEY ("batch_item_id") REFERENCES "batch_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wht_ledger" ADD CONSTRAINT "wht_ledger_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_applied_to_invoice_id_fkey" FOREIGN KEY ("applied_to_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_source_invoice_id_fkey" FOREIGN KEY ("source_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_templates" ADD CONSTRAINT "invoice_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_template_items" ADD CONSTRAINT "invoice_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "invoice_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_template_items" ADD CONSTRAINT "invoice_template_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "invoice_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recurrence_id_fkey" FOREIGN KEY ("recurrence_id") REFERENCES "invoice_recurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_recurrences" ADD CONSTRAINT "invoice_recurrences_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_recurrences" ADD CONSTRAINT "invoice_recurrences_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_recurrences" ADD CONSTRAINT "invoice_recurrences_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_sends" ADD CONSTRAINT "invoice_sends_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_sweeps" ADD CONSTRAINT "invoice_sweeps_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_invoice_payment_id_fkey" FOREIGN KEY ("invoice_payment_id") REFERENCES "invoice_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_billing_plan_id_fkey" FOREIGN KEY ("billing_plan_id") REFERENCES "billing_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_workspace_subscription_id_fkey" FOREIGN KEY ("workspace_subscription_id") REFERENCES "workspace_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_charge_attempts" ADD CONSTRAINT "subscription_charge_attempts_workspace_subscription_id_fkey" FOREIGN KEY ("workspace_subscription_id") REFERENCES "workspace_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_dunning_state" ADD CONSTRAINT "subscription_dunning_state_workspace_subscription_id_fkey" FOREIGN KEY ("workspace_subscription_id") REFERENCES "workspace_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_subscriptions" ADD CONSTRAINT "customer_subscriptions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_subscriptions" ADD CONSTRAINT "customer_subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_subscription_charges" ADD CONSTRAINT "customer_subscription_charges_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "customer_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_batch_items" ADD CONSTRAINT "settlement_batch_items_settlement_batch_id_fkey" FOREIGN KEY ("settlement_batch_id") REFERENCES "settlement_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_config" ADD CONSTRAINT "app_config_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

