/**
 * One-shot, re-runnable import of the Lovable (Supabase) production data into the Paid in Full Prisma schema.
 *
 *   SOURCE_DATABASE_URL = a Postgres that holds the restored Lovable dump (schemas `public` and `auth`)
 *   DATABASE_URL        = the target database, already migrated (`prisma migrate deploy`)
 *
 *   npx ts-node scripts/import-lovable.ts --dry-run --report /path/report.json   # runs everything, rolls back
 *   IMPORT_CONFIRM=yes npx ts-node scripts/import-lovable.ts --report /path/report.json   # commits
 *
 * The contract for every rule below is docs/lovable-etl-mapping.md. Principles:
 *  - One transaction: either everything lands and every reconciliation check passes, or nothing does.
 *  - UUIDs are preserved. Anything the script has to invent gets a deterministic id, so a re-run is a no-op
 *    (`ON CONFLICT (id) DO NOTHING`; any *other* unique-key clash fails loudly instead of being swallowed).
 *  - Nothing is merged or dropped silently: renames, nulled references, skipped rows and attributions to the
 *    system user are all counted in the report.
 *  - Secrets (Monnify keys, BVN, PIN material) are never copied and never logged.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs';

type Row = Record<string, any>;
type Tx = Prisma.TransactionClient;

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const REPORT_PATH = argv.includes('--report') ? argv[argv.indexOf('--report') + 1] : 'import-report.json';
const SOURCE_URL = process.env.SOURCE_DATABASE_URL;
const TARGET_URL = process.env.DATABASE_URL;

if (!SOURCE_URL || !TARGET_URL) throw new Error('Set SOURCE_DATABASE_URL (restored Lovable dump) and DATABASE_URL (target).');
if (!DRY_RUN && process.env.IMPORT_CONFIRM !== 'yes') {
  throw new Error('Refusing to write: pass --dry-run, or set IMPORT_CONFIRM=yes to commit.');
}

const source = new PrismaClient({ datasourceUrl: SOURCE_URL, log: [] });
const target = new PrismaClient({ datasourceUrl: TARGET_URL, log: [] });

// ─── report ──────────────────────────────────────────────────────────────────

const report: Row = {
  mode: DRY_RUN ? 'dry-run (rolled back)' : 'committed',
  startedAt: new Date().toISOString(),
  tables: {} as Record<string, { source: number; inserted: number; skipped: number }>,
  renamedDuplicates: [] as Row[],
  nulledReferences: {} as Record<string, number>,
  skippedRows: [] as Row[],
  systemUserAttributions: {} as Record<string, number>,
  excludedConfigKeys: {} as Record<string, number>,
  notes: [] as string[],
};

const note = (s: string) => {
  report.notes.push(s);
  console.log('  note:', s);
};

// ─── helpers ─────────────────────────────────────────────────────────────────

const jsonReplacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

/** Deterministic UUID so synthesized rows (CoaTags, system user, ...) are stable across re-runs. */
function detId(seed: string): string {
  const h = createHash('sha1').update(`pif-lovable-import:${seed}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const src = <T = Row>(sql: string) => source.$queryRawUnsafe<T[]>(sql);
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));
const num = (v: unknown) => (v == null ? 0 : Number(v));
const kobo = (v: unknown) => Math.round(num(v) * 100);
const blank = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '');
const orNull = <T>(v: T | undefined | null | '') => (v === undefined || v === '' ? null : v);

const ids: Record<string, Set<string>> = {};
const idsOf = (name: string) => (ids[name] ??= new Set());
const hasId = (set: string, id: unknown): id is string => typeof id === 'string' && idsOf(set).has(id);

/** Reference to an optional parent: returns the id if the parent was imported, otherwise null (counted). */
function ref(set: string, id: unknown, ctx: string): string | null {
  if (id == null) return null;
  if (hasId(set, id)) return id as string;
  report.nulledReferences[ctx] = (report.nulledReferences[ctx] ?? 0) + 1;
  return null;
}

function skip(table: string, id: unknown, reason: string) {
  report.skippedRows.push({ table, id, reason });
}

function stat(table: string, sourceCount: number, inserted: number) {
  const prev = report.tables[table];
  const s = (prev?.source ?? 0) + sourceCount;
  const i = (prev?.inserted ?? 0) + inserted;
  report.tables[table] = { source: s, inserted: i, skipped: s - i };
}

const defaultsCache = new Map<string, Map<string, string>>();
async function columnDefaults(tx: Tx, table: string): Promise<Map<string, string>> {
  const hit = defaultsCache.get(table);
  if (hit) return hit;
  const rows = await tx.$queryRawUnsafe<{ column_name: string; column_default: string }[]>(
    `select column_name, column_default from information_schema.columns where table_schema='public' and table_name=$1 and is_nullable='NO' and column_default is not null`,
    table,
  );
  const m = new Map(rows.map((r) => [r.column_name, r.column_default]));
  defaultsCache.set(table, m);
  return m;
}

async function insert(tx: Tx, table: string, rows: Row[], sourceCount = rows.length): Promise<void> {
  if (rows.length === 0) return stat(table, sourceCount, 0);
  const cols = Object.keys(rows[0]);
  for (const r of rows) {
    const k = Object.keys(r);
    if (k.length !== cols.length || k.some((c, i) => c !== cols[i])) {
      throw new Error(`insert(${table}): rows have inconsistent keys (${k.join(',')}) vs (${cols.join(',')})`);
    }
  }
  const colSql = cols.map((c) => `"${c}"`).join(', ');
  // A null we pass for a NOT NULL column that has a database default means "use the default" (e.g. accent_skin, is_active, created_at).
  const defaults = await columnDefaults(tx, table);
  const selSql = cols.map((c) => (defaults.has(c) ? `COALESCE("${c}", ${defaults.get(c)})` : `"${c}"`)).join(', ');
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    inserted += await tx.$executeRawUnsafe(
      `INSERT INTO "${table}" (${colSql}) SELECT ${selSql} FROM jsonb_populate_recordset(null::"${table}", $1::jsonb) ON CONFLICT (id) DO NOTHING`,
      JSON.stringify(chunk, jsonReplacer),
    );
  }
  stat(table, sourceCount, inserted);
}

function mapEnum(label: string, value: unknown, map: Record<string, string>): string {
  const key = String(value ?? '').trim().toUpperCase();
  const out = map[key];
  if (!out) throw new Error(`Unmapped ${label} value: ${JSON.stringify(value)}`);
  return out;
}

/**
 * Keeps the earliest row of every (scope,name) group unchanged and suffixes the later ones " (2)", " (3)", ...
 * Never merges, so every foreign key into the renamed row stays valid.
 */
function suffixDuplicates(table: string, allRows: Row[], scope: (r: Row) => string, field = 'name', suffix = (n: string, i: number) => `${n} (${i})`) {
  const rows = allRows.filter((r) => !blank(r[field]));
  const ordered = [...rows].sort((a, b) => (iso(a.created_at) ?? '').localeCompare(iso(b.created_at) ?? '') || String(a.id).localeCompare(String(b.id)));
  const taken = new Set(rows.map((r) => `${scope(r)}\u0000${r[field]}`));
  const seen = new Map<string, number>();
  for (const r of ordered) {
    const base = `${scope(r)}\u0000${r[field]}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    if (n === 1) continue;
    let k = n;
    let candidate = suffix(r[field], k);
    while (taken.has(`${scope(r)}\u0000${candidate}`)) candidate = suffix(r[field], ++k);
    taken.add(`${scope(r)}\u0000${candidate}`);
    report.renamedDuplicates.push({ table, id: r.id, workspaceId: r.workspace_id, from: r[field], to: candidate });
    r[field] = candidate;
  }
}

// ─── role model ──────────────────────────────────────────────────────────────

const ROLE_RANK: Record<string, number> = { viewer: 0, requester: 1, procurement: 2, poster: 3, approver: 4, payer: 5, admin: 6 };
const WORKSPACE_ROLES = Object.keys(ROLE_RANK);

const WORKSPACE_STATUS: Record<string, string> = {
  LEAD: 'LEAD', TRIAL: 'TRIAL', ACTIVE: 'ACTIVE', DEAD: 'DEAD', PAUSED: 'PAUSED', SUSPENDED: 'SUSPENDED',
};
const SUBSCRIPTION_STATUS: Record<string, string> = {
  TRIAL: 'TRIALING', ACTIVE: 'ACTIVE', SUSPENDED: 'PAST_DUE', EXPIRED: 'EXPIRED', CANCELLED: 'CANCELLED',
};
/** Lovable plan code -> local tier. Chosen by price (shared 49k, managed 60k, standalone setup-fee product). Confirm with the owner. */
const PLAN_TIER: Record<string, string> = { shared: 'STARTER', managed: 'GROWTH', standalone: 'ENTERPRISE' };

/** Config rows that are never copied: live credentials / PIN material (the new API takes keys from env vars) and number series the new code derives itself. */
const EXCLUDED_CONFIG_KEYS = new Set([
  'monnify_api_key', 'monnify_secret_key', 'monnify_bvn', 'disbursement_pin',
  'invoice_prefix', 'quote_prefix',
]);
const skippedQueueIds = () => {
  const ids = report.skippedRows.filter((r: Row) => r.table === 'queue_items').map((r: Row) => `'${r.id}'`);
  return ids.length ? ids.join(',') : `''`;
};
const isSeriesKey = (k: string) => /^(invoice|quote)_seq_\d+$/.test(k);

