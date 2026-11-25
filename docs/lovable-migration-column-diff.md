# Column-by-column diff: Lovable/Supabase `public` schema vs Prisma schema

Generated from `Paid_in_Full_Backend_Migration_Audit_2026-11-20.md` (live snapshot 2026-11-20) and `api/prisma/schema.prisma`.

Legend: **MISSING** = Lovable column with no Prisma equivalent (data would be dropped); **EXTRA** = Prisma column with no Lovable source (needs default/backfill if required); **WARN** = present on both sides but type, nullability or value mapping needs care. "Candidates" are fuzzy name suggestions only — confirm by hand. Table-level mappings: `profiles` -> `users`, `user_roles` -> `workspace_members.role`.

## Summary

| Lovable table | Prisma model | Lovable cols | MISSING | EXTRA | WARN |
| --- | --- | --- | --- | --- | --- |
| app_config | AppConfig | 4 | 1 | 2 | 1 |
| audit_log | AuditLog | 8 | 1 | 3 | 0 |
| batch_item_payouts | BatchItemPayout | 11 | 3 | 11 | 3 |
| batch_items | BatchItem | 40 | 15 | 13 | 10 |
| batches | Batch | 14 | 2 | 9 | 3 |
| billing_payments | BillingPayment | 15 | 13 | 3 | 0 |
| billing_plans | BillingPlan | 14 | 12 | 3 | 0 |
| budgets | Budget | 11 | 5 | 2 | 1 |
| client_errors | ClientError | 12 | 6 | 0 | 0 |
| client_mandate_invites | ClientMandateInvite | 10 | 5 | 3 | 0 |
| client_mandates | ClientMandate | 21 | 18 | 4 | 1 |
| cost_centers | CostCenter | 10 | 5 | 1 | 0 |
| customer_credits | CustomerCredit | 12 | 3 | 1 | 2 |
| customer_subscriptions | CustomerSubscription | 17 | 6 | 11 | 1 |
| customers | Customer | 11 | 1 | 2 | 0 |
| departments | Department | 9 | 6 | 1 | 0 |
| email_send_log | EmailSendLog | 8 | 5 | 2 | 0 |
| email_send_state | EmailSendState | 7 | 6 | 3 | 1 |
| email_unsubscribe_tokens | EmailUnsubscribeToken | 5 | 1 | 0 | 0 |
| goods_receipts | NO TABLE | 13 | 13 | 0 | 0 |
| invoice_items | InvoiceItem | 17 | 8 | 1 | 3 |
| invoice_payments | InvoicePayment | 10 | 7 | 6 | 1 |
| invoice_recurrences | InvoiceRecurrence | 10 | 6 | 11 | 0 |
| invoice_sends | InvoiceSend | 11 | 8 | 3 | 0 |
| invoice_sweeps | InvoiceSweep | 14 | 10 | 3 | 1 |
| invoice_template_items | InvoiceTemplateItem | 12 | 4 | 1 | 0 |
| invoice_templates | InvoiceTemplate | 17 | 10 | 1 | 0 |
| invoices | Invoice | 52 | 11 | 10 | 6 |
| locations | Location | 11 | 5 | 2 | 0 |
| notification_prefs | NotificationPref | 9 | 6 | 3 | 0 |
| pay_categories | PayCategory | 7 | 1 | 2 | 1 |
| payment_receipts | PaymentReceipt | 13 | 11 | 4 | 0 |
| payout_funding_waits | PayoutFundingWait | 8 | 3 | 3 | 1 |
| procurement_approvers | NO TABLE | 6 | 6 | 0 | 0 |
| products | Product | 12 | 2 | 1 | 2 |
| profiles | User | 8 | 0 | 9 | 1 |
| push_subscriptions | PushSubscription | 13 | 8 | 3 | 1 |
| queue_item_attachments | QueueItemAttachment | 9 | 1 | 3 | 0 |
| queue_item_comments | QueueItemComment | 6 | 1 | 1 | 0 |
| queue_items | QueueItem | 32 | 8 | 20 | 7 |
| recurring_payments | RecurringPayment | 15 | 7 | 9 | 1 |
| requisition_approvals | NO TABLE | 7 | 7 | 0 | 0 |
| requisitions | Requisition | 49 | 15 | 9 | 3 |
| settlement_batch_items | SettlementBatchItem | 11 | 8 | 2 | 0 |
| settlement_batches | SettlementBatch | 14 | 11 | 4 | 1 |
| stock_expenses | StockExpense | 13 | 5 | 4 | 0 |
| subscription_charge_attempts | SubscriptionChargeAttempt | 19 | 16 | 3 | 0 |
| subscription_dunning_state | SubscriptionDunningState | 10 | 9 | 4 | 0 |
| suppressed_emails | SuppressedEmail | 5 | 1 | 0 | 0 |
| user_roles | WorkspaceMember | 5 | 1 | 5 | 1 |
| user_security | UserSecurity | 4 | 1 | 7 | 0 |
| vendors | Vendor | 17 | 6 | 9 | 1 |
| wallet_ledger_entries | WalletLedgerEntry | 15 | 3 | 4 | 4 |
| wallet_sweeps | WalletSweep | 10 | 7 | 5 | 0 |
| wallet_topups | WalletTopup | 9 | 3 | 6 | 2 |
| wht_ledger | WhtLedger | 18 | 9 | 2 | 3 |
| wht_rates | WhtRate | 7 | 0 | 0 | 0 |
| workspace_members | WorkspaceMember | 4 | 0 | 5 | 0 |
| workspace_subscriptions | WorkspaceSubscription | 24 | 19 | 2 | 1 |
| workspaces | Workspace | 15 | 7 | 26 | 0 |

Totals: 60 Lovable tables, 800 columns, 378 MISSING, 267 EXTRA, 64 WARN.

Prisma-only tables (no Lovable table): `email_verification_tokens`, `coa_tags`, `invoice_sequences`, `customer_subscription_charges`, `platform_config`, `idempotency_keys`

## `app_config` -> `AppConfig` (app_config)

Lovable columns: 4 · Prisma columns: 5 · matched: 3

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `is_sensitive` — boolean NOT NULL default `true`

**EXTRA in Prisma** (no Lovable source)

- `updated_at` — DateTime · REQUIRED, no default
- `updated_by_id` — String?

**WARN** (matched columns needing care)

- `value`: type text -> Json; NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)

## `audit_log` -> `AuditLog` (audit_log)

Lovable columns: 8 · Prisma columns: 10 · matched: 7

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `actor_user_id` — uuid · candidates: `user_id`

**EXTRA in Prisma** (no Lovable source)

