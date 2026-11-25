# Lovable -> Prisma import mapping (contract for the ETL)

Companion to `lovable-cutover-plan.md`. The schema half is migration
`api/prisma/migrations/20261124120000_lovable_parity` (additive; applied cleanly after `0_init` + `schema_sync`, and the DB it
produces matches `schema.prisma` with zero drift). This file is what the import script must do with each table. UUIDs are
preserved everywhere.

## 1. Decisions baked in

| Topic | Rule |
| --- | --- |
| Roles | Collapse to highest per workspace (see plan 3.1). `biller` -> `isBiller`; `super_admin`/`client_setup` -> `User.platformRole`. Emit the before/after capability report. |
| Orphan vendors (935 `batch_items`) | `batch_items.vendor_id` is **nulled**, original id kept in `legacy_vendor_id`, `vendor_name` + bank snapshot kept. Schema now allows null (`BatchItem.vendorId?`). Same for `wht_ledger.vendor_id`. Code that needs a vendor refuses to continue (return-to-queue) or groups by name (reports). Never create placeholder vendors. |
| Missing actor on a required FK | Lovable has many nullable `created_by`/`uploaded_by`/`requester_user_id`; Prisma requires them on `Batch`, `QueueItem`, `QueueItemAttachment`, `Requisition`. Import creates one inactive system user `legacy-import@system.invalid` (no memberships, cannot log in) and uses it. Report the counts. |
| Passwords | **Available.** The full `pg_dump` (25 Nov) carries Supabase's bcrypt hashes (`$2a$10$`, compatible with the API's `bcrypt`), so 62 of 79 users sign in with their existing password. The 17 without a hash (8 Google-only, 9 email accounts that never set a password) get `hasPassword=false`; Google users are matched by `google_sub` from `auth.identities`. No bulk reset email is needed. |
| Secrets never copied | `app_config` `monnify_api_key`, `monnify_secret_key`, `monnify_bvn` (plaintext in the dump; they go to Railway env vars instead), `disbursement_pin` (workspace PIN salt/hash; no local equivalent). `user_security.pin_hash` is not imported: its scrypt / salted-JSON formats are not what the API verifies, so the 8 users with a PIN set a new one. `push_subscriptions`, `email_unsubscribe_tokens`, `client_mandate_invites` are skipped. Number-series rows (`invoice_prefix`, `quote_prefix`, `*_seq_*`) are skipped: the prefix is derived from the existing invoice numbers (`INV-2026`) and `InvoiceConfigService.nextNumber` seeds its own sequence past the highest existing number. |
| Statuses | Production is mixed-case (`SUCCESS`/`success`, `cancelled`, `pending`/`PENDING`). Upper-case then map; fail the run on any unmapped value. |

## 2. Tables with nothing to import (0 rows in the 20 Nov audit)

`billing_payments`, `client_mandates`, `departments`, `invoice_payments`, `invoice_sweeps`, `recurring_payments`,
`settlement_batch_items`, `settlement_batches`, `subscription_charge_attempts`, `subscription_dunning_state`.
No schema work was done for their extra Lovable columns. **Their flows are still unverified** (e.g. auto-debit, settlement sync,
recurring payments): the code exists locally, but its model shape differs from Lovable's, so rebuild/verify those features
against the Lovable behaviour before any customer uses them. Re-check counts on the final export; if any is non-zero, extend the
schema first.

## 3. Skipped on purpose

| Table | Why |
| --- | --- |
| `email_send_state` | Lovable's managed-email queue config (singleton). Not used locally. |
| `payment_receipts` (4 rows) | All 4 failed vendor-receipt sends via Termii; Prisma's model is invoice receipts. |
| `client_mandate_invites` (3) | Tokens redacted and Lovable's meaning (customer direct-debit invite) differs from Prisma's (user invite). Re-issue. |
| `push_subscriptions` (10), `email_unsubscribe_tokens` (16) | Key material / tokens redacted. |
| `drizzle.__drizzle_migrations`, `invoice_templates` extras | Not data. |