// ─── the import ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`Lovable import — ${DRY_RUN ? 'DRY RUN (will roll back)' : 'COMMIT'}`);

  await target.$transaction(
    async (tx) => {
      const SYSTEM_USER_ID = detId('system-user');
      const sysUse = (ctx: string) => (report.systemUserAttributions[ctx] = (report.systemUserAttributions[ctx] ?? 0) + 1);

      // ── users ──────────────────────────────────────────────────────────────
      console.log('users…');
      const authUsers = await src(`select id::text, email, encrypted_password, email_confirmed_at, last_sign_in_at, banned_until, deleted_at, phone, raw_user_meta_data, created_at, updated_at from auth.users order by created_at`);
      const profiles = new Map((await src(`select * from profiles`)).map((p) => [p.id, p]));
      const identities = await src(`select user_id::text, provider, provider_id from auth.identities`);
      const googleSub = new Map(identities.filter((i) => i.provider === 'google').map((i) => [i.user_id, i.provider_id as string]));
      const roleRows = await src(`select user_id::text, workspace_id::text, role::text as role, created_at from user_roles`);

      const platformRole = new Map<string, string>();
      for (const r of roleRows) {
        if (r.role === 'super_admin') platformRole.set(r.user_id, 'SUPER_ADMIN');
        else if (r.role === 'client_setup' && !platformRole.has(r.user_id)) platformRole.set(r.user_id, 'CLIENT_SETUP');
      }

      const seenEmails = new Set<string>();
      const displayNames = new Map<string, string>();
      const userRows: Row[] = [];
      let withHash = 0;
      for (const u of authUsers) {
        const email = String(u.email ?? '').trim().toLowerCase();
        if (!email) { skip('users', u.id, 'no email'); continue; }
        if (seenEmails.has(email)) throw new Error(`Duplicate email after lower-casing: ${email}`);
        seenEmails.add(email);
        const p = profiles.get(u.id);
        const meta = (u.raw_user_meta_data ?? {}) as Row;
        const full = String(p?.display_name || meta.full_name || meta.name || email.split('@')[0]).trim();
        displayNames.set(u.id, full);
        const [first, ...rest] = full.split(/\s+/);
        const hash = typeof u.encrypted_password === 'string' && /^\$2[aby]\$/.test(u.encrypted_password) ? u.encrypted_password : null;
        if (hash) withHash++;
        const banned = u.banned_until && new Date(u.banned_until) > new Date();
        userRows.push({
          id: u.id,
          email,
          password_hash: hash ?? bcrypt.hashSync(randomBytes(32).toString('hex'), 4),
          has_password: !!hash,
          first_name: first || email.split('@')[0],
          last_name: rest.join(' '),
          phone: orNull(u.phone),
          display_name: full,
          accent_skin: p?.accent_skin ?? null,
          onboarded: p?.onboarded ?? false,
          is_email_verified: !!u.email_confirmed_at,
          is_active: !u.deleted_at && !banned,
          platform_role: platformRole.get(u.id) ?? null,
          google_sub: googleSub.get(u.id) ?? null,
          created_at: iso(u.created_at),
          updated_at: iso(u.updated_at ?? u.created_at),
        });
      }
      userRows.push({
        id: SYSTEM_USER_ID, email: 'legacy-import@system.invalid', password_hash: bcrypt.hashSync(randomBytes(32).toString('hex'), 4),
        has_password: false, first_name: 'Legacy', last_name: 'Import', phone: null, display_name: 'Legacy import', accent_skin: null,
        onboarded: true, is_email_verified: false, is_active: false, platform_role: null, google_sub: null,
        created_at: iso(new Date()), updated_at: iso(new Date()),
      });
      await insert(tx, 'users', userRows, authUsers.length + 1);
      userRows.forEach((r) => idsOf('users').add(r.id));
      note(`${withHash} of ${authUsers.length} users carry their bcrypt hash and can sign in with the existing password; ${authUsers.length - withHash} have none (Google-only or no password set).`);

      await insert(
        tx,
        'user_security',
        authUsers.filter((u) => seenEmails.has(String(u.email).trim().toLowerCase())).map((u) => ({
          id: detId(`user_security:${u.id}`), user_id: u.id, pin_hash: null, pin_set_at: null, last_login_at: iso(u.last_sign_in_at),
        })),
      );
      const pinUsers = (await src<{ n: bigint }>(`select count(*) n from user_security where pin_hash is not null`))[0].n;
      note(`${pinUsers} users had a disbursement PIN; its hash format (scrypt / salted JSON) is not compatible, so they must set a new PIN.`);

      // ── billing plans, workspaces, subscriptions ───────────────────────────
      console.log('workspaces…');
      const plans = await src(`select * from billing_plans order by sort_order`);
      const planRows = plans.map((p) => ({
        id: p.id, tier: PLAN_TIER[p.code] ?? (() => { throw new Error(`No tier mapping for plan code ${p.code}`); })(),
        name: p.name, price_monthly: p.monthly_amount, features: {}, code: p.code, currency: p.currency, description: p.description,
        is_active: p.is_active, prepay_monthly_amount: p.prepay_monthly_amount, prepay_months: p.prepay_months,
        product_type: p.product_type, setup_fee: p.setup_fee, sort_order: p.sort_order,
      }));
      await insert(tx, 'billing_plans', planRows);
      const planCode = new Map(plans.map((p) => [p.id, p.code as string]));

      const wsSrc = await src(`select * from workspaces order by created_at`);
      const subs = new Map((await src(`select * from workspace_subscriptions`)).map((s) => [s.workspace_id, s]));
      const cfg = await src(`select workspace_id::text, key, value, is_sensitive from app_config`);
      const cfgOf = (ws: string, key: string) => cfg.find((c) => c.workspace_id === ws && c.key === key)?.value as string | undefined;
      const invNumbers = await src<{ workspace_id: string; invoice_number: string | null; quote_number: string | null }>(`select workspace_id::text, invoice_number, quote_number from invoices`);
      const prefixOf = (n: string | null | undefined) => (n ?? '').match(/^(.*)-\d+$/)?.[1] ?? null;
      const prefixes = new Map<string, { inv?: string; qte?: string }>();
      for (const r of invNumbers) {
        const e = prefixes.get(r.workspace_id) ?? {};
        e.inv ??= prefixOf(r.invoice_number) ?? undefined;
        e.qte ??= prefixOf(r.quote_number) ?? undefined;
        prefixes.set(r.workspace_id, e);
      }

      const wsRows = wsSrc.map((w) => {
        const s = subs.get(w.id);
        const cs = s?.client_status ? mapEnum('client_status', s.client_status, WORKSPACE_STATUS) : 'TRIAL';
        const sub = s?.status ? mapEnum('subscription status', s.status, SUBSCRIPTION_STATUS) : 'TRIALING';
        const status = s?.status === 'suspended' && cs !== 'DEAD' ? 'SUSPENDED' : cs;
        const row: Row = {
          id: w.id, name: w.name, slug: w.slug, logo_url: w.logo_url, currency: w.currency, timezone: w.timezone,
          industry: orNull(cfgOf(w.id, 'industry')),
          status, subscription_status: sub,
          plan_tier: s?.plan_id ? PLAN_TIER[planCode.get(s.plan_id) ?? ''] ?? null : null,
          monthly_amount: s?.monthly_amount ?? null, billing_day: s?.billing_day ?? null,
          paid_until: iso(s?.paid_until), next_due_date: iso(s?.next_due_date), notes: s?.notes ?? null,
          trial_end_date: iso(s?.trial_ends_at),
          monnify_reserved_account_number: orNull(cfgOf(w.id, 'monnify_acct_no')),
          monnify_reserved_account_name: orNull(cfgOf(w.id, 'monnify_acct_name')),
          monnify_reserved_account_bank: orNull(cfgOf(w.id, 'monnify_bank')),
          monnify_reserved_account_ref: orNull(cfgOf(w.id, 'monnify_account_reference')),
          monnify_contract_code: orNull(cfgOf(w.id, 'monnify_contract_code')),
          billing_account_bank: s?.collection_bank_name ?? null, billing_account_name: s?.collection_account_name ?? null,
          billing_account_number: s?.collection_account_number ?? null, billing_account_ref: s?.collection_account_reference ?? null,
          created_by_id: ref('users', w.created_by, 'workspaces.created_by'),
          invoice_footer: w.invoice_footer, payout_narration_name: w.payout_narration_name,
          require_reauth_for_disbursement: w.require_reauth_for_disbursement, session_timeout_minutes: w.session_timeout_minutes,
          signature_url: w.signature_url, theme_color: w.theme_color,
          created_at: iso(w.created_at), updated_at: iso(w.updated_at ?? w.created_at),
        };
        row.invoice_prefix = prefixes.get(w.id)?.inv ?? null; // null -> column default
        return row;
      });
      await insert(tx, 'workspaces', wsRows);
      wsRows.forEach((r) => idsOf('workspaces').add(r.id));

      const subRows: Row[] = [];
      for (const s of subs.values()) {
        if (!hasId('workspaces', s.workspace_id)) { skip('workspace_subscriptions', s.id, 'workspace not in source (orphan)'); continue; }
        const start = iso(s.created_at);
        subRows.push({
          id: s.id, workspace_id: s.workspace_id, billing_plan_id: s.plan_id, current_period_start: start,
          current_period_end: iso(s.current_period_end ?? s.paid_until ?? s.trial_ends_at ?? s.created_at),
          created_at: start, updated_at: iso(s.updated_at ?? s.created_at),
          client_status: s.client_status, currency: s.currency, grace_until: iso(s.grace_until), prepay_months: s.prepay_months,
          setup_fee_paid_at: iso(s.setup_fee_paid_at), trial_granted: s.trial_granted,
        });
      }
      await insert(tx, 'workspace_subscriptions', subRows, subs.size);

      // ── members & roles (collapse to highest) ──────────────────────────────
      console.log('members…');
      const members = await src(`select id::text, workspace_id::text, user_id::text, joined_at from workspace_members`);
      const rolesBy = new Map<string, Set<string>>();
      const roleCreated = new Map<string, Date>();
      for (const r of roleRows) {
        if (r.role === 'super_admin' || r.role === 'client_setup') continue;
        const k = `${r.workspace_id}|${r.user_id}`;
        (rolesBy.get(k) ?? rolesBy.set(k, new Set()).get(k)!).add(r.role);
        roleCreated.set(k, r.created_at);
      }
      const memberKeys = new Map<string, Row>(members.map((m) => [`${m.workspace_id}|${m.user_id}`, m]));
      const roleReport: Row[] = [];
      const memberRows: Row[] = [];
      for (const k of new Set([...memberKeys.keys(), ...rolesBy.keys()])) {
        const [workspaceId, userId] = k.split('|');
        if (!hasId('workspaces', workspaceId) || !hasId('users', userId)) { skip('workspace_members', k, 'workspace or user missing'); continue; }
        const m = memberKeys.get(k);
        const rs = [...(rolesBy.get(k) ?? [])];
        const isBiller = rs.includes('biller');
        const real = rs.filter((r) => WORKSPACE_ROLES.includes(r)).sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a]);
        const role = (real[0] ?? 'viewer').toUpperCase();
        roleReport.push({ workspaceId, userId, lovableRoles: rs, importedRole: role, isBiller, multiRole: real.length > 1, noRoleRow: rs.length === 0, createdFromRoleOnly: !m });
        memberRows.push({
          id: m?.id ?? detId(`member:${k}`), workspace_id: workspaceId, user_id: userId, role, is_biller: isBiller, is_active: true,
          joined_at: iso(m?.joined_at ?? roleCreated.get(k)),
        });
      }
      await insert(tx, 'workspace_members', memberRows);
      report.roles = {
        members: roleReport.length,
        multiRole: roleReport.filter((r) => r.multiRole),
        noRoleRowDefaultedToViewer: roleReport.filter((r) => r.noRoleRow).length,
        createdFromRoleRowOnly: roleReport.filter((r) => r.createdFromRoleOnly).length,
        billers: roleReport.filter((r) => r.isBiller).length,
        platformRoles: [...platformRole.entries()].map(([userId, role]) => ({ userId, role })),
      };

      // ── app_config ─────────────────────────────────────────────────────────
      console.log('app_config…');
      const cfgRows: Row[] = [];
      for (const c of cfg) {
        if (EXCLUDED_CONFIG_KEYS.has(c.key) || isSeriesKey(c.key)) { report.excludedConfigKeys[c.key] = (report.excludedConfigKeys[c.key] ?? 0) + 1; continue; }
        if (!hasId('workspaces', c.workspace_id)) { skip('app_config', `${c.workspace_id}:${c.key}`, 'workspace missing'); continue; }
        const v = c.value as string | null;
        const parsed = typeof v === 'string' && /^\s*[\[{]/.test(v) ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v;
        cfgRows.push({ id: detId(`app_config:${c.workspace_id}:${c.key}`), workspace_id: c.workspace_id, key: c.key, value: parsed ?? null, is_sensitive: c.is_sensitive, updated_at: iso(new Date()) });
      }
      // app_config has no `id` column in the target (composite key); insert it directly.
      {
        let n = 0;
        for (let i = 0; i < cfgRows.length; i += 500) {
          const chunk = cfgRows.slice(i, i + 500).map(({ id: _id, ...rest }) => rest);
          n += await tx.$executeRawUnsafe(
            `INSERT INTO "app_config" ("workspace_id","key","value","is_sensitive","updated_at") SELECT "workspace_id","key","value","is_sensitive","updated_at" FROM jsonb_populate_recordset(null::"app_config", $1::jsonb) ON CONFLICT ("workspace_id","key") DO NOTHING`,
            JSON.stringify(chunk),
          );
        }
        stat('app_config', cfg.length, n);
      }
      // quote series: carry the detected quote prefix for workspaces that have quotes
      const quoteCfg: Row[] = [];
      for (const [wsId, p] of prefixes) if (p.qte && hasId('workspaces', wsId)) quoteCfg.push({ workspace_id: wsId, key: 'quote_prefix', value: p.qte, is_sensitive: false, updated_at: iso(new Date()) });
      if (quoteCfg.length) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "app_config" ("workspace_id","key","value","is_sensitive","updated_at") SELECT "workspace_id","key","value","is_sensitive","updated_at" FROM jsonb_populate_recordset(null::"app_config", $1::jsonb) ON CONFLICT ("workspace_id","key") DO NOTHING`,
          JSON.stringify(quoteCfg),
        );
      }

      // ── catalogue: pay categories, cost centres, locations ─────────────────
      console.log('catalogue…');
      const payCats = await src(`select * from pay_categories`);
      suffixDuplicates('pay_categories', payCats, (r) => r.workspace_id);
      await insert(tx, 'pay_categories', payCats.filter((r) => hasId('workspaces', r.workspace_id)).map((r) => ({
        id: r.id, workspace_id: r.workspace_id, name: r.name, color: r.color, sort_order: r.sort_order, include_in_budgets: r.include_in_budgets, is_active: true, created_at: iso(r.created_at),
      })), payCats.length);
      payCats.forEach((r) => idsOf('pay_categories').add(r.id));
      const payCatByName = new Map(payCats.map((r) => [`${r.workspace_id}|${r.name}`, r.id as string]));
      const payCatName = new Map(payCats.map((r) => [r.id as string, r.name as string]));
      const payCatWs = new Map(payCats.map((r) => [r.id as string, r.workspace_id as string]));
      // Pay-category lookups by name must also resolve to the original (un-suffixed) names Lovable rows carry as text.
      for (const r of report.renamedDuplicates.filter((d: Row) => d.table === 'pay_categories')) payCatByName.set(`${r.workspaceId}|${r.from}`, payCatByName.get(`${r.workspaceId}|${r.from}`) ?? r.id);

      const ccs = await src(`select * from cost_centers`);
      suffixDuplicates('cost_centers', ccs, (r) => r.workspace_id);
      await insert(tx, 'cost_centers', ccs.map((r) => ({
        id: r.id, workspace_id: r.workspace_id, name: r.name, code: r.code, sort_order: r.sort_order, is_active: r.active, color: r.color, created_at: iso(r.created_at), has_locations: r.has_locations,
      })));
      ccs.forEach((r) => idsOf('cost_centers').add(r.id));

      const locs = await src(`select * from locations`);
      suffixDuplicates('locations', locs, (r) => `${r.workspace_id}|${r.cost_center_id}`);
      await insert(tx, 'locations', locs.map((r) => ({
        id: r.id, workspace_id: r.workspace_id, cost_center_id: ref('cost_centers', r.cost_center_id, 'locations.cost_center_id'), name: r.name,
        is_general: r.is_general, sort_order: r.sort_order, is_active: r.active, code: r.code, color: r.color, created_at: iso(r.created_at),
      })));
      locs.forEach((r) => idsOf('locations').add(r.id));

      // ── COA tags (target requires a pay category for every tag) ────────────
      console.log('coa tags…');
      const tagKey = (ws: string, pc: string, name: string) => `${ws}|${pc}|${name}`;
      const tags = new Map<string, Row>(); // tagKey -> row
      const tagsByName = new Map<string, string>(); // ws|name -> id (first)
      let syntheticTags = 0;
      const addTag = (ws0: string, pc: string, name: string, synthetic: boolean): string => {
        const ws = payCatWs.get(pc) ?? ws0; // a tag always belongs to its pay category's workspace
        const k = tagKey(ws, pc, name);
        const existing = tags.get(k);
        if (existing) return existing.id;
        const row = { id: detId(`coa_tag:${k}`), workspace_id: ws, pay_category_id: pc, name, sort_order: 0, is_active: true, created_at: iso(new Date()) };
        tags.set(k, row);
        if (!tagsByName.has(`${ws}|${name}`)) tagsByName.set(`${ws}|${name}`, row.id);
        if (synthetic) syntheticTags++;
        return row.id;
      };
      for (const c of cfg.filter((c) => c.key === 'coa_by_category' && hasId('workspaces', c.workspace_id))) {
        const map = JSON.parse(c.value ?? '{}') as Record<string, string[]>;
        for (const [pc, names] of Object.entries(map)) {
          if (!hasId('pay_categories', pc) || payCatWs.get(pc) !== c.workspace_id) continue;
          names.forEach((n) => !blank(n) && addTag(c.workspace_id, pc, n.trim(), false));
        }
      }
      /** Resolve a Lovable free-text COA to a tag id (preferring the row's own pay category); create one when the row has a category. */
      const usage = new Map<string, Map<string, number>>(); // ws|coa -> payCatId -> uses
      const useCoa = (ws: string, coa: unknown, pc: string | null) => {
        if (blank(coa) || !pc) return;
        const k = `${ws}|${String(coa).trim()}`;
        const m = usage.get(k) ?? usage.set(k, new Map()).get(k)!;
        m.set(pc, (m.get(pc) ?? 0) + 1);
      };
      const inferredPayCat = (ws: string, name: string): string | null => {
        const m = usage.get(`${ws}|${name}`);
        return m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
      };
      const coaTag = (ws: string, text: unknown, payCatId: string | null): string | null => {
        if (blank(text)) return null;
        const name = String(text).trim();
        if (payCatId && tags.has(tagKey(ws, payCatId, name))) return tags.get(tagKey(ws, payCatId, name))!.id;
        const any = tagsByName.get(`${ws}|${name}`);
        if (any) return any;
        const pc = payCatId ?? inferredPayCat(ws, name);
        return pc ? addTag(ws, pc, name, true) : null;
      };
      const payCatOf = (ws: string, id: unknown, name?: unknown): string | null =>
        (typeof id === 'string' && hasId('pay_categories', id) ? id : null) ?? (typeof name === 'string' ? payCatByName.get(`${ws}|${name}`) ?? null : null);

      // Pre-pass: every table that carries a COA text, so tags exist before the dependents are inserted.
      const stockExp = await src(`select * from stock_expenses`);
      const budgetsSrc = await src(`select * from budgets`);
      const reqsSrc = await src(`select * from requisitions`);
      const queueSrc = await src(`select * from queue_items`);
      const biSrc = await src(`select * from batch_items`);
      const batchesSrc = await src(`select * from batches`);
      for (const r of reqsSrc) useCoa(r.workspace_id, r.coa, payCatOf(r.workspace_id, r.pay_cat_id));
      for (const r of queueSrc) useCoa(r.workspace_id, r.coa, payCatOf(r.workspace_id, r.pay_cat_id, r.pay_cat_name));
      for (const r of biSrc) useCoa(r.workspace_id, r.coa, payCatOf(r.workspace_id, null, r.category));
      for (const r of stockExp) useCoa(r.workspace_id, r.coa, payCatOf(r.workspace_id, r.pay_cat_id));
      const tagOf = new Map<string, string | null>(); // `${table}|${id}` -> tag id
      for (const r of stockExp) tagOf.set(`stock|${r.id}`, coaTag(r.workspace_id, r.coa, payCatOf(r.workspace_id, r.pay_cat_id)));
      for (const r of reqsSrc) tagOf.set(`req|${r.id}`, coaTag(r.workspace_id, r.coa, payCatOf(r.workspace_id, r.pay_cat_id)));
      for (const r of queueSrc) tagOf.set(`queue|${r.id}`, coaTag(r.workspace_id, r.coa, payCatOf(r.workspace_id, r.pay_cat_id, r.pay_cat_name)));
      for (const r of biSrc) tagOf.set(`bi|${r.id}`, coaTag(r.workspace_id, r.coa, payCatOf(r.workspace_id, null, r.category)));
      const budgetTag = new Map<string, string>();
      const extraPayCats = new Map<string, Row>();
      for (const b of budgetsSrc) {
        const pc = payCatOf(b.workspace_id, b.pay_cat_id);
        let t = coaTag(b.workspace_id, b.coa_tag, pc);
        if (!t && pc) t = addTag(b.workspace_id, pc, payCatName.get(pc)!, true);
        // Budget for a COA that no transaction uses and that has no category: the local model needs a category, so park it in a per-workspace bucket.
        if (!t && !blank(b.coa_tag)) {
          const id = detId(`pay_category:unassigned:${b.workspace_id}`);
          if (!extraPayCats.has(id)) {
            extraPayCats.set(id, { id, workspace_id: b.workspace_id, name: 'Unassigned (imported budgets)', color: null, sort_order: 999, include_in_budgets: true, is_active: true, created_at: iso(new Date()) });
            payCatWs.set(id, b.workspace_id);
            idsOf('pay_categories').add(id);
          }
          t = addTag(b.workspace_id, id, String(b.coa_tag).trim(), true);
        }
        if (t) budgetTag.set(b.id, t);
      }
      await insert(tx, 'pay_categories', [...extraPayCats.values()], 0);
      if (extraPayCats.size) note(`${extraPayCats.size} workspace(s) got an "Unassigned (imported budgets)" pay category to hold budgets for COAs that have no category.`);
      await insert(tx, 'coa_tags', [...tags.values()]);
      [...tags.values()].forEach((t) => idsOf('coa_tags').add(t.id));
      report.syntheticCoaTags = syntheticTags;

      // ── vendors / customers / products / stock expenses / wht rates ────────
      console.log('vendors & customers…');
      const vendors = await src(`select * from vendors`);
      suffixDuplicates('vendors', vendors, (r) => r.workspace_id);
      await insert(tx, 'vendors', vendors.map((v) => ({
        id: v.id, workspace_id: v.workspace_id, name: v.name, contact_person: v.contact, phone: v.phone, bank_account_number: v.acct_no,
        bank_code: v.bank_code, bank_name: v.bank, verified_account_name: v.verified_account_name, account_name: v.verified_account_name,
        verified_at: iso(v.verified_at), is_bank_verified: !!v.verified_at, tin: v.tin, tags: v.tags ?? [], wht_exempt: v.wht_exempt, wht_rate: v.wht_rate,
        is_active: true, created_at: iso(v.created_at), updated_at: iso(v.created_at), notify_channel: v.notify_channel, notify_opt_in: v.notify_opt_in,
      })));
      vendors.forEach((v) => idsOf('vendors').add(v.id));
      const vendorById = new Map(vendors.map((v) => [v.id as string, v]));

      const customers = await src(`select * from customers`);
      suffixDuplicates('customers', customers, (r) => r.workspace_id);
      await insert(tx, 'customers', customers.map((c) => ({
        id: c.id, workspace_id: c.workspace_id, name: c.name, email: c.email, phone: c.phone, address: c.address, tax_id: c.tax_id, notes: c.notes,
        is_archived: c.archived, created_at: iso(c.created_at), updated_at: iso(c.updated_at),
      })));
      customers.forEach((c) => idsOf('customers').add(c.id));

      const products = await src(`select * from products`);
      suffixDuplicates('products', products, (r) => r.workspace_id);
      await insert(tx, 'products', products.map((p) => ({
        id: p.id, workspace_id: p.workspace_id, name: p.name, description: p.description, sku: p.sku, unit_name: p.unit_name, unit_price: p.unit_price,
        tax_rate: p.tax_rate, is_active: p.active, created_at: iso(p.created_at), updated_at: iso(p.updated_at),
      })));
      products.forEach((p) => idsOf('products').add(p.id));

      suffixDuplicates('stock_expenses', stockExp, (r) => r.workspace_id);
      await insert(tx, 'stock_expenses', stockExp.map((s) => ({
        id: s.id, workspace_id: s.workspace_id, name: s.name, description: s.description,
        pay_category_id: payCatOf(s.workspace_id, s.pay_cat_id), coa_tag_id: tagOf.get(`stock|${s.id}`) ?? null,
        vendor_id: ref('vendors', s.vendor_id, 'stock_expenses.vendor_id'), unit_name: s.unit_name, unit_amount: s.unit_amt, is_active: s.active,
        created_at: iso(s.created_at), updated_at: iso(s.updated_at),
      })));

      const whtRates = await src(`select * from wht_rates`);
      await insert(tx, 'wht_rates', whtRates.map((w) => ({
        id: w.id, workspace_id: w.workspace_id, coa: w.coa, rate: w.rate, label: w.label, created_at: iso(w.created_at), updated_at: iso(w.updated_at),
      })));

      // ── budgets ────────────────────────────────────────────────────────────
      console.log('budgets…');
      const budgetMap = new Map<string, Row>();
      for (const b of budgetsSrc) {
        const tagId = budgetTag.get(b.id);
        if (!tagId) { skip('budgets', b.id, 'no COA tag and no pay category'); continue; }
        const month = iso(b.period_month)!.slice(0, 7);
        const cc = ref('cost_centers', b.cost_center_id, 'budgets.cost_center_id');
        const k = `${b.workspace_id}|${month}|${cc ?? ''}|${tagId}`;
        const existing = budgetMap.get(k);
        if (existing) {
          existing.monthly_amount = num(existing.monthly_amount) + num(b.amount);
          note(`budget ${b.id} duplicated ${existing.id} (same month/cost centre/tag); amounts were summed.`);
          continue;
        }
        budgetMap.set(k, {
          id: b.id, workspace_id: b.workspace_id, period_month: month, cost_center_id: cc, coa_tag_id: tagId, monthly_amount: b.amount,
          created_at: iso(b.created_at), updated_at: iso(b.updated_at), location_id: ref('locations', b.location_id, 'budgets.location_id'),
          pay_category_id: payCatOf(b.workspace_id, b.pay_cat_id),
        });
      }
      await insert(tx, 'budgets', [...budgetMap.values()], budgetsSrc.length);

      // ── procurement / requisitions ─────────────────────────────────────────
      console.log('requisitions…');
      await insert(tx, 'procurement_approvers', (await src(`select * from procurement_approvers`)).filter((r) => hasId('users', r.user_id)).map((r) => ({
        id: r.id, workspace_id: r.workspace_id, user_id: r.user_id, approval_role: r.approval_role, is_backup: r.is_backup, created_by_id: ref('users', r.created_by, 'procurement_approvers.created_by'), created_at: iso(r.created_at),
      })));

      suffixDuplicates('requisitions', reqsSrc, (r) => r.workspace_id, 'req_ref', (n, i) => `${n}-DUP${i}`);
      const REQ_STATUS: Record<string, string> = { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED', PROCUREMENT_CLEARED: 'PROCUREMENT_CLEARED', RETURNED: 'RETURNED', QUEUED: 'QUEUED', REJECTED: 'REJECTED' };
      await insert(tx, 'requisitions', reqsSrc.map((r) => {
        const status = mapEnum('requisition status', r.status, REQ_STATUS);
        if (!r.requester_user_id || !hasId('users', r.requester_user_id)) sysUse('requisitions.requested_by_id');
        return {
          id: r.id, workspace_id: r.workspace_id, req_ref: r.req_ref, date: iso(r.date), department_id: null, department_name: r.department_name,
          requested_by_id: hasId('users', r.requester_user_id) ? r.requester_user_id : SYSTEM_USER_ID, requester_name: r.requester_name,
          vendor_id: ref('vendors', r.vendor_id, 'requisitions.vendor_id'), is_new_vendor: r.is_new_vendor, vendor_name: r.vendor_name,
          vendor_bank: r.vendor_bank, vendor_bank_code: r.vendor_bank_code, vendor_acct_no: r.vendor_acct_no, vendor_acct_name: r.vendor_acct_name,
          description: r.description ?? '', units: r.units, unit_name: r.unit_name, unit_amount: r.unit_amt, total: r.total,
          bundle_id: r.bundle_id, bundle_label: r.bundle_label,
          cost_center_id: ref('cost_centers', r.cost_center_id, 'requisitions.cost_center_id'), location_id: ref('locations', r.location_id, 'requisitions.location_id'),
          pay_category_id: payCatOf(r.workspace_id, r.pay_cat_id), coa_tag_id: tagOf.get(`req|${r.id}`) ?? null,
          reason: r.reason, remarks: r.remarks, review_note: r.review_note, attachment_group_id: r.attachment_group_id, status,
          submitted_at: iso(r.submitted_at), cleared_at: iso(r.cleared_at), cleared_by_id: ref('users', r.cleared_by, 'requisitions.cleared_by'),
          returned_at: iso(r.returned_at), returned_by_id: ref('users', r.returned_by, 'requisitions.returned_by'),
          rejected_at: iso(r.rejected_at), rejected_by_id: ref('users', r.rejected_by, 'requisitions.rejected_by'),
          rejection_reason: status === 'REJECTED' ? r.review_note : null,
          queued_at: iso(r.queued_at), queued_by_id: ref('users', r.queued_by, 'requisitions.queued_by'),
          created_at: iso(r.created_at), updated_at: iso(r.updated_at ?? r.created_at), approval_round: r.approval_round,
          final_approved_at: iso(r.final_approved_at), final_approved_by_id: ref('users', r.final_approved_by, 'requisitions.final_approved_by'),
          hod_name: r.hod_name, pnl_period: r.pnl_period, staff_account_note: r.staff_account_note,
        };
      }));
      reqsSrc.forEach((r) => idsOf('requisitions').add(r.id));

      await insert(tx, 'requisition_approvals', (await src(`select * from requisition_approvals`)).filter((r) => hasId('requisitions', r.requisition_id) && hasId('users', r.approver_user_id)).map((r) => ({
        id: r.id, workspace_id: r.workspace_id, requisition_id: r.requisition_id, approval_round: r.approval_round, approver_user_id: r.approver_user_id, approval_role: r.approval_role, created_at: iso(r.created_at),
      })));
      await insert(tx, 'goods_receipts', (await src(`select * from goods_receipts`)).filter((r) => hasId('requisitions', r.requisition_id)).map((r) => ({
        id: r.id, workspace_id: r.workspace_id, requisition_id: r.requisition_id, kind: r.kind, received_qty: r.received_qty, condition: r.condition, notes: r.notes,
        first_by_id: ref('users', r.first_by, 'goods_receipts.first_by'), first_at: iso(r.first_at), second_by_id: ref('users', r.second_by, 'goods_receipts.second_by'), second_at: iso(r.second_at),
        created_at: iso(r.created_at), updated_at: iso(r.updated_at),
      })));

      // ── queue ──────────────────────────────────────────────────────────────
      console.log('queue…');
      const QUEUE_STATUS: Record<string, string> = { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
      const queueRows: Row[] = [];
      const seenQueueReq = new Set<string>();
      const norm = (n: unknown) => String(n ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
      const vendorByName = new Map<string, Row>();
      for (const v of [...vendors].sort((a, b) => +a.created_at - +b.created_at)) {
        const k = `${v.workspace_id}|${norm(v.name.replace(/ \(\d+\)$/, ''))}`;
        if (!vendorByName.has(k)) vendorByName.set(k, v);
      }
      let linkedByName = 0;
      for (const q of queueSrc) {
        if (!hasId('vendors', q.vendor_id)) {
          const v = q.vendor_id == null ? vendorByName.get(`${q.workspace_id}|${norm(q.vendor_name)}`) : undefined;
          if (!v) { skip('queue_items', q.id, `vendor missing (${q.vendor_name ?? 'no name'}, ${q.total})`); continue; }
          q.vendor_id = v.id;
          linkedByName++;
        }
        if (!hasId('users', q.created_by)) sysUse('queue_items.created_by_id');
        let reqId = ref('requisitions', q.requisition_id, 'queue_items.requisition_id');
        if (reqId && seenQueueReq.has(reqId)) { note(`queue item ${q.id} shares requisition ${reqId}; link dropped (unique).`); reqId = null; }
        if (reqId) seenQueueReq.add(reqId);
        queueRows.push({
          id: q.id, workspace_id: q.workspace_id, date: iso(q.date), vendor_id: q.vendor_id, vendor_name: q.vendor_name, description: q.description ?? '',
          units: q.units, unit_name: q.unit_name, unit_amount: q.unit_amt, total: q.total ?? 0, wht_rate: q.wht_rate, wht_amount: q.wht_amount, net_amount: q.net_amount,
          pay_category_id: payCatOf(q.workspace_id, q.pay_cat_id, q.pay_cat_name), pay_category: q.pay_cat_name, coa_tag_id: tagOf.get(`queue|${q.id}`) ?? null, coa_tag: q.coa,
          cost_center_id: ref('cost_centers', q.cost_center_id, 'queue_items.cost_center_id'), location_id: ref('locations', q.location_id, 'queue_items.location_id'),
          pnl_period: q.pnl_period, is_urgent: q.is_urgent, bundle_id: q.bundle_id, bundle_label: q.bundle_label, requisition_id: reqId, attachment_group_id: q.attachment_group_id,
          status: mapEnum('queue status', q.status, QUEUE_STATUS), budget_flag: !blank(q.budget_tag), budget_tag: q.budget_tag,
          created_by_id: hasId('users', q.created_by) ? q.created_by : SYSTEM_USER_ID, created_by_name: displayNames.get(q.created_by) ?? null,
          rejected_reason: q.rejected_reason, rejected_by_id: ref('users', q.rejected_by, 'queue_items.rejected_by'), rejected_at: iso(q.rejected_at),
          created_at: iso(q.created_at), updated_at: iso(q.rejected_at ?? q.created_at),
        });
      }
      if (linkedByName) note(`${linkedByName} queue items had no vendor id; linked to the vendor with the same name in the workspace.`);
      await insert(tx, 'queue_items', queueRows, queueSrc.length);
      queueRows.forEach((q) => idsOf('queue_items').add(q.id));

      const queueByGroup = new Map<string, string>();
      for (const q of queueSrc) if (q.attachment_group_id && hasId('queue_items', q.id)) queueByGroup.set(q.attachment_group_id, q.id);
      const atts = await src(`select * from queue_item_attachments`);
      await insert(tx, 'queue_item_attachments', atts.map((a) => {
        if (!hasId('users', a.uploaded_by)) sysUse('queue_item_attachments.uploaded_by_id');
        return {
          id: a.id, workspace_id: a.workspace_id, attachment_group_id: a.attachment_group_id, queue_item_id: queueByGroup.get(a.attachment_group_id) ?? null,
          storage_path: a.storage_path, file_url: null, file_name: a.file_name, mime_type: a.mime_type, size_bytes: a.size_bytes == null ? null : Number(a.size_bytes),
          uploaded_by_id: hasId('users', a.uploaded_by) ? a.uploaded_by : SYSTEM_USER_ID, created_at: iso(a.created_at),
        };
      }));
      await insert(tx, 'queue_item_comments', (await src(`select * from queue_item_comments`)).filter((c) => hasId('queue_items', c.queue_item_id) && hasId('users', c.user_id)).map((c) => ({
        id: c.id, queue_item_id: c.queue_item_id, user_id: c.user_id, author_name: displayNames.get(c.user_id) ?? null, body: c.body, created_at: iso(c.created_at),
      })));

      // ── batches & items ────────────────────────────────────────────────────
      console.log('batches…');
      const BATCH_STATUS: Record<string, string> = { PENDING: 'PENDING', PROCESSING: 'PROCESSING', PARTIAL: 'PARTIAL', SUCCESS: 'SUCCESS', CANCELLED: 'CANCELLED' };
      const ITEM_STATUS: Record<string, string> = { SUCCESS: 'SUCCESS', PARTIAL: 'PENDING', CANCELLED: 'CANCELLED', FAILED: 'FAILED', PENDING: 'PENDING' };
      const itemsByBatch = new Map<string, Row[]>();
      for (const i of biSrc) (itemsByBatch.get(i.batch_id) ?? itemsByBatch.set(i.batch_id, []).get(i.batch_id)!).push(i);
      const batchCreated = new Map(batchesSrc.map((b) => [b.id as string, b.created_at as Date]));
      const batchRows = batchesSrc.map((b) => {
        const items = itemsByBatch.get(b.id) ?? [];
        const creator = items.map((i) => i.created_by).find((u) => hasId('users', u)) ?? items.map((i) => i.approved_by).find((u) => hasId('users', u));
        if (!creator) sysUse('batches.created_by_id');
        const approvedAt = items.map((i) => i.approved_at).filter(Boolean).sort((a: Date, b2: Date) => +a - +b2)[0];
        const approver = items.map((i) => i.approved_by).find((u) => hasId('users', u));
        return {
          id: b.id, workspace_id: b.workspace_id, batch_ref: b.batch_ref, pay_category_id: payCatOf(b.workspace_id, null, b.pay_cat), pay_cat: b.pay_cat, pay_cat_color: b.pay_cat_color,
          date: iso(b.date), total: b.total, payout_status: b.payout_status ? mapEnum('batch payout_status', b.payout_status, BATCH_STATUS) : null,
          created_by_id: creator ?? SYSTEM_USER_ID, approved_by_id: approver ?? null, approved_at: iso(approvedAt), cancelled_at: iso(b.cancelled_at),
          cancelled_by_id: ref('users', b.cancelled_by, 'batches.cancelled_by'), cancelled_reason: b.cancelled_reason, synced_to_sheets: b.synced_to_sheets,
          created_at: iso(b.created_at), updated_at: iso(b.created_at), payout_batch_reference: b.payout_batch_reference,
        };
      });
      await insert(tx, 'batches', batchRows);
      batchesSrc.forEach((b) => idsOf('batches').add(b.id));

      console.log('batch items…');
      let orphanLines = 0, orphanAmount = 0, partial = 0;
      const itemRows = biSrc.map((i) => {
        const orphan = i.vendor_id != null && !hasId('vendors', i.vendor_id);
        if (orphan) { orphanLines++; orphanAmount += num(i.total); }
        const ps = mapEnum('batch item payout_status', i.payout_status, ITEM_STATUS);
        if (String(i.payout_status).toUpperCase() === 'PARTIAL') partial++;
        const v = hasId('vendors', i.vendor_id) ? vendorById.get(i.vendor_id) : null;
        const created = iso(i.paid_at ?? batchCreated.get(i.batch_id));
        return {
          id: i.id, batch_id: i.batch_id, queue_item_id: null, date: iso(i.date), vendor_id: v ? i.vendor_id : null, vendor_name: i.vendor_name ?? '',
          vendor_bank: i.vendor_bank, vendor_bank_code: i.vendor_bank_code, vendor_acct_no: i.vendor_acct_no, vendor_acct_name: v?.verified_account_name ?? null,
          description: i.description ?? '', bundle_id: i.bundle_id, bundle_label: i.bundle_label, units: i.units, unit_name: i.unit_name, unit_amount: i.unit_amt,
          total: i.total ?? 0, wht_rate: i.wht_rate, wht_amount: i.wht_amount, net_amount: i.net_amount ?? i.total ?? 0, paid_amount: i.paid_amount,
          payout_status: ps, payout_reference: i.payout_reference, payout_message: i.payout_message,
          pay_category_id: payCatOf(i.workspace_id, null, i.category), pay_category: i.category, coa_tag_id: tagOf.get(`bi|${i.id}`) ?? null, coa_tag: i.coa,
          cost_center_id: ref('cost_centers', i.cost_center_id, 'batch_items.cost_center_id'), location_id: ref('locations', i.location_id, 'batch_items.location_id'),
          pnl_period: i.pnl_period, synced_to_sheets: i.synced_to_sheets, created_at: created, updated_at: created,
          approved_at: iso(i.approved_at), approved_by_id: ref('users', i.approved_by, 'batch_items.approved_by'), attachment_group_id: i.attachment_group_id,
          created_by_id: ref('users', i.created_by, 'batch_items.created_by'), legacy_status: i.status, legacy_vendor_id: i.vendor_id && !v ? i.vendor_id : null,
          paid_at: iso(i.paid_at), paid_by_id: ref('users', i.paid_by, 'batch_items.paid_by'), pay_started_at: iso(i.pay_started_at), queued_at: iso(i.queued_at),
          requisition_id: ref('requisitions', i.requisition_id, 'batch_items.requisition_id'),
        };
      });
      await insert(tx, 'batch_items', itemRows);
      biSrc.forEach((i) => idsOf('batch_items').add(i.id));
      report.orphanVendorLines = { lines: orphanLines, amount: Math.round(orphanAmount * 100) / 100 };
      report.partialItemsMappedToPending = partial;

      console.log('payouts…');
      const itemById = new Map(biSrc.map((i) => [i.id as string, i]));
      const payoutsSrc = await src(`select * from batch_item_payouts`);
      const PAYOUT_STATUS: Record<string, string> = { SUCCESS: 'SUCCESS', FAILED: 'FAILED', PENDING: 'PENDING', PROCESSING: 'PROCESSING', REVERSED: 'REVERSED' };
      const payoutRows: Row[] = [];
      for (const p of payoutsSrc) {
        if (!hasId('batch_items', p.batch_item_id)) { skip('batch_item_payouts', p.id, 'batch item missing'); continue; }
        const status = mapEnum('payout status', p.status, PAYOUT_STATUS);
        const leg = mapEnum('payout leg', p.leg, { VENDOR: 'VENDOR', WHT: 'WHT' });
        const it = itemById.get(p.batch_item_id)!;
        payoutRows.push({
          id: p.id, workspace_id: p.workspace_id, batch_item_id: p.batch_item_id, leg, amount: p.amount, status, reference: p.reference,
          destination_account_number: leg === 'VENDOR' ? it.vendor_acct_no : null, destination_bank_code: leg === 'VENDOR' ? it.vendor_bank_code : null,
          destination_account_name: leg === 'VENDOR' ? it.vendor_name : null,
          failure_reason: status === 'FAILED' ? p.message : null, completed_at: iso(p.created_at), created_at: iso(p.created_at), updated_at: iso(p.created_at),
          transfer_reference: p.combined_reference, message: p.message, payout_group_id: p.payout_group_id,
        });
      }
      await insert(tx, 'batch_item_payouts', payoutRows, payoutsSrc.length);
      const payoutLeg = new Map(payoutRows.map((p) => [p.id as string, p.leg as string]));

      const whtSrc = await src(`select * from wht_ledger`);
      const whtRows: Row[] = [];
      const whtRefCount = new Map<string, number>();
      for (const w of whtSrc) whtRefCount.set(w.wht_payout_reference, (whtRefCount.get(w.wht_payout_reference) ?? 0) + 1);
      let sharedWhtRefs = 0;
      for (const w of whtSrc) {
        if (!hasId('batch_items', w.batch_item_id)) { skip('wht_ledger', w.id, 'batch item missing'); continue; }
        const shared = !blank(w.wht_payout_reference) && (whtRefCount.get(w.wht_payout_reference) ?? 0) > 1;
        if (shared) sharedWhtRefs++;
        const period = /^\d{4}-\d{2}$/.test(w.period ?? '') ? `${w.period}-01` : `${iso(w.created_at)!.slice(0, 7)}-01`;
        whtRows.push({
          id: w.id, workspace_id: w.workspace_id, batch_item_id: w.batch_item_id, vendor_id: ref('vendors', w.vendor_id, 'wht_ledger.vendor_id'), gross_amount: w.gross_amount,
          wht_rate: w.wht_rate, wht_amount: w.wht_amount, tax_period: period, reference: shared ? `${w.wht_payout_reference}:${w.payout_group_id}` : w.wht_payout_reference, remitted_at: iso(w.remitted_at), created_at: iso(w.created_at),
          coa: w.coa, net_amount: w.net_amount, payout_group_id: w.payout_group_id, remit_status: w.remit_status, vendor_name: w.vendor_name,
          vendor_payout_reference: w.vendor_payout_reference, wht_payout_reference: w.wht_payout_reference,
        });
      }
      await insert(tx, 'wht_ledger', whtRows, whtSrc.length);
      if (sharedWhtRefs) note(`${sharedWhtRefs} wht_ledger rows share a wht_payout_reference with another row; their unique \`reference\` is "<ref>:<payout_group_id>" (the original stays in wht_payout_reference).`);

      // ── wallet ─────────────────────────────────────────────────────────────
      console.log('wallet…');
      await insert(tx, 'wallet_topups', (await src(`select * from wallet_topups`)).filter((t) => hasId('workspaces', t.workspace_id)).map((t) => ({
        id: t.id, workspace_id: t.workspace_id, amount: t.amount, reference: t.payment_reference, payer_name: t.payer_name, payer_bank: t.payer_bank,
        payer_account_number: t.payer_acct_no, source: 'WEBHOOK', status: 'SUCCESS', paid_at: iso(t.created_at), created_at: iso(t.created_at), completed_at: iso(t.created_at), raw_payload: t.raw_payload,
      })));

      const ledger = await src(`select * from wallet_ledger_entries order by workspace_id, posted_at, created_at, id`);
      const batchOfItem = new Map(biSrc.map((i) => [i.id as string, i.batch_id as string]));
      const payoutItem = new Map(payoutsSrc.map((p) => [p.id as string, p.batch_item_id as string]));
      const LEDGER_STATUS: Record<string, string> = { POSTED: 'COMPLETED', FAILED: 'FAILED', CANCELLED: 'REVERSED' };
      const running = new Map<string, number>();
      const ledgerRows = ledger.map((l) => {
        const direction = mapEnum('ledger direction', l.direction, { CREDIT: 'IN', DEBIT: 'OUT' });
        const status = mapEnum('ledger status', l.status, LEDGER_STATUS);
        const leg = payoutLeg.get(l.source_id);
        const type = l.source_type === 'batch_item_payouts' ? (leg === 'WHT' ? 'WHT_WITHHOLDING' : 'DISBURSEMENT') : l.source_type === 'wallet_topups' ? 'TOPUP' : l.source_type === 'reconciliation' ? 'ADJUSTMENT' : (() => { throw new Error(`Unmapped ledger source_type ${l.source_type}`); })();
        const counts = status === 'COMPLETED';
        const signed = direction === 'IN' ? Math.abs(kobo(l.amount)) : -Math.abs(kobo(l.amount));
        const before = running.get(l.workspace_id) ?? 0;
        const after = counts ? before + signed : before;
        running.set(l.workspace_id, after);
        const itemId = payoutItem.get(l.source_id);
        return {
          id: l.id, workspace_id: l.workspace_id, type, direction, status, amount: signed / 100, balance_before: before / 100, balance_after: after / 100,
          batch_id: itemId ? ref('batches', batchOfItem.get(itemId), 'wallet_ledger_entries.batch_id') : null, reference: l.reference,
          source_type: type === 'TOPUP' ? 'topup' : type === 'WHT_WITHHOLDING' ? 'wht' : type === 'DISBURSEMENT' ? 'payout' : 'manual', source_id: l.source_id,
          description: l.description, actor_user_id: ref('users', l.actor_user_id, 'wallet_ledger_entries.actor_user_id'), posted_at: iso(l.posted_at ?? l.created_at),
          created_at: iso(l.created_at), metadata: l.metadata, source_key: l.source_key,
        };
      });
      await insert(tx, 'wallet_ledger_entries', ledgerRows);

      await insert(tx, 'wallet_sweeps', (await src(`select * from wallet_sweeps`)).filter((s) => hasId('workspaces', s.workspace_id)).map((s) => ({
        id: s.id, workspace_id: s.workspace_id, amount: s.released_amount ?? 0, created_at: iso(s.created_at), clearing: s.clearing, ledger_available: s.ledger_available,
        live_wallet_balance: s.live_wallet_balance, raw: s.raw, reason: s.reason, released_amount: s.released_amount, status: s.status,
      })));

      const waits = await src(`select * from payout_funding_waits`);
      await insert(tx, 'payout_funding_waits', waits.filter((w) => {
        if (!hasId('batches', w.batch_id)) { skip('payout_funding_waits', w.id, 'batch missing'); return false; }
        return true;
      }).map((w) => ({
        id: w.id, workspace_id: w.workspace_id, batch_id: w.batch_id, required_amount: w.amount_required, available_amount: w.ready_at_block ?? 0,
        status: w.resolved_at ? 'FUNDED' : 'WAITING', created_at: iso(w.created_at), resolved_at: iso(w.resolved_at), notified_at: iso(w.notified_at), ready_at_block: w.ready_at_block,
      })), waits.length);

      // ── invoicing ──────────────────────────────────────────────────────────
      console.log('invoices…');
      const recurrences = await src(`select * from invoice_recurrences`);
      await insert(tx, 'invoice_recurrences', recurrences.map((r) => ({
        id: r.id, workspace_id: r.workspace_id, customer_id: ref('customers', r.customer_id, 'invoice_recurrences.customer_id'), invoice_id: null,
        interval: mapEnum('recurrence cadence', r.cadence, { WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY', QUARTERLY: 'QUARTERLY', ANNUALLY: 'ANNUALLY' }),
        next_run_at: iso(r.next_run_date), ends_at: iso(r.end_date), template_items: r.template, is_active: r.active, created_at: iso(r.created_at),
      })));
      recurrences.forEach((r) => idsOf('invoice_recurrences').add(r.id));

      const tpls = await src(`select * from invoice_templates`);
      await insert(tx, 'invoice_templates', tpls.map((t) => ({
        id: t.id, workspace_id: t.workspace_id, name: t.name, notes: t.notes, terms: t.terms, currency: t.currency, created_at: iso(t.created_at),
        settings: {
          taxInclusive: t.tax_inclusive, defaultVatRate: t.default_vat_rate, defaultWhtRate: t.default_wht_rate, lateFeePercent: t.late_fee_percent, lateFeeFlat: t.late_fee_flat,
          lateFeeGraceDays: t.late_fee_grace_days, earlyPayDiscountPercent: t.early_pay_discount_percent, earlyPayDiscountDays: t.early_pay_discount_days,
        },
      })));
      tpls.forEach((t) => idsOf('invoice_templates').add(t.id));
      const DISCOUNT = (v: unknown) => (blank(v) ? null : mapEnum('discount_type', v, { PERCENT: 'PERCENT', PERCENTAGE: 'PERCENT', FLAT: 'FLAT', FIXED: 'FLAT' }));
      await insert(tx, 'invoice_template_items', (await src(`select * from invoice_template_items`)).filter((i) => hasId('invoice_templates', i.template_id)).map((i) => ({
        id: i.id, template_id: i.template_id, description: i.description ?? '', quantity: i.quantity, unit_price: i.unit_price ?? 0, vat_rate: i.vat_rate, wht_rate: i.wht_rate,
        sort_order: i.sort_order, discount_type: DISCOUNT(i.discount_type), discount_value: i.discount_value,
      })));

      const INVOICE_STATUS: Record<string, string> = { DRAFT: 'DRAFT', SENT: 'SENT', PARTIALLY_PAID: 'PARTIALLY_PAID', PAID: 'PAID', OVERDUE: 'OVERDUE', VOID: 'VOID' };
      const invoices = await src(`select * from invoices`);
      const shareTokens = new Set<string>();
      const invRows = invoices.map((v) => {
        const share = v.share_token ? String(v.share_token) : null;
        if (share && shareTokens.has(share)) throw new Error(`Duplicate share_token on invoice ${v.id}`);
        if (share) shareTokens.add(share);
        return {
          id: v.id, workspace_id: v.workspace_id, doc_type: mapEnum('doc_type', v.doc_type, { INVOICE: 'INVOICE', QUOTE: 'QUOTE' }), invoice_number: v.invoice_number, quote_number: v.quote_number,
          quote_expires_at: iso(v.quote_expires_at), converted_from_quote_id: v.converted_from_id, customer_id: v.customer_id, customer_address: v.customer_address, customer_tin: v.customer_tin,
          workspace_tin: v.workspace_tin, status: mapEnum('invoice status', v.status, INVOICE_STATUS), issue_date: iso(v.issue_date), due_date: iso(v.due_date), currency: v.currency,
          fx_rate: v.fx_rate, fx_base_currency: v.fx_base_currency, tax_inclusive: v.tax_inclusive, discount_type: DISCOUNT(v.discount_type), discount_value: v.discount_value,
          discount_amount: v.discount_amount, subtotal: v.subtotal, vat_total: v.vat_total, wht_total: v.wht_total, total: v.total, amount_due: v.amount_due, paid_amount: v.paid_amount,
          late_fee_percent: v.late_fee_percent, late_fee_flat: v.late_fee_flat, late_fee_grace_days: v.late_fee_grace_days,
          early_pay_discount_percent: v.early_pay_discount_percent, early_pay_discount_days: v.early_pay_discount_days, notes: v.notes, terms: v.terms,
          recurrence_id: ref('invoice_recurrences', v.recurrence_id, 'invoices.recurrence_id'), collection_account_number: v.collection_account_number,
          collection_account_name: v.collection_account_name, collection_bank_name: v.collection_bank_name, collection_account_ref: v.collection_account_reference,
          share_token: share, sent_at: iso(v.sent_at), voided_at: v.status === 'void' ? iso(v.updated_at) : null, created_by_id: ref('users', v.created_by, 'invoices.created_by'),
          created_at: iso(v.created_at), updated_at: iso(v.updated_at), cc_emails: v.cc_emails, collection_provisioned_at: iso(v.collection_provisioned_at),
          converted_at: iso(v.converted_at), fx_locked_at: iso(v.fx_locked_at), paid_at: iso(v.paid_at), share_token_created_at: iso(v.share_token_created_at),
          tax_amount: v.tax_amount, tax_rate: v.tax_rate,
        };
      });
      await insert(tx, 'invoices', invRows);
      invoices.forEach((v) => idsOf('invoices').add(v.id));
      report.negativeTotalInvoices = invoices.filter((v) => num(v.total) < 0).map((v) => ({ id: v.id, status: v.status, total: Number(v.total) }));

      await insert(tx, 'invoice_items', (await src(`select * from invoice_items`)).filter((i) => hasId('invoices', i.invoice_id)).map((i) => ({
        id: i.id, invoice_id: i.invoice_id, product_id: null, description: i.description ?? '', quantity: i.quantity, unit_price: i.unit_price ?? 0, vat_rate: i.vat_rate, wht_rate: i.wht_rate,
        line_total: i.line_total, sort_order: i.sort_order, discount_amount: i.discount_amount, discount_type: DISCOUNT(i.discount_type), discount_value: i.discount_value,
        tax_inclusive: i.tax_inclusive, vat_amount: i.vat_amount, wht_amount: i.wht_amount,
      })));
      await insert(tx, 'invoice_sends', (await src(`select * from invoice_sends`)).filter((s) => hasId('invoices', s.invoice_id)).map((s) => ({
        id: s.id, invoice_id: s.invoice_id, channel: s.channel, sent_to: s.recipient ?? '', cc: null, sent_at: iso(s.created_at), error: s.error, message: s.message,
        provider_message_id: s.provider_message_id, sent_by_id: ref('users', s.sent_by, 'invoice_sends.sent_by'), status: s.status,
      })));
      await insert(tx, 'customer_credits', (await src(`select * from customer_credits`)).filter((c) => hasId('customers', c.customer_id)).map((c) => ({
        id: c.id, workspace_id: c.workspace_id, customer_id: c.customer_id, amount: c.amount, note: c.note, status: mapEnum('credit status', c.status, { OPEN: 'OPEN', APPLIED: 'APPLIED', REFUNDED: 'REFUNDED' }),
        applied_to_invoice_id: ref('invoices', c.applied_to_invoice_id, 'customer_credits.applied_to_invoice_id'), source_invoice_id: ref('invoices', c.source_invoice_id, 'customer_credits.source_invoice_id'),
        created_at: iso(c.created_at), created_by_id: ref('users', c.created_by, 'customer_credits.created_by'), currency: c.currency,
      })));
      const csubs = await src(`select * from customer_subscriptions`);
      await insert(tx, 'customer_subscriptions', csubs.filter((s) => hasId('customers', s.customer_id)).map((s) => ({
        id: s.id, workspace_id: s.workspace_id, customer_id: s.customer_id, plan_name: s.plan_name, description: s.description,
        interval: mapEnum('subscription frequency', s.frequency, { WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY', QUARTERLY: 'QUARTERLY', ANNUALLY: 'ANNUALLY' }), amount: s.amount,
        status: mapEnum('customer subscription status', s.status, { PENDING_MANDATE: 'PENDING_MANDATE', ACTIVE: 'ACTIVE', CANCELLED: 'CANCELLED' }),
        next_run_at: iso(s.next_charge_date), last_charged_at: iso(s.last_charged_at), cancelled_at: iso(s.cancelled_at), is_active: s.status !== 'cancelled',
        created_at: iso(s.created_at), updated_at: iso(s.updated_at), billing_day: s.billing_day, created_by_id: ref('users', s.created_by, 'customer_subscriptions.created_by'),
        currency: s.currency, start_date: iso(s.start_date),
      })), csubs.length);

      // ── notifications, logs ────────────────────────────────────────────────
      console.log('notifications & logs…');
      const prefRows: Row[] = [];
      for (const p of await src(`select * from notification_prefs`)) {
        if (!hasId('users', p.user_id) || !hasId('workspaces', p.workspace_id)) continue;
        for (const event of ['queue_added', 'batch_pending_approval', 'disbursement_result']) {
          for (const [channel, flag] of [['EMAIL', p.email_channel], ['IN_APP', p.in_app_channel]] as const) {
            prefRows.push({ id: detId(`pref:${p.id}:${event}:${channel}`), workspace_id: p.workspace_id, user_id: p.user_id, channel, event, is_enabled: !!p[event] && !!flag });
          }
        }
      }
      await insert(tx, 'notification_prefs', prefRows, Number((await src<{ n: bigint }>(`select count(*) n from notification_prefs`))[0].n));

      await insert(tx, 'email_send_log', (await src(`select * from email_send_log`)).map((e) => ({
        id: e.id, to_email: e.recipient_email ?? '', template: e.template_name ?? '', status: e.status ?? '', created_at: iso(e.created_at), error_message: e.error_message, message_id: e.message_id, metadata: e.metadata,
      })));
      await insert(tx, 'suppressed_emails', (await src(`select * from suppressed_emails`)).map((e) => ({ id: e.id, email: e.email, reason: e.reason ?? '', created_at: iso(e.created_at), metadata: e.metadata })));
      await insert(tx, 'client_errors', (await src(`select * from client_errors`)).map((e) => ({
        id: e.id, message: e.message, stack: e.stack, url: e.url, user_agent: e.user_agent, created_at: iso(e.created_at), metadata: e.metadata, severity: e.severity, source: e.source,
        user_email: e.user_email, user_id: ref('users', e.user_id, 'client_errors.user_id'), workspace_id: ref('workspaces', e.workspace_id, 'client_errors.workspace_id'),
      })));
      await insert(tx, 'audit_log', (await src(`select * from audit_log`)).map((a) => ({
        id: a.id, workspace_id: ref('workspaces', a.workspace_id, 'audit_log.workspace_id'), user_id: ref('users', a.actor_user_id, 'audit_log.user_id'), actor_email: a.actor_email,
        action: a.action ?? '', target: a.target, metadata: a.metadata, created_at: iso(a.created_at),
      })));

      // ── tables deliberately not imported ───────────────────────────────────
      for (const t of ['email_send_state', 'payment_receipts', 'client_mandate_invites', 'push_subscriptions', 'email_unsubscribe_tokens']) {
        const n = Number((await src<{ n: bigint }>(`select count(*) n from "${t}"`))[0].n);
        stat(t, n, 0);
      }
      for (const t of ['billing_payments', 'client_mandates', 'departments', 'invoice_payments', 'invoice_sweeps', 'recurring_payments', 'settlement_batch_items', 'settlement_batches', 'subscription_charge_attempts', 'subscription_dunning_state']) {
        const n = Number((await src<{ n: bigint }>(`select count(*) n from "${t}"`).catch(() => [{ n: BigInt(0) }]))[0].n);
        if (n > 0) throw new Error(`${t} now has ${n} rows in the source, but the schema/mapping skipped it. Extend the schema first.`);
      }

      // ── reconciliation (aborts the whole import on any mismatch) ───────────
      console.log('reconciling…');
      const failures: string[] = [];
      const check = (label: string, a: unknown, b: unknown) => { if (String(a) !== String(b)) failures.push(`${label}: source ${a} != target ${b}`); };

      const walletSrc = await src(`select workspace_id::text w, sum(amount) filter (where direction='credit' and status='posted') cr, sum(amount) filter (where direction='debit' and status='posted') dr from wallet_ledger_entries group by 1 order by 1`);
      const walletTgt = await tx.$queryRawUnsafe<Row[]>(`select workspace_id w, sum(abs(amount)) filter (where direction='IN' and status='COMPLETED') cr, sum(abs(amount)) filter (where direction='OUT' and status='COMPLETED') dr from wallet_ledger_entries group by 1 order by 1`);
      check('wallet workspaces', walletSrc.length, walletTgt.length);
      for (const s of walletSrc) {
        const t = walletTgt.find((x) => x.w === s.w);
        check(`wallet credits ${s.w}`, kobo(s.cr), kobo(t?.cr));
        check(`wallet debits ${s.w}`, kobo(s.dr), kobo(t?.dr));
      }
      report.walletBalances = walletSrc.map((s) => ({ workspaceId: s.w, credits: num(s.cr), debits: num(s.dr), balance: Math.round((num(s.cr) - num(s.dr)) * 100) / 100 }));

      const sums = async (sqlSrc: string, sqlTgt: string, label: string) => {
        const a = await src(sqlSrc);
        const b = await tx.$queryRawUnsafe<Row[]>(sqlTgt);
        check(`${label} groups`, a.length, b.length);
        for (const r of a) {
          const m = b.find((x) => x.k === r.k);
          check(`${label}[${r.k}] n`, Number(r.n), Number(m?.n));
          check(`${label}[${r.k}] total`, kobo(r.t), kobo(m?.t));
        }
      };
      await sums(
        `select case when upper(payout_status)='PARTIAL' then 'PENDING' else upper(payout_status) end k, count(*) n, sum(total) t from batch_items group by 1`,
        `select payout_status::text k, count(*) n, sum(total) t from batch_items group by 1`, 'batch_items',
      );
      await sums(`select upper(status) k, count(*) n, sum(total) t from invoices group by 1`, `select status::text k, count(*) n, sum(total) t from invoices group by 1`, 'invoices');
      await sums(`select upper(status) k, count(*) n, sum(amount) t from batch_item_payouts group by 1`, `select status::text k, count(*) n, sum(amount) t from batch_item_payouts group by 1`, 'payouts');
      await sums(`select 'all' k, count(*) n, sum(wht_amount) t from wht_ledger`, `select 'all' k, count(*) n, sum(wht_amount) t from wht_ledger`, 'wht_ledger');
      await sums(`select upper(status) k, count(*) n, sum(total) t from queue_items where vendor_id is not null or id::text not in (${skippedQueueIds()}) group by 1`, `select status::text k, count(*) n, sum(total) t from queue_items group by 1`, 'queue_items');

      for (const [t, r] of Object.entries<any>(report.tables)) {
        if (r.skipped < 0 && !['notification_prefs', 'pay_categories'].includes(t) /* derived rows: pref explosion, synthetic Unassigned category */) failures.push(`${t}: inserted more than the source holds`);
      }
      report.reconciliation = failures.length ? { ok: false, failures } : { ok: true };
      if (failures.length) throw new Error(`Reconciliation failed:\n  ${failures.slice(0, 25).join('\n  ')}`);

      if (DRY_RUN) throw new DryRunRollback();
    },
    { timeout: 3_600_000, maxWait: 60_000 },
  ).catch((e) => {
    if (e instanceof DryRunRollback || e?.cause instanceof DryRunRollback) return;
    throw e;
  });
}

class DryRunRollback extends Error {
  constructor() {
    super('dry-run rollback');
  }
}

main()
  .then(() => {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, jsonReplacer, 2));
    const skippedByTable = Object.entries<any>(report.tables).filter(([, r]) => r.skipped > 0).map(([t, r]) => `${t}: ${r.skipped}`);
    console.log(`\nDone (${report.mode}). Report: ${REPORT_PATH}`);
    console.log(`Reconciliation: ${report.reconciliation?.ok ? 'OK' : 'NOT RUN'}`);
    console.log(`Rows not imported — ${skippedByTable.join(', ') || 'none'}`);
  })
  .catch((e) => {
    report.error = String(e?.message ?? e);
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, jsonReplacer, 2));
    console.error('\nIMPORT FAILED (nothing was written):', e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await source.$disconnect();
    await target.$disconnect();
  });