- `user_id` — String?
- `entity_type` — String?
- `entity_id` — String?

## `batch_item_payouts` -> `BatchItemPayout` (batch_item_payouts)

Lovable columns: 11 · Prisma columns: 19 · matched: 8

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `message` — text
- `payout_group_id` — uuid
- `combined_reference` — text · candidates: `transfer_reference`

**EXTRA in Prisma** (no Lovable source)

- `destination_account_number` — String?
- `destination_bank_code` — String?
- `destination_account_name` — String?
- `failure_reason` — String?
- `provider_response` — Json?
- `initiated_by_id` — String?
- `completed_at` — DateTime?
- `transfer_reference` — String?
- `client_request_id` — String?
- `status_checked_at` — DateTime?
- `updated_at` — DateTime · REQUIRED, no default

**WARN** (matched columns needing care)

- `amount`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)
- `status`: text -> enum PayoutStatus (PENDING, PROCESSING, SUCCESS, FAILED, REVERSED) — map values
- `leg`: text -> enum PayoutLeg (VENDOR, WHT) — map values

## `batch_items` -> `BatchItem` (batch_items)

Lovable columns: 40 · Prisma columns: 38 · matched: 25

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `category` — text · candidates: `pay_category`, `pay_category_id`
- `coa` — text · candidates: `coa_tag`
- `unit_amt` — numeric · candidates: `unit_amount`, `updated_at`
- `status` — text NOT NULL default `'Disbursed'::text`
- `workspace_id` — uuid · candidates: `pay_category_id`
- `outstanding` — numeric default `GREATEST((COALESCE(total, (0)::numeric) - COALESCE(paid_amount, (0)::numeric)), (0)::numeric)`
- `created_by` — uuid · candidates: `created_at`, `returned_by_id`
- `attachment_group_id` — uuid
- `requisition_id` — uuid · candidates: `queue_item_id`, `returned_by_id`
- `queued_at` — timestamp with time zone · candidates: `returned_at`, `queue_item_id`
- `approved_by` — uuid
- `approved_at` — timestamp with time zone · candidates: `updated_at`, `retried_at`
- `paid_by` — uuid
- `pay_started_at` — timestamp with time zone · candidates: `updated_at`, `retried_at`
- `paid_at` — timestamp with time zone · candidates: `updated_at`, `retried_at`

**EXTRA in Prisma** (no Lovable source)

- `queue_item_id` — String?
- `vendor_acct_name` — String?
- `unit_amount` — Decimal
- `pay_category_id` — String?
- `pay_category` — String?
- `coa_tag_id` — String?
- `coa_tag` — String?
- `is_manual` — Boolean
- `returned_at` — DateTime?
- `returned_by_id` — String?
- `retried_at` — DateTime?
- `created_at` — DateTime
- `updated_at` — DateTime · REQUIRED, no default

**WARN** (matched columns needing care)

- `date`: NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)
- `vendor_name`: NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)
- `description`: NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)
- `units`: unconstrained numeric -> Decimal(12, 3) (check overflow/rounding); NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)
- `total`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding); NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)
- `vendor_id`: NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)
- `payout_status`: text -> enum BatchItemPayoutStatus (PENDING, SENDING, SUCCESS, FAILED, REVERSED, CANCELLED, SKIPPED) — map values
- `paid_amount`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)
- `wht_amount`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)
- `net_amount`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)

## `batches` -> `Batch` (batches)

Lovable columns: 14 · Prisma columns: 21 · matched: 12

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `payout_batch_reference` — text
- `cancelled_by` — uuid · candidates: `cancelled_by_id`, `created_by_id`

**EXTRA in Prisma** (no Lovable source)

- `pay_category_id` — String?
- `is_manual` — Boolean
- `created_by_id` — String · REQUIRED, no default
- `approved_by_id` — String?
- `approved_by_name` — String?
- `approved_at` — DateTime?
- `disbursed_at` — DateTime?
- `cancelled_by_id` — String?
- `updated_at` — DateTime · REQUIRED, no default

**WARN** (matched columns needing care)

- `total`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)
- `payout_status`: text -> enum BatchPayoutStatus (PENDING, PROCESSING, PARTIAL, SUCCESS, CANCELLED) — map values
- `workspace_id`: NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)

## `billing_payments` -> `BillingPayment` (billing_payments)

Lovable columns: 15 · Prisma columns: 5 · matched: 2

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `workspace_id` — uuid NOT NULL · candidates: `workspace_subscription_id`
- `plan_id` — uuid · candidates: `paid_at`
- `currency` — text NOT NULL default `'NGN'::text`
- `months_covered` — integer NOT NULL default `1`
- `covers_setup_fee` — boolean NOT NULL default `false`
- `payment_reference` — text · candidates: `monnify_reference`
- `payer_name` — text
- `payer_bank` — text
- `payer_acct_no` — text · candidates: `paid_at`
- `collection_account_number` — text
- `monnify_event` — jsonb · candidates: `monnify_reference`
- `applied_at` — timestamp with time zone NOT NULL default `now()` · candidates: `paid_at`
- `created_at` — timestamp with time zone NOT NULL default `now()` · candidates: `paid_at`

**EXTRA in Prisma** (no Lovable source)

- `workspace_subscription_id` — String · REQUIRED, no default
- `monnify_reference` — String?
- `paid_at` — DateTime

## `billing_plans` -> `BillingPlan` (billing_plans)

Lovable columns: 14 · Prisma columns: 5 · matched: 2

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `code` — text NOT NULL
- `product_type` — text NOT NULL
- `description` — text
- `monthly_amount` — numeric(14,2) NOT NULL default `0` · candidates: `price_monthly`
- `prepay_months` — integer · candidates: `price_monthly`
- `prepay_monthly_amount` — numeric(14,2) · candidates: `price_monthly`
- `setup_fee` — numeric(14,2) NOT NULL default `0`
- `currency` — text NOT NULL default `'NGN'::text`
- `is_active` — boolean NOT NULL default `true`
- `sort_order` — integer NOT NULL default `0`
- `created_at` — timestamp with time zone NOT NULL default `now()`
- `updated_at` — timestamp with time zone NOT NULL default `now()`

**EXTRA in Prisma** (no Lovable source)

- `tier` — enum:PlanTier · REQUIRED, no default
- `price_monthly` — Decimal · REQUIRED, no default
- `features` — Json · REQUIRED, no default

## `budgets` -> `Budget` (budgets)