## 4. Per-table rules (only where not a 1:1 copy)

Column renames are listed in `lovable-migration-column-diff.md` ("candidates"); only non-obvious rules are below.

| Lovable | Prisma | Rule |
| --- | --- | --- |
| `profiles` + `auth_users.csv` | `users`, `user_security` | `first/last_name` from `full_name`; `last_sign_in_at` -> `UserSecurity.lastLoginAt`. 4 users have no membership: import, no access. |
| `user_roles`, `workspace_members` | `workspace_members` | See roles rule. `joinedAt` = `created_at`. |
| `workspaces` | `workspaces` + `app_config` | New columns hold `session_timeout_minutes`, `require_reauth_for_disbursement`, `created_by`, `signature_url`, `theme_color`, `invoice_footer`, `payout_narration_name`. |
| `workspace_subscriptions` | `workspaces` + `workspace_subscriptions` | Lovable `status/client_status/monthly_amount/paid_until/next_due_date/billing_day/notes/trial_ends_at` -> the `Workspace` console fields; `collection_*` -> `Workspace.billingAccount*`; `plan_id` -> `billingPlanId`; `grace_until`, `setup_fee_paid_at`, `trial_granted`, `prepay_months`, `currency` -> new subscription columns. `current_period_start/end` are required locally: derive from `paid_until` / `created_at` and report. |
| `billing_plans` (3) | `billing_plans` | `tier` is a required unique enum (STARTER/GROWTH/ENTERPRISE): map by `code`/price and **confirm the 3 mappings with you**. `monthly_amount` -> `priceMonthly`; other columns are new. |
| `app_config` | `app_config` | `is_sensitive` kept. `value` is nullable text, local is non-null Json: store JSON string, or JSON null for null. Sensitive rows need the unredacted export. |
| `pay_categories`, `cost_centers`, `locations` | same | `active` -> `isActive`; new `color`, `has_locations`, `code`, `created_at`. |
| `budgets` (298) | `budgets` | Local needs `coaTagId`. Create `coa_tags` from distinct `coa_tag` text per workspace; **if a budget has only `pay_cat_id`, create a CoaTag named after that pay category**. `period_month` date -> `YYYY-MM`. `amount` -> `monthlyAmount`. `location_id`, `pay_cat_id` stored in new columns. Run a duplicate check on the local unique key (workspace, month, cost center, coa tag) first. |
| `vendors` (1178) | `vendors` | `bank` -> `bankName`, `acct_no` -> `bankAccountNumber`, `contact` -> `contactPerson`; new `notify_channel`, `notify_opt_in`. **Local has `UNIQUE(workspace_id, name)`; Lovable does not.** Pre-flight duplicate scan; resolve by suffixing, never merging, so references stay valid. Same check for `cost_centers`, `locations`, `pay_categories`, `stock_expenses`, `products`, `customers`. |
| `requisitions` (4405) | `requisitions` | `requester_user_id` -> `requestedById`; text `coa` -> `coaTagId` via CoaTag lookup; new `hod_name`, `staff_account_note`, `pnl_period`, `final_approved_by/at`, `approval_round`. `queue_item_id` is derived from `queue_items.requisition_id`. |
| `requisition_approvals`, `procurement_approvers`, `goods_receipts` | new tables | Straight copy (`*_by` -> `*_by_id`). |
| `queue_items` (1086) | `queue_items` | `unit_amt` -> `unitAmount`, `pay_cat_*` -> `payCategory*`, text `coa` -> `coaTag` + `coaTagId`, `budget_tag` text -> new `budgetTag` (and `budgetFlag = budget_tag <> ''`), `recurring_payment_id` -> `recurrenceId`. |
| `batches` (1774) | `batches` | Mixed-case `payout_status` -> `BatchPayoutStatus`. `payout_batch_reference` new column. `created_by` missing -> system user; use `approved_by` of its items when present. |
| `batch_items` (10973) | `batch_items` | `status` (default `Disbursed`) kept in `legacy_status`. **`payout_status` PARTIAL (158 items) -> `PENDING` with `paid_amount` kept**, because local treats "outstanding > 0 and not SUCCESS" as still payable (`batches.service.ts`); never invent a PARTIAL enum. Copy `queued_at/approved_*/paid_*/pay_started_at/created_by/requisition_id/attachment_group_id` to the new columns. `outstanding` is derived, don't import. Null `vendor_id` per orphan rule. |
| `batch_item_payouts` (13044) | `batch_item_payouts` | `message` -> `message` (also `failureReason` when FAILED), `combined_reference` -> `transferReference`, new `payout_group_id`. `leg` upper-cased. Destination fields can be back-filled from the item snapshot. |
| `wallet_ledger_entries` (13574) | `wallet_ledger_entries` | **Money-critical.** Lovable stores positive `amount` + `direction` credit/debit; local comment says `amount` is signed (+in/-out): **confirm which the wallet code actually reads, then transform once** and prove with the balance check below. `source_key` (unique) is kept in the new column. Derive required `type` (TOPUP/DISBURSEMENT/WHT_WITHHOLDING/...) from `source_type`. Statuses: posted -> COMPLETED, failed -> FAILED, cancelled -> REVERSED. |
| `wallet_topups` (347) | `wallet_topups` | `payment_reference` -> `reference`, `payer_acct_no` -> `payerAccountNumber`, new `raw_payload`. |
| `wallet_sweeps` (116) | `wallet_sweeps` | Table reshaped (it was unused): now stores Lovable's live-balance check (`live_wallet_balance`, `ledger_available`, `clearing`, `released_amount`, `status`, `reason`, `raw`). `amount` = `released_amount`. |
| `payout_funding_waits` (1) | same | `amount_required` -> `requiredAmount`; `batch_id` may be null in Lovable (required locally): skip + report if so. New `ready_at_block`, `notified_at`. |
| `wht_ledger` (532) | `wht_ledger` | New columns for `payout_group_id` (unique), `vendor_name`, `coa`, `net_amount`, both payout references, `remit_status`; `period` text -> `taxPeriod` date (first of month). Null vendor allowed. |
| `invoices` (884) | `invoices` | New `tax_rate`, `tax_amount`, `paid_at`, `collection_provisioned_at`, `share_token_created_at`, `converted_at`, `fx_locked_at`, `cc_emails`; `converted_from_id` -> `convertedFromQuoteId`. **Keep the 2 negative-total paid invoices as they are.** |
| `invoice_items` (1832) | `invoice_items` | New `vat_amount`, `wht_amount`, discount fields, `tax_inclusive`. |
| `invoice_templates`, `invoice_template_items` | same | Template tax/late-fee/discount fields go into `settings` JSON; items get new discount columns. |
| `invoice_sends` (26) | `invoice_sends` | `recipient` -> `sentTo`; new `status`, `message`, `error`, `provider_message_id`, `sent_by`. |
| `invoice_recurrences` (1) | same | `cadence` -> `interval`, `next_run_date` -> `nextRunAt`, `end_date` -> `endsAt`, `template` -> `templateItems`. |
| `customer_subscriptions` (1) | same | `frequency` -> `interval`, `next_charge_date` -> `nextRunAt`; new `currency`, `billing_day`, `start_date`, `created_by`. Status `pending_mandate` -> `PENDING_MANDATE`. |
| `customer_credits` (13) | same | New `currency`, `created_by`. Status open -> OPEN. |
| `notification_prefs` (9) | `notification_prefs` | Local is one row per (user, workspace, channel, event). Explode Lovable's booleans: `queue_added`, `batch_pending_approval`, `disbursement_result` x (`email_channel` -> EMAIL, `in_app_channel` -> IN_APP). |
| `email_send_log` (7273) | same | `template_name` -> `template`, `recipient_email` -> `toEmail`; new `message_id`, `error_message`, `metadata`. |
| `suppressed_emails` (5) | same | New `metadata`. |
| `client_errors` (21) | same | New columns for `source`, workspace/user, `severity`, `metadata`. |
| `audit_log` (313) | `audit_log` | `actor_user_id` -> `userId`. |
| `queue_item_attachments` (558) | same | `file_url` null until the Cloudinary upload step fills it; `uploaded_by` may be null -> system user. |
| Storage objects | Cloudinary | `workspace-assets` public (17), `user-avatars` (1) -> set `signature_url`/`logo_url`/`avatarUrl`; `queue-attachments` (650, includes ~90 added since the audit; the `storage_manifest.csv` is the source of truth). 2 objects had no DB row in the audit: log, don't import. |

