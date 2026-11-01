/**
 * Allow-list for the generic per-workspace AppConfig endpoint (spec §4 app_config).
 * Exact keys plus a few prefixed families. Other features may add keys here (small additive edits).
 */
export const APP_CONFIG_KEYS = [
  // Modules / workspace behaviour
  'requisitions_enabled',
  'business_units_required',
  'session_timeout_minutes',
  'require_reauth_for_disbursement',
  'industry',
  // Google Sheets sync
  'sheets_url',
  'batches_tab_name',
  'recon_sheet_url',
  'invoices_sheets_url',
  'invoices_tab_name',
  // COA (legacy JSON forms; CoaTag rows are the source of truth)
  'coa_list',
  'coa_by_category',
  // Invoicing
  'payment_account',
  'invoice_vat_default',
  'sweep_enabled',
  // Onboarding checklist UI
  'setup_checklist_dismissed',
] as const;

export const APP_CONFIG_KEY_PATTERNS: RegExp[] = [
  /^setup_[a-z0-9_]+_done$/,
  /^wht_account_[a-z0-9_]+$/,
  /^wht_account$/,
  /^invoice_[a-z0-9_]+$/,
  /^sweep_[a-z0-9_]+$/,
  /^sheets_[a-z0-9_]+$/,
];

export function isAllowedAppConfigKey(key: string): boolean {
  return (APP_CONFIG_KEYS as readonly string[]).includes(key) || APP_CONFIG_KEY_PATTERNS.some((re) => re.test(key));
}

/** Defaults returned when a key has never been written. */
export const APP_CONFIG_DEFAULTS: Record<string, unknown> = {
  requisitions_enabled: true,
  business_units_required: false,
  session_timeout_minutes: 30,
  require_reauth_for_disbursement: false,
  batches_tab_name: 'BATCHES',
  invoices_tab_name: 'INVOICES',
  invoice_vat_default: true,
  sweep_enabled: false,
  setup_checklist_dismissed: false,
};