Lovable columns: 11 · Prisma columns: 8 · matched: 6

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `pay_cat_id` — uuid · candidates: `coa_tag_id`
- `amount` — numeric NOT NULL default `0` · candidates: `monthly_amount`
- `period_type` — text NOT NULL default `'monthly'::text`
- `coa_tag` — text · candidates: `coa_tag_id`
- `location_id` — uuid

**EXTRA in Prisma** (no Lovable source)

- `coa_tag_id` — String · REQUIRED, no default
- `monthly_amount` — Decimal · REQUIRED, no default

**WARN** (matched columns needing care)

- `period_month`: type date -> String

## `client_errors` -> `ClientError` (client_errors)

Lovable columns: 12 · Prisma columns: 6 · matched: 6

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `source` — text
- `workspace_id` — uuid
- `user_id` — uuid
- `user_email` — text
- `severity` — text NOT NULL default `'error'::text`
- `metadata` — jsonb

## `client_mandate_invites` -> `ClientMandateInvite` (client_mandate_invites)

Lovable columns: 10 · Prisma columns: 8 · matched: 5

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `customer_id` — uuid NOT NULL
- `subscription_id` — uuid
- `used_at` — timestamp with time zone
- `mandate_id` — uuid
- `created_by` — uuid

**EXTRA in Prisma** (no Lovable source)

- `email` — String · REQUIRED, no default
- `role` — enum:WorkspaceRole
- `status` — enum:MandateStatus

## `client_mandates` -> `ClientMandate` (client_mandates)

Lovable columns: 21 · Prisma columns: 7 · matched: 3

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `customer_id` — uuid · candidates: `user_id`
- `subscription_id` — uuid · candidates: `user_id`
- `type` — mandate_type NOT NULL
- `provider` — text NOT NULL default `'monnify'::text` · candidates: `role`
- `provider_mandate_code` — text
- `provider_card_token` — text
- `card_last4` — text · candidates: `revoked_at`, `granted_at`
- `card_brand` — text
- `bank_code` — text
- `bank_name` — text
- `account_number_masked` — text
- `authorization_url` — text
- `authorized_at` — timestamp with time zone · candidates: `revoked_at`, `granted_at`
- `expires_at` — timestamp with time zone · candidates: `revoked_at`, `granted_at`
- `last_charged_at` — timestamp with time zone
- `metadata` — jsonb NOT NULL default `'{}'::jsonb`
- `created_at` — timestamp with time zone NOT NULL default `now()` · candidates: `granted_at`, `revoked_at`
- `updated_at` — timestamp with time zone NOT NULL default `now()` · candidates: `granted_at`, `revoked_at`

**EXTRA in Prisma** (no Lovable source)

- `user_id` — String · REQUIRED, no default
- `role` — enum:WorkspaceRole
- `granted_at` — DateTime
- `revoked_at` — DateTime?

**WARN** (matched columns needing care)

- `status`: mandate_status -> enum:MandateStatus

## `cost_centers` -> `CostCenter` (cost_centers)

Lovable columns: 10 · Prisma columns: 6 · matched: 5

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `color` — text NOT NULL default `'#F4B942'::text`
- `active` — boolean NOT NULL default `true` · candidates: `is_active`
- `created_at` — timestamp with time zone NOT NULL default `now()`
- `updated_at` — timestamp with time zone NOT NULL default `now()`
- `has_locations` — boolean NOT NULL default `false`

**EXTRA in Prisma** (no Lovable source)

- `is_active` — Boolean

## `customer_credits` -> `CustomerCredit` (customer_credits)

Lovable columns: 12 · Prisma columns: 10 · matched: 9

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `currency` — text NOT NULL default `'NGN'::text`
- `created_by` — uuid
- `updated_at` — timestamp with time zone NOT NULL default `now()` · candidates: `applied_at`

**EXTRA in Prisma** (no Lovable source)

- `applied_at` — DateTime?

**WARN** (matched columns needing care)

- `amount`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)
- `status`: text -> enum CreditStatus (OPEN, APPLIED, REFUNDED) — map values

## `customer_subscriptions` -> `CustomerSubscription` (customer_subscriptions)

Lovable columns: 17 · Prisma columns: 22 · matched: 11

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `currency` — text NOT NULL default `'NGN'::text`
- `frequency` — text NOT NULL default `'monthly'::text`
- `billing_day` — smallint
- `start_date` — date NOT NULL default `CURRENT_DATE` · candidates: `is_active`, `mandate_id`
- `next_charge_date` — date · candidates: `next_run_at`
- `created_by` — uuid

**EXTRA in Prisma** (no Lovable source)

- `interval` — enum:RecurrenceInterval · REQUIRED, no default
- `authorisation_token` — String?
- `mandate_type` — enum:MandateType?
- `mandate_id` — String?
- `mandate_reference` — String?
- `card_last4` — String?
- `card_token` — String?
- `mandate_details` — Json?
- `next_run_at` — DateTime · REQUIRED, no default
- `authorised_at` — DateTime?
- `is_active` — Boolean

**WARN** (matched columns needing care)

- `status`: text -> enum CustomerSubscriptionStatus (PENDING_MANDATE, ACTIVE, CANCELLED) — map values

## `customers` -> `Customer` (customers)

Lovable columns: 11 · Prisma columns: 12 · matched: 10

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `archived` — boolean NOT NULL default `false` · candidates: `is_archived`

**EXTRA in Prisma** (no Lovable source)

- `is_archived` — Boolean
- `merged_into_id` — String?

## `departments` -> `Department` (departments)

Lovable columns: 9 · Prisma columns: 4 · matched: 3

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `hod_user_id` — uuid
- `hod_name` — text
- `active` — boolean NOT NULL default `true` · candidates: `is_active`
- `sort_order` — integer NOT NULL default `0`
- `created_at` — timestamp with time zone NOT NULL default `now()`
- `updated_at` — timestamp with time zone NOT NULL default `now()`

**EXTRA in Prisma** (no Lovable source)

- `is_active` — Boolean

## `email_send_log` -> `EmailSendLog` (email_send_log)

Lovable columns: 8 · Prisma columns: 5 · matched: 3

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `message_id` — text
- `template_name` — text NOT NULL · candidates: `template`
- `recipient_email` — text NOT NULL · candidates: `to_email`
- `error_message` — text
- `metadata` — jsonb

**EXTRA in Prisma** (no Lovable source)

- `to_email` — String · REQUIRED, no default
- `template` — String · REQUIRED, no default

## `email_send_state` -> `EmailSendState` (email_send_state)

