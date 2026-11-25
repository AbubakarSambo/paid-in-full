# Paid in Full: Lovable/Supabase -> own stack cutover plan

Written 2026-11-24 from: `Paid_in_Full_Backend_Migration_Audit_2026-11-20.md` (live snapshot), the local repo
(`api/` NestJS + Prisma, `client/` Vite, `monnify-relay/`, `marketing/`), the existing
`docs/lovable-migration-column-diff.md`, the live Railway/Vercel accounts, and `../tarione` as the hosting reference.

## 1. Where things stand

**Live (Lovable Cloud):** 28 workspaces, 77 users, 60,101 rows, about ₦1.62bn paid out since May 2026. Yellow Door Hotels
is roughly 99% of the volume. Backend = Supabase Postgres + Supabase Auth + Storage + pg_cron/pg_net, with 57 SECURITY
DEFINER functions and 67 triggers holding business logic, 85 TanStack server functions, 12 public routes, 7 cron jobs.
The client reads many tables directly under RLS.

**Local (this repo):** a rewrite on NestJS 11 / Prisma 5 / Postgres, JWT + bcrypt auth, Google ID-token sign-in, Cloudinary
uploads, Resend email, Sentry, Monnify with mock mode and an optional static-IP relay. 12 commits. It is a re-implementation,
not a port of the data model, so it does not yet match production's data or behaviour.

**Hosting already created (all empty of real data):**

| Piece | State |
| --- | --- |
| Railway project `paid-in-full` | `api` service (GitHub `AbubakarSambo/paid-in-full`, `main`, public domain `api-production-6e39.up.railway.app`, port 8080) + `Postgres` (v18, 50 GB volume). **Only a `production` environment.** |
| Vercel `paid-in-full-client` | Only `paid-in-full-client.vercel.app` |
| Vercel `paid-in-full-marketing` | Only `paid-in-full-marketing.vercel.app` |
| Custom domains | None attached. `.env.example` assumes `api.paidinfull.app`, `www.paidinfull.app`. |
| monnify-relay | Code exists locally, not deployed |

**Tarione pattern to copy:** Vercel (client + marketing) -> Railway (NestJS api + Postgres) behind a custom API domain
(`api.tarione.com`), `main` = production and `staging` = staging branch, Sentry + PostHog, Prisma `migrate deploy`, Node 24,
`NODE_ENV=production`, `CORS_ORIGINS` allow-list + Vercel preview regex.

## 2. Blockers: need these before anything else

1. **Access to `auth.users` + `auth.identities` + storage.** The audit deliberately excludes password hashes, auth records
   and file binaries. Supabase hashes are bcrypt, which the local `bcrypt.compare` accepts as-is, so passwords can move over
   with no reset. But Lovable Cloud may not give direct DB access. Ask Lovable (or check Cloud -> Database) for: an
   `auth.users` export (id, email, encrypted_password, email_confirmed_at, created_at, last_sign_in_at, raw_user_meta_data),
   `auth.identities` (Google `provider_id` = `googleSub`), a full `pg_dump`, and the storage objects.
   **Fallback if refused:** no password import. All 67 active users get a "set your password" email; Google users are unaffected
   (match by email/sub).
2. **Unredacted values the CSV hides:** `user_security.pin_hash` (confirm algorithm is bcrypt, else PINs must be reset),
   sensitive `app_config` rows (per-workspace Monnify credentials, `monnify_bvn`), `client_mandates` tokens, `push_subscriptions`
   endpoint/keys, `client_mandate_invites`/`email_unsubscribe_tokens` tokens.
3. **Secrets inventory from Lovable:** `VAPID_PUBLIC_KEY/PRIVATE_KEY` (must be reused or every browser push subscription
   dies), `MONNIFY_*` (+ `MONNIFY_RELAY_URL/SECRET`, which means a relay + static IPs already exist and Monnify already whitelists
   them), `TERMII_*`, `CREAM_FEED_SECRETS`, `GOOGLE_SHEETS_API_KEY`.
4. **Decisions only you can make** (section 7).

### 2.1 Update 2026-11-24: auth + storage export received (`Paid_in_Full_Auth_and_Storage_2026-11-24`)

