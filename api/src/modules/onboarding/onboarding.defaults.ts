/** Starter categories for the wizard (spec §2 /onboarding: Cost of Sale, Operating Expense, Asset). */
export interface DefaultCategory {
  name: string;
  code: string;
  color: string;
  includeInBudgets: boolean;
  coa: string[];
}

const HOSPITALITY_COS = ['Kitchen COS', 'Bar COS', 'Packaging & Takeaways', 'Guest Supplies & Amenities', 'Laundry & Linen Services', 'Other COS'];
const CLINIC_COS = ['Drugs & Pharmaceuticals', 'Medical Consumables', 'Laboratory Supplies', 'Packaging', 'Freight Inwards', 'Other COS'];
const LOGISTICS_COS = ['Fuel & Lubricants', 'Vehicle Repairs', 'Driver Allowances', 'Tolls & Levies', 'Third-party Haulage', 'Other COS'];
const GENERIC_COS = ['Raw Materials', 'Direct Labour', 'Packaging', 'Freight Inwards', 'Subcontractors', 'Other COS'];

function cosFor(industry?: string | null) {
  const i = (industry || '').toLowerCase();
  if (i.includes('hospitality') || i.includes('hotel') || i.includes('restaurant')) return HOSPITALITY_COS;
  if (i.includes('clinic') || i.includes('pharm')) return CLINIC_COS;
  if (i.includes('logistic') || i.includes('transport')) return LOGISTICS_COS;
  return GENERIC_COS;
}

export function defaultCategories(industry?: string | null): DefaultCategory[] {
  return [
    { name: 'COS', code: 'COS', color: '#E89B59', includeInBudgets: true, coa: cosFor(industry) },
    {
      name: 'OPEX',
      code: 'OPEX',
      color: '#22D3EE',
      includeInBudgets: true,
      coa: [
        'Salaries & Wages',
        'Rent',
        'Utilities (Power & Water)',
        'Telephone & Internet',
        'Professional & Legal Fees',
        'Marketing & Advertising',
        'Repairs & Maintenance',
        'Transport & Delivery',
        'Bank Charges & Merchant Fees',
        'General Expenses',
      ],
    },
    {
      name: 'ASSET',
      code: 'ASSET',
      color: '#7AB87A',
      includeInBudgets: false,
      coa: ['Equipment & Machinery', 'Vehicles', 'Furniture & Fittings', 'Computers & Electronics', 'Software Licenses (capitalised)', 'Other'],
    },
  ];
}

/** Spec §13 onboarding checklist. `detect` steps auto-complete; the rest are ticked by hand. */
export const CHECKLIST_STEPS = [
  { key: 'workspace_created', label: 'Workspace created', detect: true },
  { key: 'invite_users', label: 'Invite secondary users', detect: true },
  { key: 'provision_wallet', label: 'Provision Monnify wallet', detect: true },
  { key: 'fund_wallet', label: 'Test by funding the wallet', detect: true },
  { key: 'drive_folder', label: 'Create Drive folder', detect: false },
  { key: 'mastersheet', label: 'Create Mastersheet', detect: false },
  { key: 'apps_script_installed', label: 'Install Apps Script', detect: false },
  { key: 'apps_script_connected', label: 'Connect / test Apps Script', detect: true },
  { key: 'set_pin', label: 'Set disbursement PIN', detect: true },
  { key: 'payment_categories', label: 'Set up Payment Categories', detect: true },
  { key: 'chart_of_accounts', label: 'Chart of Accounts', detect: true },
  { key: 'business_units', label: 'Business Units', detect: true },
  { key: 'sample_vendor', label: 'Add a sample vendor', detect: true },
  {
    key: 'queue_walkthrough',
    label: 'Queue walkthrough: manual entry, bulk CSV, 2 quick-adds; reject one, mark one urgent → approve → pay; split one, cancel one; confirm the line in the Mastersheet',
    detect: false,
  },
  { key: 'invoicing', label: 'Invoicing track (optional): customer → invoice → send → record payment → confirm sweep', detect: false, optional: true },
] as const;

export type ChecklistKey = (typeof CHECKLIST_STEPS)[number]['key'];