Lovable columns: 7 · Prisma columns: 4 · matched: 1

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `retry_after_until` — timestamp with time zone
- `batch_size` — integer NOT NULL default `10`
- `send_delay_ms` — integer NOT NULL default `200`
- `auth_email_ttl_minutes` — integer NOT NULL default `15` · candidates: `to_email`
- `transactional_email_ttl_minutes` — integer NOT NULL default `60` · candidates: `to_email`
- `updated_at` — timestamp with time zone NOT NULL default `now()` · candidates: `last_sent_at`

**EXTRA in Prisma** (no Lovable source)

- `to_email` — String · REQUIRED, no default
- `template` — String · REQUIRED, no default
- `last_sent_at` — DateTime · REQUIRED, no default

**WARN** (matched columns needing care)

- `id`: type integer -> String

## `email_unsubscribe_tokens` -> `EmailUnsubscribeToken` (email_unsubscribe_tokens)

Lovable columns: 5 · Prisma columns: 4 · matched: 4

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `used_at` — timestamp with time zone

## `goods_receipts` — NO PRISMA TABLE

Lovable columns (13): `id`, `workspace_id`, `requisition_id`, `kind`, `received_qty`, `condition`, `notes`, `first_by`, `first_at`, `second_by`, `second_at`, `created_at`, `updated_at`

## `invoice_items` -> `InvoiceItem` (invoice_items)

Lovable columns: 17 · Prisma columns: 10 · matched: 9

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `workspace_id` — uuid NOT NULL
- `created_at` — timestamp with time zone NOT NULL default `now()`
- `vat_amount` — numeric(18,2) NOT NULL default `0`
- `wht_amount` — numeric(18,2) NOT NULL default `0`
- `discount_type` — text
- `discount_value` — numeric(18,2) NOT NULL default `0`
- `discount_amount` — numeric(18,2) NOT NULL default `0`
- `tax_inclusive` — boolean NOT NULL default `false`

**EXTRA in Prisma** (no Lovable source)

- `product_id` — String?

**WARN** (matched columns needing care)

- `quantity`: unconstrained numeric -> Decimal(10, 2) (check overflow/rounding)
- `unit_price`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)
- `line_total`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)

## `invoice_payments` -> `InvoicePayment` (invoice_payments)

Lovable columns: 10 · Prisma columns: 9 · matched: 3

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `workspace_id` — uuid NOT NULL
- `payment_reference` — text NOT NULL · candidates: `monnify_reference`
- `payer_name` — text
- `payer_bank` — text
- `payer_acct_no` — text · candidates: `paid_at`
- `raw_payload` — jsonb
- `created_at` — timestamp with time zone NOT NULL default `now()` · candidates: `settled_at`, `paid_at`

**EXTRA in Prisma** (no Lovable source)

- `monnify_reference` — String?
- `method` — String?
- `notes` — String?
- `paid_at` — DateTime
- `settled_at` — DateTime?
- `recorded_by_id` — String?

**WARN** (matched columns needing care)

- `amount`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)

## `invoice_recurrences` -> `InvoiceRecurrence` (invoice_recurrences)

Lovable columns: 10 · Prisma columns: 15 · matched: 4

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `cadence` — text NOT NULL default `'monthly'::text` · candidates: `currency`
- `next_run_date` — date NOT NULL · candidates: `next_run_at`, `last_run_at`
- `end_date` — date · candidates: `ends_at`, `due_days`
- `active` — boolean NOT NULL default `true` · candidates: `is_active`
- `template` — jsonb NOT NULL default `'{}'::jsonb` · candidates: `template_items`
- `updated_at` — timestamp with time zone NOT NULL default `now()` · candidates: `ends_at`, `template_items`

**EXTRA in Prisma** (no Lovable source)

- `invoice_id` — String?
- `interval` — enum:RecurrenceInterval · REQUIRED, no default
- `next_run_at` — DateTime · REQUIRED, no default
- `ends_at` — DateTime?
- `due_days` — Int
- `currency` — String
- `notes` — String?
- `terms` — String?
- `template_items` — Json?
- `last_run_at` — DateTime?
- `is_active` — Boolean

## `invoice_sends` -> `InvoiceSend` (invoice_sends)

Lovable columns: 11 · Prisma columns: 6 · matched: 3

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `workspace_id` — uuid NOT NULL
- `recipient` — text NOT NULL
- `status` — text NOT NULL default `'sent'::text` · candidates: `sent_at`
- `message` — text
- `error` — text
- `provider_message_id` — text
- `sent_by` — uuid · candidates: `sent_to`, `sent_at`
- `created_at` — timestamp with time zone NOT NULL default `now()` · candidates: `sent_at`

**EXTRA in Prisma** (no Lovable source)

- `sent_to` — String · REQUIRED, no default
- `cc` — String?
- `sent_at` — DateTime

## `invoice_sweeps` -> `InvoiceSweep` (invoice_sweeps)

Lovable columns: 14 · Prisma columns: 7 · matched: 4

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `workspace_id` — uuid NOT NULL
- `monnify_reference` — text NOT NULL · candidates: `reference`, `sheet_row_reference`
- `destination_bank_code` — text
- `destination_bank_name` — text
- `destination_acct_no` — text
- `destination_acct_name` — text
- `message` — text
- `provider_response` — jsonb
- `created_at` — timestamp with time zone NOT NULL default `now()` · candidates: `matched_at`
- `updated_at` — timestamp with time zone NOT NULL default `now()` · candidates: `matched_at`

**EXTRA in Prisma** (no Lovable source)

- `sheet_row_reference` — String?
- `reference` — String?
- `matched_at` — DateTime

**WARN** (matched columns needing care)

- `amount`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)

## `invoice_template_items` -> `InvoiceTemplateItem` (invoice_template_items)

Lovable columns: 12 · Prisma columns: 9 · matched: 8

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `workspace_id` — uuid NOT NULL
- `discount_type` — text
- `discount_value` — numeric(14,2)
- `created_at` — timestamp with time zone NOT NULL default `now()`

**EXTRA in Prisma** (no Lovable source)

- `product_id` — String?

## `invoice_templates` -> `InvoiceTemplate` (invoice_templates)

Lovable columns: 17 · Prisma columns: 8 · matched: 7

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `tax_inclusive` — boolean NOT NULL default `false`
- `default_vat_rate` — numeric(6,3) NOT NULL default `7.5`
- `default_wht_rate` — numeric(6,3) NOT NULL default `0`
- `late_fee_percent` — numeric(6,3)
- `late_fee_flat` — numeric(14,2)
- `late_fee_grace_days` — integer
- `early_pay_discount_percent` — numeric(6,3)
- `early_pay_discount_days` — integer
- `created_by` — uuid
- `updated_at` — timestamp with time zone NOT NULL default `now()`

**EXTRA in Prisma** (no Lovable source)