- **Passwords cannot be exported** (README says so). Fallback path is now the plan: password users get a reset email.
  79 users total: 61 email-only, 9 Google-only, 9 both (so 18 can sign in with Google on day one); no banned, deleted, phone or
  duplicate-email users. 10 are unconfirmed and 10 have never signed in.
  **No Google `sub` in the export** (only the identity names), but `googleSignIn` already falls back to matching by verified email
  and stores the sub on first login, so no backfill is needed.
  So about 52 users (email-only, signed in before) depend on the reset email arriving: Resend domain must be verified first, and
  the reset template must work for imported users who have no password (`hasPassword=false`).
  `auth_users.csv` has 79 users vs 77 in the audit (2 signed up since 20 Nov): another reason to re-export at cutover.
- **Storage binaries are all present:** 668 objects (650 attachments, 17 workspace assets, 1 avatar), 618 MB on disk, manifest
  matches disk with 0 missing. Attachments grew from 560 to 650 in four days, so the final sync must be re-done at cutover.
  All files are jpeg (560), pdf (85) or png (23); none over 10 MB.
- **Still not provided:** `user_security.pin_hash` (redacted in the data CSVs; the PIN hash cannot be recovered, so assume every
  payer/admin sets a new disbursement PIN at first login), per-workspace Monnify credentials in `app_config`, push keys.

## 3. Gaps to close in the code, before any real data goes in

### 3.1 Schema (largest item) — **DONE 2026-11-24 on branch `feat/lovable-schema-parity`**
Migration `20261124120000_lovable_parity` + per-table import rules in `lovable-etl-mapping.md`. Orphan-vendor decision made:
null the link, keep `legacy_vendor_id`. Remaining schema risk: duplicate names against Prisma's unique keys and 10 zero-row tables
whose flows are unverified (mapping doc sections 2 and 4). Original notes follow.

- Column diff says **378 Lovable columns have no Prisma equivalent** (many are naming differences, but ~100+ are real, e.g.
  `client_mandates` 18, `workspace_subscriptions` 19, `subscription_charge_attempts` 16, `batch_items` 15, `requisitions` 15).
  Work through `docs/lovable-migration-column-diff.md` table by table: map, add column, or consciously drop.
- **3 tables with no Prisma model:** `goods_receipts` (43 rows), `procurement_approvers` (3), `requisition_approvals` (15). The
  requisition approval flow (`approve_requisition_item`, `final_approve_requisition`, `sign_goods_receipt`) depends on them.