## 5. Reconciliation checks the import must pass (run against the *same* export it loaded)

1. Row counts per source table == rows inserted + rows deliberately skipped (listed with reasons).
2. Per workspace: posted credits, posted debits, ledger balance via the local `wallet_balance_summary` equivalent == the same
   figures computed from the CSV (audit 3.2 shows the format).
3. Sums by status for `batch_items` (total, paid, wht, net), `batch_item_payouts`, `invoices`, `queue_items`, `wht_ledger`.
4. Zero unmapped enum values; zero duplicate-key collisions left unresolved.
5. Counts reported (not hidden): orphan vendor lines (935, ₦90,983,384.56), negative invoices (2), system-user attributions,
   synthetic CoaTags, PARTIAL items (158), users whose capabilities increase.

## 6. Running the import (`api/scripts/import-lovable.ts`)

```bash
# 1. restore the dump into a scratch Postgres 17 (the dump is v17; pg_restore 17+; schemas public + auth)
pg_restore --no-owner --no-acl -n public -n auth -d <scratch_db> paidinfull_YYMMDD.backup
# 2. target: migrated, empty
DATABASE_URL=<target> npx prisma migrate deploy
# 3. rehearse (everything runs, then rolls back) and read the report
SOURCE_DATABASE_URL=<scratch_db> DATABASE_URL=<target> npx ts-node --transpile-only scripts/import-lovable.ts --dry-run --report /tmp/report.json
# 4. commit
IMPORT_CONFIRM=yes SOURCE_DATABASE_URL=... DATABASE_URL=... npx ts-node --transpile-only scripts/import-lovable.ts --report /tmp/report.json
```