- `settings` — Json?

## `invoices` -> `Invoice` (invoices)

Lovable columns: 52 · Prisma columns: 51 · matched: 41

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `tax_rate` — numeric NOT NULL default `0`
- `tax_amount` — numeric NOT NULL default `0` · candidates: `late_fee_amount`
- `paid_at` — timestamp with time zone · candidates: `voided_at`
- `created_by` — uuid default `auth.uid()` · candidates: `created_by_id`
- `collection_account_reference` — text · candidates: `collection_account_ref`
- `collection_provisioned_at` — timestamp with time zone · candidates: `collection_account_ref`
- `share_token_created_at` — timestamp with time zone default `now()` · candidates: `created_by_id`
- `converted_from_id` — uuid · candidates: `converted_from_quote_id`, `created_by_id`
- `converted_at` — timestamp with time zone · candidates: `converted_from_quote_id`, `voided_at`
- `fx_locked_at` — timestamp with time zone · candidates: `voided_at`
- `cc_emails` — text[] NOT NULL default `'{}'::text[]`

**EXTRA in Prisma** (no Lovable source)

- `converted_from_quote_id` — String?
- `due_days` — Int?
- `late_fee_amount` — Decimal
- `late_fee_applied_at` — DateTime?
- `early_pay_discount_amount` — Decimal
- `template_id` — String?
- `collection_account_ref` — String?
- `voided_at` — DateTime?
- `created_by_id` — String?
- `synced_to_sheets` — Boolean

**WARN** (matched columns needing care)

- `status`: text -> enum InvoiceStatus (DRAFT, SENT, PARTIALLY_PAID, PAID, OVERDUE, VOID) — map values
- `subtotal`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)
- `total`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)
- `paid_amount`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)
- `doc_type`: text -> enum InvoiceDocType (INVOICE, QUOTE) — map values
- `discount_type`: text -> enum DiscountType (PERCENT, FLAT) — map values

## `locations` -> `Location` (locations)

Lovable columns: 11 · Prisma columns: 8 · matched: 6

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `code` — text
- `color` — text NOT NULL default `'#F4B942'::text`
- `active` — boolean NOT NULL default `true` · candidates: `is_active`
- `created_at` — timestamp with time zone NOT NULL default `now()`
- `updated_at` — timestamp with time zone NOT NULL default `now()`

**EXTRA in Prisma** (no Lovable source)

- `address` — String?
- `is_active` — Boolean

## `notification_prefs` -> `NotificationPref` (notification_prefs)

Lovable columns: 9 · Prisma columns: 6 · matched: 3

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `queue_added` — boolean NOT NULL default `true`
- `batch_pending_approval` — boolean NOT NULL default `true`
- `disbursement_result` — boolean NOT NULL default `true`
- `email_channel` — boolean NOT NULL default `false` · candidates: `channel`
- `in_app_channel` — boolean NOT NULL default `true` · candidates: `channel`
- `updated_at` — timestamp with time zone NOT NULL default `now()`

**EXTRA in Prisma** (no Lovable source)

- `channel` — String · REQUIRED, no default
- `event` — String · REQUIRED, no default
- `is_enabled` — Boolean

## `pay_categories` -> `PayCategory` (pay_categories)

Lovable columns: 7 · Prisma columns: 8 · matched: 6

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `created_at` — timestamp with time zone NOT NULL default `now()`

**EXTRA in Prisma** (no Lovable source)

- `code` — String?
- `is_active` — Boolean

**WARN** (matched columns needing care)

- `workspace_id`: NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)

## `payment_receipts` -> `PaymentReceipt` (payment_receipts)

Lovable columns: 13 · Prisma columns: 6 · matched: 2

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `workspace_id` — uuid NOT NULL · candidates: `invoice_id`
- `batch_item_id` — uuid NOT NULL
- `vendor_id` — uuid · candidates: `invoice_id`
- `channel` — text NOT NULL
- `to_address` — text NOT NULL
- `status` — text NOT NULL default `'sent'::text`
- `provider` — text NOT NULL default `'termii'::text`
- `provider_message_id` — text
- `message` — text
- `error` — text
- `sent_by` — uuid

**EXTRA in Prisma** (no Lovable source)

- `invoice_id` — String · REQUIRED, no default
- `invoice_payment_id` — String?
- `receipt_number` — String · REQUIRED, no default
- `pdf_url` — String?

## `payout_funding_waits` -> `PayoutFundingWait` (payout_funding_waits)

Lovable columns: 8 · Prisma columns: 8 · matched: 5

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `amount_required` — numeric NOT NULL · candidates: `required_amount`
- `ready_at_block` — numeric NOT NULL default `0`
- `notified_at` — timestamp with time zone

**EXTRA in Prisma** (no Lovable source)

- `required_amount` — Decimal · REQUIRED, no default
- `available_amount` — Decimal · REQUIRED, no default
- `status` — enum:FundingWaitStatus

**WARN** (matched columns needing care)

- `batch_id`: NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)

## `procurement_approvers` — NO PRISMA TABLE

Lovable columns (6): `id`, `workspace_id`, `user_id`, `approval_role`, `created_by`, `created_at`

## `products` -> `Product` (products)

Lovable columns: 12 · Prisma columns: 11 · matched: 10

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `active` — boolean NOT NULL default `true` · candidates: `is_active`
- `created_by` — uuid

**EXTRA in Prisma** (no Lovable source)

- `is_active` — Boolean

**WARN** (matched columns needing care)

- `unit_price`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)
- `tax_rate`: unconstrained numeric -> Decimal(5, 2) (check overflow/rounding); NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)

## `profiles` -> `User` (users)

Lovable columns: 8 · Prisma columns: 17 · matched: 8

**EXTRA in Prisma** (no Lovable source)

- `password_hash` — String · REQUIRED, no default
- `first_name` — String · REQUIRED, no default
- `last_name` — String · REQUIRED, no default
- `phone` — String?
- `is_email_verified` — Boolean
- `is_active` — Boolean
- `platform_role` — enum:PlatformRole?
- `google_sub` — String?
- `has_password` — Boolean

**WARN** (matched columns needing care)

- `email`: NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)

## `push_subscriptions` -> `PushSubscription` (push_subscriptions)

Lovable columns: 13 · Prisma columns: 8 · matched: 5

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `p256dh` — text NOT NULL · candidates: `p256dh_key`
- `auth` — text NOT NULL · candidates: `auth_key`
- `user_agent` — text
- `label` — text
- `last_success_at` — timestamp with time zone
- `last_error` — text · candidates: `platform`
- `last_error_at` — timestamp with time zone
- `updated_at` — timestamp with time zone NOT NULL default `now()`