- **Roles: DECIDED 2026-11-24, collapse to each user's highest role per workspace.** Lovable allows several roles per user per
  workspace (admin 67 assignments for 34 users); local `WorkspaceMember` has one `role` + `isBiller`. The ETL maps the 127
  `user_roles` rows like this (reusing `ROLE_PRECEDENCE` / `effectiveRole()` in `common/permissions.ts`, don't re-implement):

  | Lovable `app_role` | Becomes |
  | --- | --- |
  | admin > payer > approver > poster > procurement > requester > viewer/user | the single `WorkspaceMember.role` (highest wins) |
  | biller | `WorkspaceMember.isBiller = true` (add-on, never competes for "highest") |
  | super_admin, client_setup | `User.platformRole` (not workspace-scoped; 1 user each) |

  Local capabilities are hierarchical (a payer can approve and post), so collapsing can **grant** a user more than a Lovable
  row set gave them (e.g. a payer-only user can now approve). The ETL must emit a **before/after role report per user per
  workspace** listing every user whose effective capabilities increase; you review that list (it's at most a few dozen rows)
  before cutover and downgrade any you don't want. Users with no membership row (4) stay without access.
- Type tightening on import: unconstrained `numeric` -> `Decimal(14,2)` (check overflow/rounding), `text` statuses -> enums.
  Statuses are **mixed-case in production** (`SUCCESS`/`success`, `PARTIAL`/`partial`, `pending`/`PENDING`, `cancelled`), so the
  mapper must normalise them.
- `app_config.value` is nullable text; local is non-null `Json`. `is_sensitive` is missing locally.

### 3.2 Logic that lives in the database today (must be re-proven in NestJS)
`approve_queue_items`, `reserve_payout_attempt`, `reserve_payout_split`, `apply_payout_status`, `recompute_payout_item`,
`delete_untouched_batch`, `wallet_balance_summary` + `sync_wallet_ledger_from_payout/topup` triggers, WHT ledger/rate seeding,
invoice/quote numbering, `merge_customers`, requisition approval counting, `enforce_*` bank-detail and procurement guards,
`run_recurring_payments`. Wallet balance is **derived** from `wallet_ledger_entries`, so the ledger code is money-critical.
Write a parity test per function (same inputs -> same rows) using production-shaped fixtures.

### 3.3 Payments safety
- `MonnifyController.handleWebhook` **logs a signature mismatch but doesn't reject it** (code TODO). Fix before production:
  confirm the signed-string format against a real sandbox delivery, then enforce.
- Production must run `MONNIFY_MOCK_MODE=false` and a real `MONNIFY_ENCRYPTION_KEY`.
- Reuse the existing Monnify relay/Fixie IPs (deploy `monnify-relay/` as a second Railway service); without a whitelisted IP,
  disbursement and collection calls fail.
- Idempotency: local has `IdempotencyKey`; verify payout creation can't double-send after a retry or a restart.

### 3.4 Scheduled jobs: production has 7, local has ~6 and they don't line up
| Production job | Local equivalent |
| --- | --- |
| payout recovery, every minute | `recoverInFlight` every 5 min (slower; check the grace window) |
| `monnify-poll` every 5 min (replays reserved-account inflows missed by webhooks) | **not found** |
| `monnify-sweep` every 10 min (releases funding, unblocks waiting payouts) | **not found** (models exist) |
| `monnify-settlement-sync` every 4 h | **not found** |
| billing-lifecycle daily | `billing.service` crons (verify behaviour) |
| client-billing-run daily (auto-debit + dunning) | `customer-subscriptions` cron (verify) |
| `run_recurring_payments` daily | `recurring.scheduler` |
`@nestjs/schedule` runs in-process: keep the API at **1 replica**, or add advisory locks before scaling out.

### 3.5 Integrations present in production, missing or different locally
- **C.R.E.A.M. feeds** `GET /api/public/feed/expenses` and `/feed/topups` (shared-secret, workspace-bound, polled every 15 min by
  an external reader): no equivalent found. Implement, or the consumer breaks silently.
- **Termii SMS/WhatsApp** vs local WhatsApp Cloud API: pick one; invoice/receipt delivery depends on it.
- **Email:** Lovable managed email -> Resend. Verify the sending domain (SPF/DKIM) *before* cutover; import `suppressed_emails`
  (5) and unsubscribe tokens; confirm auth emails (invite, verify, reset) all exist.
- **AI** (COA tags, description cleanup, expense parsing): Lovable gateway -> OpenAI/DeepSeek keys.
- **Google Sheets:** Lovable used a connector; local uses a service account (`GOOGLE_SHEETS_CREDENTIALS_BASE64`). Each
  workspace's sheet must be shared with that service account, and `synced_to_sheets` state carried over.
- **Google sign-in:** the same OAuth client must list the new app origin; `googleSub` must be backfilled from `auth.identities`.
- **Web push:** reuse VAPID keys; subscriptions need their key material (redacted in export) or users re-enable notifications.
- **File storage:** local uses Cloudinary; production has 560 private attachments (490 MB), 16 public workspace assets, 1 avatar.
  Needs download -> re-upload -> rewrite stored URLs. Two orphan objects in `queue-attachments` have no DB row (ignore/log).
- Paystack is inactive in production: skip. `/admin/freeze-yd-monnify` is a one-off: skip.

### 3.6 Data issues to resolve in the import (from audit 3.5)
- **935 batch items (₦90,983,384.56) reference vendors that don't exist** (672 Yellow Door). Local likely has an FK. Decision: keep
  the item with its `vendor_name`/bank snapshot and null the `vendor_id`, or create placeholder vendors. Never drop them.
- **Two paid invoices have negative totals** (Ice Central, INV-2026-0007 and -0119): import as-is, don't "fix".
- 4 users with no workspace membership; 10 unconfirmed emails: carry the state, don't auto-confirm.

### 3.7 Client parity
The Lovable UI is the contract customers know. Build a checklist from the 85 server functions + 12 routes
(section 4 of the audit) and tick each against a local screen or endpoint. The audit lists screens by capability, not by URL, so
also walk the old app with a real admin account and record screens/flows.

## 4. Hosting: make it match Tarione

1. **Staging environment** (Railway has only `production`): create a `staging` environment (own Postgres, own `api`, own
   Monnify **sandbox** keys, `MONNIFY_MOCK_MODE=false` against sandbox). Git branch `staging` -> staging, `main` -> production.
2. **Vercel:** `paid-in-full-client` production = `main`, `staging` branch alias with staging `VITE_API_URL`. Keep the existing
   `vercel.json` SPA rewrite. Marketing stays a separate project.
3. **Domains:** `api.paidinfull.app` (Railway custom domain), the app on its own subdomain or apex, `www` for marketing; staging
   equivalents (`api-staging.`, `staging.`). Update `CORS_ORIGINS`, `FRONTEND_URL`, `GOOGLE_CALLBACK_URL`,
   `MONNIFY_WEBHOOK_BASE_URL`, Vercel preview regex in `main.ts` (currently hard-coded to `paid-in-full-*-abubakar-sambos-projects`).
4. **Railway API:** `NODE_ENV=production`, Node 24 (api `package.json` still says `20.x`; client already moved to 24),
   `postinstall` builds, run `prisma migrate deploy` as pre-deploy command, health check, 1 replica, `DATABASE_CONNECTION_LIMIT`
   sized to the Postgres plan.
5. **monnify-relay** as a second Railway service (per its README) with Fixie.
6. **Database safety:** enable Railway backups/snapshots *before* the first import, and schedule an off-Railway `pg_dump`.
7. **Observability:** Sentry DSN (API + client), PostHog key, Railway log alerts, uptime monitor on `/health` and the webhook
   route, and an alert on payouts stuck in PENDING/PROCESSING > 10 min.
8. **Secrets:** all via Railway/Vercel variables, rotate the placeholder `JWT_SECRET` and `MONNIFY_ENCRYPTION_KEY` defaults.
9. Add a `CLAUDE.md`/rules file like tarione's (multi-tenancy `where: { workspaceId }`, no new deps without asking, lint+build gate).

## 5. Data migration tooling (build once, run many times)

An **idempotent, re-runnable ETL script** (`api/scripts/import-lovable.ts`):
1. Load the raw CSVs (and the auth/storage extracts) into a scratch `lovable_raw` schema, untouched.
2. Transform with SQL/TypeScript into the Prisma tables: id-preserving (keep UUIDs so links and external references like
   Monnify refs stay valid), status normalisation, role mapping, `profiles` -> `users`, `user_roles` -> `workspace_members`,
   password hashes and `googleSub` attached to users.
3. Run inside one transaction per table group, with `ON CONFLICT DO NOTHING/UPDATE` so reruns are safe.
4. Emit a **reconciliation report**, compared to the audit baselines:
   - row counts per table (60,101 total) and per-status totals (section 3.1 of the audit);
   - wallet per workspace: credits ₦1,624,237,010.55, posted debits ₦1,618,896,944.00, ledger balance ₦5,340,066.55
     (these change daily; always diff against the *fresh* export's own figures, not this snapshot's);
   - invoice totals/paid by status, WHT ledger, vendors (1,178), users (77), memberships (113);
   - the 935 orphan vendor items and 2 negative invoices reported, not hidden.
5. Files: separate script to stream storage objects to Cloudinary and rewrite URLs, with a manifest of old->new + checksums.

## 6. Phases

| Phase | What | Exit criteria |
| --- | --- | --- |
| 0. Unblock | Section 2 items; decisions in section 7 | Auth/storage/secrets in hand, roles + vendor decisions made |
| 1. Parity build | Section 3: schema, DB-logic ports, jobs, feeds, integrations, webhook signature | Column diff has zero unexplained MISSING; parity tests green; lint/build clean |
| 2. Infra | Section 4 on staging first, then production (empty) | `staging` fully deployed; prod deployed, empty, healthy; domains + email domain verified |
| 3. Rehearsal x2 | Full export -> ETL -> staging, twice, timed | Reconciliation report clean; ETL runtime known; no manual fixes needed on run 2 |
| 4. UAT | Staging with real data + Monnify sandbox: Yellow Door admin + one small workspace walk their daily flows (queue -> approve -> batch -> pay -> receipt, topup, invoice, WHT, reports, sheets) | Written sign-off, bug list closed |
| 5. Cutover | Section 8 | Smoke payout succeeds on new stack |
| 6. Hypercare | 2 weeks daily reconciliation, keep Lovable read-only | No unexplained ledger drift; Lovable decommissioned after the sign-off |

## 7. Decisions needed from you

1. ~~**Roles:**~~ decided: collapse to highest role (+ `isBiller`), with a before/after report for review.
2. **Orphan vendor items (935):** null the vendor link, or create placeholder vendors?
3. **Passwords:** hashes are confirmed unavailable. Confirmed plan = reset email to ~52 password users; tell Yellow Door staff
   ahead of time. Also: OK to force every payer/admin to set a new disbursement PIN?
4. **SMS/WhatsApp:** Termii or Meta WhatsApp Cloud API?
5. **Domains:** confirm `paidinfull.app` is owned and which hostnames to use for app / API / marketing.
6. **Cutover window:** which day/time is quietest for Yellow Door (payouts run most days)? And are customers told ahead?
7. **Is the C.R.E.A.M. feed consumer still in use?** If not, drop it.

## 8. Cutover runbook (draft)

**T-7d:** customers notified; staging rehearsal #2 passed; production env verified empty and healthy; backups on.
**T-1d:** lower nothing in DNS yet; confirm Monnify support contact; prepare webhook URL change; freeze feature work.
**T-0 (low-traffic window):**
1. Put the Lovable app in maintenance, block new payouts; wait until no payout is in a pending/processing state and
   `payout_funding_waits` is open-count 0 (or recorded).
2. Disable the 7 pg_cron jobs on Lovable (so nothing runs on both sides).
3. Final full export (auth + public + storage), checksum it, record counts.
4. Run ETL into production, run the reconciliation report; **stop if any wallet balance, ledger total or status total differs**.
5. Copy files; verify a sample of attachments open.
6. Verify live Monnify wallet balance vs the new ledger balance (the audit never queried live balances).
7. Switch the Monnify webhook URL (and `monnify-poll` becomes active) to the new API; verify one sandbox/real callback.
8. Enable crons on the new API; point DNS/Vercel production domain at the new client.
9. Smoke test: sign in (password + Google), view wallet, create + approve + pay one small real payout, confirm receipt + ledger +
   WHT + audit row, send one invoice email.
10. Announce live; keep Lovable read-only and **do not delete it**.

**Rollback:** possible until the first new-stack payout/top-up posts. Before that point: re-point webhook + DNS to Lovable and
re-enable its cron. After it, money has moved on the new side; roll forward, not back. Define that "point of no return"
explicitly and run the smoke test with a small amount so it is crossed deliberately.

## 9. Main risks

1. **Silent logic drift in ported DB functions** -> wrong wallet/WHT/approval results. Mitigated by parity tests + reconciliation.
2. **Auth data not obtainable** -> forced resets (acceptable, but plan comms).
3. **Webhook signature not enforced** + live money -> fix first.
4. **Missing background jobs** (poll/sweep/settlement) -> missed top-ups, stuck payouts. Build + test before rehearsal.
5. **Single-replica scheduler** -> brief downtime on deploys; avoid deploying during payout hours.
6. **Role flattening** -> users losing access they had.
7. **Stale audit** (Nov 20): production keeps moving; always re-export and diff.

## Open blocker: Vercel deployments (25 Nov 2026)

`paid-in-full-client` and `paid-in-full-marketing` builds are BLOCKED: "The Hobby Plan does not support collaboration for private repositories" /
commit author without contributing access. GitHub login `AbubakarSambo` is not recognised as the Hobby owner (`abubakarsambo`); the team lists an
unconfirmed `collecta` member requested from that same login. Tarione (`kulode`, public repo) is unaffected. Fix: relink GitHub to the owner
account, or move to Pro. Must be resolved before any client/marketing change can ship.