One transaction; reconciliation failures abort it. Re-running is a no-op (deterministic ids, `ON CONFLICT (id) DO NOTHING`).

**What the 25 Nov rehearsal showed** (all counts are in the report JSON):

- 79 users + 1 system user; 62 carry bcrypt hashes. 31 workspaces; 104 memberships (16 source memberships point at deleted users; 4 subscriptions point at deleted workspaces: skipped).
- Roles: no user has more than one workspace role (132 role rows = 104 + 26 `biller` + 2 platform roles), so collapsing changes nobody's access.
- Duplicate names suffixed `(2)`, `(3)`: vendors 63, customers 63, stock_expenses 4 (locations 0 after the cost-centre scope). Requisition refs, batch refs and invoice numbers have no real duplicates (the three "duplicates" I first saw were NULL refs).
- 935 + 11 batch items with no vendor link (`legacy_vendor_id` keeps the 935). 160 PARTIAL items imported as PENDING with `paid_amount`.
- 1 queue item skipped (no vendor id and no vendor of that name); 10 queue items with a null vendor id were linked to the same-named vendor.
- 34 budgets whose COA has no category anywhere are parked under a per-workspace "Unassigned (imported budgets)" pay category (2 workspaces).
- 20 `wht_ledger` rows share a `wht_payout_reference`; their unique `reference` is `<ref>:<payout_group_id>`.
- Missing actors on required columns: 249 requisitions, 25 queue items, 86 batches attributed to the system user.
- Ledger sign: stored signed (IN positive, OUT negative) to match `WalletService`; `computeBalance` takes `abs()` of the sums so either convention gives the same balance. Per-workspace posted credits/debits match the source exactly. Running `balance_before/after` is recomputed.
- Migration `20261125100000_procurement_approver_backup_flag` adds `procurement_approvers.is_backup`, a column the first schema pass missed (found by the import).