**EXTRA in Prisma** (no Lovable source)

- `platform` — enum:PushPlatform
- `p256dh_key` — String · REQUIRED, no default
- `auth_key` — String · REQUIRED, no default

**WARN** (matched columns needing care)

- `workspace_id`: NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)

## `queue_item_attachments` -> `QueueItemAttachment` (queue_item_attachments)

Lovable columns: 9 · Prisma columns: 11 · matched: 8

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `uploaded_by` — uuid · candidates: `uploaded_by_id`

**EXTRA in Prisma** (no Lovable source)

- `queue_item_id` — String?
- `file_url` — String?
- `uploaded_by_id` — String · REQUIRED, no default

## `queue_item_comments` -> `QueueItemComment` (queue_item_comments)

Lovable columns: 6 · Prisma columns: 6 · matched: 5

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `workspace_id` — uuid NOT NULL

**EXTRA in Prisma** (no Lovable source)

- `author_name` — String?

## `queue_items` -> `QueueItem` (queue_items)

Lovable columns: 32 · Prisma columns: 44 · matched: 24

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `pay_cat_id` — uuid · candidates: `pay_category_id`, `pay_category`
- `pay_cat_name` — text · candidates: `pay_category`, `pay_category_id`
- `coa` — text · candidates: `coa_tag`
- `unit_amt` — numeric NOT NULL default `0` · candidates: `unit_amount`, `updated_at`
- `budget_tag` — text default `''::text` · candidates: `budget_flag`
- `created_by` — uuid default `auth.uid()` · candidates: `created_by_id`, `created_by_name`
- `rejected_by` — uuid · candidates: `rejected_by_id`, `created_by_id`
- `recurring_payment_id` — uuid · candidates: `recurrence_id`

**EXTRA in Prisma** (no Lovable source)

- `unit_amount` — Decimal
- `wht_override` — Boolean
- `wht_source` — String?
- `pay_category_id` — String?
- `pay_category` — String?
- `coa_tag_id` — String?
- `coa_tag` — String?
- `recurrence_id` — String?
- `source_invoice_id` — String?
- `invoice_number` — String?
- `invoice_date` — DateTime?
- `budget_flag` — Boolean
- `created_by_id` — String · REQUIRED, no default
- `created_by_name` — String?
- `requested_by_name` — String?
- `approved_at` — DateTime?
- `approved_by_id` — String?
- `rejected_by_id` — String?
- `synced_to_sheets` — Boolean
- `updated_at` — DateTime · REQUIRED, no default

**WARN** (matched columns needing care)

- `vendor_id`: NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)
- `units`: unconstrained numeric -> Decimal(12, 3) (check overflow/rounding)
- `total`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding); NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)
- `workspace_id`: NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)
- `status`: text -> enum QueueItemStatus (PENDING, APPROVED, REJECTED, CANCELLED) — map values
- `wht_amount`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)
- `net_amount`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)

## `recurring_payments` -> `RecurringPayment` (recurring_payments)

Lovable columns: 15 · Prisma columns: 17 · matched: 8

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `vendor_name` — text NOT NULL
- `pay_cat_id` — uuid · candidates: `pay_category_id`, `coa_tag_id`
- `pay_cat_name` — text · candidates: `pay_category_id`
- `lead_days` — integer NOT NULL default `7`
- `active` — boolean NOT NULL default `true` · candidates: `is_active`
- `last_queued_for` — date · candidates: `last_charged_at`
- `created_by` — uuid default `auth.uid()` · candidates: `created_by_id`, `updated_at`

**EXTRA in Prisma** (no Lovable source)

- `pay_category_id` — String?
- `coa_tag_id` — String?
- `cost_center_id` — String?
- `location_id` — String?
- `is_active` — Boolean
- `last_charged_at` — DateTime?
- `next_run_date` — DateTime?
- `created_by_id` — String?
- `updated_at` — DateTime · REQUIRED, no default

**WARN** (matched columns needing care)

- `amount`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)

## `requisition_approvals` — NO PRISMA TABLE

Lovable columns (7): `id`, `workspace_id`, `requisition_id`, `approval_round`, `approver_user_id`, `approval_role`, `created_at`

## `requisitions` -> `Requisition` (requisitions)

Lovable columns: 49 · Prisma columns: 43 · matched: 34

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `hod_name` — text
- `requester_user_id` — uuid · candidates: `requested_by_id`, `rejected_by_id`
- `staff_account_note` — text
- `unit_amt` — numeric NOT NULL default `0` · candidates: `unit_amount`
- `coa` — text · candidates: `coa_tag_id`
- `pay_cat_id` — uuid · candidates: `pay_category_id`, `coa_tag_id`
- `pnl_period` — text
- `cleared_by` — uuid · candidates: `cleared_by_id`, `queued_by_id`
- `returned_by` — uuid · candidates: `returned_by_id`, `rejected_by_id`
- `rejected_by` — uuid · candidates: `rejected_by_id`, `requested_by_id`
- `queued_by` — uuid · candidates: `queued_by_id`, `requested_by_id`
- `queue_item_id` — uuid · candidates: `queued_by_id`, `requested_by_id`
- `final_approved_by` — uuid · candidates: `cleared_by_id`
- `final_approved_at` — timestamp with time zone
- `approval_round` — integer NOT NULL default `0`

**EXTRA in Prisma** (no Lovable source)

- `requested_by_id` — String · REQUIRED, no default
- `unit_amount` — Decimal
- `pay_category_id` — String?
- `coa_tag_id` — String?
- `cleared_by_id` — String?
- `returned_by_id` — String?
- `rejected_by_id` — String?
- `rejection_reason` — String?
- `queued_by_id` — String?

**WARN** (matched columns needing care)

- `units`: unconstrained numeric -> Decimal(12, 3) (check overflow/rounding)
- `total`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding); NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)
- `status`: text -> enum RequisitionStatus (DRAFT, SUBMITTED, PROCUREMENT_CLEARED, RETURNED, QUEUED, REJECTED) — map values

## `settlement_batch_items` -> `SettlementBatchItem` (settlement_batch_items)

Lovable columns: 11 · Prisma columns: 5 · matched: 3

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `charge_attempt_id` — uuid
- `workspace_id` — uuid
- `customer_name` — text
- `provider_reference` — text
- `fee` — numeric(14,2) NOT NULL default `0`
- `net` — numeric(14,2) NOT NULL
- `raw` — jsonb NOT NULL default `'{}'::jsonb`
- `created_at` — timestamp with time zone NOT NULL default `now()`

**EXTRA in Prisma** (no Lovable source)

