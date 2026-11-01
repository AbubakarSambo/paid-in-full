/**
 * Nigerian statutory WHT defaults by COA label (fractions), per the Deduction of Tax at Source
 * (Withholding) Regulations: professional/consultancy/technical/management services, commission
 * and agency, transport/haulage and contracts of service 5%; supply of goods and construction 2%;
 * rent/lease 10% (corporate payees). Editable per workspace in Settings → WHT rates.
 */
export const WHT_STATUTORY_DEFAULTS: { coa: string; rate: number; label: string }[] = [
  { coa: 'Professional & Legal Fees', rate: 0.05, label: 'Professional services · 5%' },
  { coa: 'Consultancy Fees', rate: 0.05, label: 'Consultancy · 5%' },
  { coa: 'Contracted Services', rate: 0.05, label: 'Contract of services · 5%' },
  { coa: 'Recruitment Agency Fees', rate: 0.05, label: 'Agency / commission · 5%' },
  { coa: 'Transport & Delivery', rate: 0.05, label: 'Transport & haulage · 5%' },
  { coa: 'Laundry & Linen Services', rate: 0.05, label: 'Services · 5%' },
  { coa: 'Marketing & Advertising', rate: 0.05, label: 'Advertising services · 5%' },
  { coa: 'Repairs & Maintenance', rate: 0.05, label: 'Technical services · 5%' },
  { coa: 'Security Services', rate: 0.05, label: 'Services · 5%' },
  { coa: 'Rent', rate: 0.1, label: 'Rent · 10%' },
  { coa: 'Structural & Construction', rate: 0.02, label: 'Construction · 2%' },
  { coa: 'Kitchen COS', rate: 0.02, label: 'Provisions (goods) · 2%' },
  { coa: 'Bar COS', rate: 0.02, label: 'Provisions (goods) · 2%' },
  { coa: 'Kitchen & Housekeeping Consumables', rate: 0.02, label: 'Provisions (goods) · 2%' },
  { coa: 'Cleaning & Sanitation Supplies', rate: 0.02, label: 'Provisions (goods) · 2%' },
  { coa: 'Guest Supplies & Amenities', rate: 0.02, label: 'Provisions (goods) · 2%' },
  { coa: 'Equipment & Machinery', rate: 0.02, label: 'Supply of goods · 2%' },
  { coa: 'Furniture & Fittings', rate: 0.02, label: 'Supply of goods · 2%' },
];

/** AppConfig keys for the WHT destination account (spec §5.10 #7). */
export const WHT_ACCOUNT_KEYS = {
  bankCode: 'wht_account_bank_code',
  bankName: 'wht_account_bank_name',
  accountNumber: 'wht_account_number',
  accountName: 'wht_account_name',
  verified: 'wht_account_verified',
  verifiedAt: 'wht_account_verified_at',
} as const;

export interface WhtAccount {
  bankCode: string | null;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  verified: boolean;
  verifiedAt: string | null;
  configured: boolean;
}