- `batch_item_payout_ref` — String · REQUIRED, no default
- `status` — enum:SettlementItemStatus

## `settlement_batches` -> `SettlementBatch` (settlement_batches)

Lovable columns: 14 · Prisma columns: 7 · matched: 3

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `provider` — text NOT NULL default `'monnify'::text`
- `provider_batch_ref` — text NOT NULL · candidates: `batch_id`, `monnify_settlement_ref`
- `gross_amount` — numeric(14,2) NOT NULL · candidates: `settled_amount`, `expected_amount`
- `fee_amount` — numeric(14,2) NOT NULL default `0` · candidates: `settled_amount`, `expected_amount`
- `net_amount` — numeric(14,2) NOT NULL · candidates: `settled_amount`, `expected_amount`
- `destination_account` — text · candidates: `settled_amount`
- `destination_bank` — text
- `currency` — text NOT NULL default `'NGN'::text`
- `raw` — jsonb NOT NULL default `'{}'::jsonb`
- `created_at` — timestamp with time zone NOT NULL default `now()` · candidates: `settled_amount`, `expected_amount`
- `updated_at` — timestamp with time zone NOT NULL default `now()` · candidates: `expected_amount`, `settled_amount`

**EXTRA in Prisma** (no Lovable source)

- `batch_id` — String · REQUIRED, no default
- `monnify_settlement_ref` — String?
- `expected_amount` — Decimal · REQUIRED, no default
- `settled_amount` — Decimal?

**WARN** (matched columns needing care)

- `workspace_id`: NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)

## `stock_expenses` -> `StockExpense` (stock_expenses)

Lovable columns: 13 · Prisma columns: 12 · matched: 8

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `unit_amt` — numeric NOT NULL default `0` · candidates: `unit_amount`
- `coa` — text · candidates: `coa_tag_id`
- `pay_cat_id` — uuid · candidates: `pay_category_id`, `coa_tag_id`
- `active` — boolean NOT NULL default `true` · candidates: `is_active`
- `created_by` — uuid

**EXTRA in Prisma** (no Lovable source)

- `pay_category_id` — String?
- `coa_tag_id` — String?
- `unit_amount` — Decimal
- `is_active` — Boolean

## `subscription_charge_attempts` -> `SubscriptionChargeAttempt` (subscription_charge_attempts)

Lovable columns: 19 · Prisma columns: 6 · matched: 3

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `workspace_id` — uuid NOT NULL · candidates: `workspace_subscription_id`
- `subscription_id` — uuid NOT NULL · candidates: `workspace_subscription_id`
- `mandate_id` — uuid
- `attempt_no` — integer NOT NULL default `1`
- `status` — charge_attempt_status NOT NULL default `'pending'::charge_attempt_status`
- `provider_reference` — text
- `fee` — numeric(14,2)
- `net_amount` — numeric(14,2)
- `currency` — text NOT NULL default `'NGN'::text`
- `failure_code` — text · candidates: `failure_reason`
- `failure_message` — text · candidates: `failure_reason`
- `succeeded_at` — timestamp with time zone · candidates: `succeeded`
- `settled_at` — timestamp with time zone
- `metadata` — jsonb NOT NULL default `'{}'::jsonb`
- `created_at` — timestamp with time zone NOT NULL default `now()`
- `updated_at` — timestamp with time zone NOT NULL default `now()`

**EXTRA in Prisma** (no Lovable source)

- `workspace_subscription_id` — String · REQUIRED, no default
- `succeeded` — Boolean
- `failure_reason` — String?

## `subscription_dunning_state` -> `SubscriptionDunningState` (subscription_dunning_state)

Lovable columns: 10 · Prisma columns: 5 · matched: 1

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `subscription_id` — uuid NOT NULL · candidates: `workspace_subscription_id`
- `workspace_id` — uuid NOT NULL · candidates: `workspace_subscription_id`
- `grace_started_at` — timestamp with time zone NOT NULL default `now()`
- `last_reminder_sent_at` — timestamp with time zone
- `reminders_sent` — integer NOT NULL default `0`
- `retries_attempted` — integer NOT NULL default `0`
- `resolved_at` — timestamp with time zone
- `created_at` — timestamp with time zone NOT NULL default `now()` · candidates: `next_retry_at`
- `updated_at` — timestamp with time zone NOT NULL default `now()`

**EXTRA in Prisma** (no Lovable source)

- `id` — String
- `workspace_subscription_id` — String · REQUIRED, no default
- `consecutive_failures` — Int
- `next_retry_at` — DateTime?

## `suppressed_emails` -> `SuppressedEmail` (suppressed_emails)

Lovable columns: 5 · Prisma columns: 4 · matched: 4

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `metadata` — jsonb

## `user_roles` -> `WorkspaceMember` (workspace_members)

Lovable columns: 5 · Prisma columns: 9 · matched: 4

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `created_at` — timestamp with time zone NOT NULL default `now()` · candidates: `invited_at`, `joined_at`

**EXTRA in Prisma** (no Lovable source)

- `is_biller` — Boolean
- `is_active` — Boolean
- `invited_at` — DateTime
- `invited_by_id` — String?
- `joined_at` — DateTime?

**WARN** (matched columns needing care)

- `role`: app_role -> enum:WorkspaceRole

## `user_security` -> `UserSecurity` (user_security)

Lovable columns: 4 · Prisma columns: 10 · matched: 3

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `updated_at` — timestamp with time zone NOT NULL default `now()`

**EXTRA in Prisma** (no Lovable source)

- `id` — String
- `idle_logout_minutes` — Int
- `last_login_at` — DateTime?
- `failed_login_attempts` — Int
- `locked_until` — DateTime?
- `pin_failed_attempts` — Int
- `pin_locked_until` — DateTime?

## `vendors` -> `Vendor` (vendors)

Lovable columns: 17 · Prisma columns: 20 · matched: 11

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `bank` — text NOT NULL · candidates: `bank_name`
- `acct_no` — text NOT NULL · candidates: `account_name`
- `contact` — text · candidates: `contact_person`
- `notify_channel` — text NOT NULL default `'whatsapp'::text`
- `notify_opt_in` — boolean NOT NULL default `true`
- `tags` — text[] NOT NULL default `'{}'::text[]`

**EXTRA in Prisma** (no Lovable source)

- `contact_person` — String?
- `email` — String?
- `bank_account_number` — String?
- `bank_name` — String?
- `account_name` — String?
- `is_bank_verified` — Boolean
- `monnify_recipient_code` — String?
- `is_active` — Boolean
- `updated_at` — DateTime · REQUIRED, no default

**WARN** (matched columns needing care)

- `workspace_id`: NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)

## `wallet_ledger_entries` -> `WalletLedgerEntry` (wallet_ledger_entries)

Lovable columns: 15 · Prisma columns: 16 · matched: 12

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `source_key` — text NOT NULL
- `metadata` — jsonb NOT NULL default `'{}'::jsonb`
- `updated_at` — timestamp with time zone NOT NULL default `now()`

**EXTRA in Prisma** (no Lovable source)

- `type` — enum:WalletTransactionType · REQUIRED, no default
- `balance_before` — Decimal?
- `balance_after` — Decimal?
- `batch_id` — String?

**WARN** (matched columns needing care)

- `direction`: text -> enum LedgerDirection (IN, OUT) — map values
- `status`: text -> enum LedgerStatus (PENDING, COMPLETED, FAILED, REVERSED) — map values
- `amount`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)
- `posted_at`: NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)

## `wallet_sweeps` -> `WalletSweep` (wallet_sweeps)

Lovable columns: 10 · Prisma columns: 8 · matched: 3

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `live_wallet_balance` — numeric
- `ledger_available` — numeric NOT NULL default `0`
- `clearing` — numeric NOT NULL default `0`
- `released_amount` — numeric NOT NULL default `0` · candidates: `amount`
- `status` — text NOT NULL default `'ok'::text`
- `reason` — text · candidates: `amount`
- `raw` — jsonb

**EXTRA in Prisma** (no Lovable source)

- `amount` — Decimal · REQUIRED, no default
- `monnify_reference` — String · REQUIRED, no default
- `source_account_number` — String?
- `source_account_name` — String?
- `matched_at` — DateTime?

## `wallet_topups` -> `WalletTopup` (wallet_topups)

Lovable columns: 9 · Prisma columns: 12 · matched: 6

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `payment_reference` — text NOT NULL · candidates: `reference`
- `payer_acct_no` — text · candidates: `payer_account_number`, `paid_at`
- `raw_payload` — jsonb

**EXTRA in Prisma** (no Lovable source)

- `reference` — String · REQUIRED, no default
- `payer_account_number` — String?
- `source` — enum:TopupSource
- `status` — enum:PayoutStatus
- `paid_at` — DateTime?
- `completed_at` — DateTime?

**WARN** (matched columns needing care)

- `amount`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)
- `workspace_id`: NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)

## `wht_ledger` -> `WhtLedger` (wht_ledger)

Lovable columns: 18 · Prisma columns: 11 · matched: 9

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `payout_group_id` — uuid NOT NULL
- `vendor_name` — text
- `coa` — text
- `net_amount` — numeric NOT NULL
- `vendor_payout_reference` — text · candidates: `reference`
- `wht_payout_reference` — text · candidates: `reference`
- `remit_status` — text NOT NULL default `'pending'::text`
- `period` — text · candidates: `tax_period`
- `updated_at` — timestamp with time zone NOT NULL default `now()`

**EXTRA in Prisma** (no Lovable source)

- `tax_period` — DateTime · REQUIRED, no default
- `reference` — String?

**WARN** (matched columns needing care)

- `vendor_id`: NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)
- `gross_amount`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)
- `wht_amount`: unconstrained numeric -> Decimal(14, 2) (check overflow/rounding)

## `wht_rates` -> `WhtRate` (wht_rates)

Lovable columns: 7 · Prisma columns: 7 · matched: 7

No differences.

## `workspace_members` -> `WorkspaceMember` (workspace_members)

Lovable columns: 4 · Prisma columns: 9 · matched: 4

**EXTRA in Prisma** (no Lovable source)

- `role` — enum:WorkspaceRole
- `is_biller` — Boolean
- `is_active` — Boolean
- `invited_at` — DateTime
- `invited_by_id` — String?

## `workspace_subscriptions` -> `WorkspaceSubscription` (workspace_subscriptions)

Lovable columns: 24 · Prisma columns: 7 · matched: 5

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `status` — text NOT NULL default `'trial'::text`
- `monthly_amount` — numeric NOT NULL default `45000`
- `currency` — text NOT NULL default `'NGN'::text`
- `trial_ends_at` — date
- `paid_until` — date
- `notes` — text
- `plan_id` — uuid · candidates: `billing_plan_id`
- `prepay_months` — integer
- `grace_until` — date
- `suspended_at` — timestamp with time zone
- `setup_fee_paid_at` — timestamp with time zone
- `trial_granted` — boolean NOT NULL default `false`
- `collection_account_number` — text
- `collection_bank_name` — text
- `collection_account_name` — text
- `collection_account_reference` — text
- `billing_day` — smallint · candidates: `billing_plan_id`
- `next_due_date` — date
- `client_status` — text default `'trial'::text` · candidates: `current_period_start`

**EXTRA in Prisma** (no Lovable source)

- `billing_plan_id` — String · REQUIRED, no default
- `current_period_start` — DateTime · REQUIRED, no default

**WARN** (matched columns needing care)

- `current_period_end`: NULLABLE in Lovable, REQUIRED in Prisma (nulls will fail import)

## `workspaces` -> `Workspace` (workspaces)

Lovable columns: 15 · Prisma columns: 34 · matched: 8

**MISSING in Prisma** (Lovable column -> type / nullable / candidates among EXTRA columns)

- `session_timeout_minutes` — integer NOT NULL default `60`
- `require_reauth_for_disbursement` — boolean NOT NULL default `false`
- `created_by` — uuid
- `signature_url` — text
- `theme_color` — text
- `invoice_footer` — text · candidates: `invoice_prefix`
- `payout_narration_name` — text

**EXTRA in Prisma** (no Lovable source)

- `industry` — String?
- `tin` — String?
- `status` — enum:WorkspaceStatus
- `tier` — String?
- `monthly_amount` — Decimal?
- `billing_day` — Int?
- `paid_until` — DateTime?
- `next_due_date` — DateTime?
- `notes` — String?
- `plan_tier` — enum:PlanTier
- `subscription_status` — enum:SubscriptionStatus
- `trial_end_date` — DateTime?
- `subscription_end_date` — DateTime?
- `is_grandfathered` — Boolean
- `business_type` — String?
- `monnify_reserved_account_number` — String?
- `monnify_reserved_account_name` — String?
- `monnify_reserved_account_bank` — String?
- `monnify_reserved_account_ref` — String?
- `monnify_contract_code` — String?
- `invoice_prefix` — String
- `tax_rate` — Decimal
- `billing_account_number` — String?
- `billing_account_name` — String?
- `billing_account_bank` — String?
- `billing_account_ref` — String?
