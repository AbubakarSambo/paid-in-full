/**
 * One-click default COA setup (spec §5.10 #13): 3 categories (COS, OPEX, ASSET) with
 * 6 COS, 10 Opex and 6 Asset tags, tailored by industry.
 */
export interface CoaDefaultSet {
  industry: string;
  COS: string[];
  OPEX: string[];
  ASSET: string[];
}

export const DEFAULT_CATEGORY_META: Record<'COS' | 'OPEX' | 'ASSET', { color: string; includeInBudgets: boolean; sortOrder: number }> = {
  OPEX: { color: '#22D3EE', includeInBudgets: true, sortOrder: 0 },
  COS: { color: '#E89B59', includeInBudgets: true, sortOrder: 1 },
  ASSET: { color: '#7AB87A', includeInBudgets: false, sortOrder: 2 },
};

const BASE_OPEX = [
  'Salaries & Wages',
  'Rent',
  'Utilities (Power & Water)',
  'Fuel & Lubricants',
  'Repairs & Maintenance',
  'Telephone & Internet',
  'Professional & Legal Fees',
  'Bank Charges & Merchant Fees',
  'Transport & Delivery',
  'General Expenses',
];

const BASE_ASSET = [
  'Equipment & Machinery',
  'Furniture & Fittings',
  'Computers & Electronics',
  'Vehicles',
  'Tools',
  'Software Licenses (capitalised)',
];

const SETS: Array<CoaDefaultSet & { match: RegExp }> = [
  {
    industry: 'Hospitality',
    match: /hotel|hospitality|restaurant|caf[eé]|bar|lounge|food|catering|kitchen|bakery|event|resort|club/i,
    COS: ['Kitchen COS', 'Bar COS', 'Packaging & Takeaways', 'Guest Supplies & Amenities', 'Kitchen & Housekeeping Consumables', 'Other COS'],
    OPEX: [
      'Salaries & Wages',
      'Rent',
      'Utilities (Power & Water)',
      'Fuel & Lubricants',
      'Repairs & Maintenance',
      'Laundry & Linen Services',
      'Marketing & Advertising',
      'Cleaning & Sanitation Supplies',
      'Bank Charges & Merchant Fees',
      'General Expenses',
    ],
    ASSET: ['Equipment & Machinery', 'Furniture & Fittings', 'Kitchen Equipment', 'Computers & Electronics', 'Vehicles', 'Buildings / Property'],
  },
  {
    industry: 'Retail',
    match: /retail|shop|store|supermarket|mart|boutique|e-?commerce|fashion|pharmacy|wholesale|distribution|fmcg/i,
    COS: ['Purchases – Goods for Resale', 'Inbound Freight & Clearing', 'Packaging Materials', 'Stock Shrinkage & Write-offs', 'Supplier Rebates & Discounts', 'Other COS'],
    OPEX: [
      'Salaries & Wages',
      'Rent',
      'Utilities (Power & Water)',
      'Fuel & Lubricants',
      'Marketing & Advertising',
      'Transport & Delivery',
      'Bank Charges & Merchant Fees',
      'Repairs & Maintenance',
      'Security Services',
      'General Expenses',
    ],
    ASSET: ['Shop Fittings & Shelving', 'POS & Computers', 'Furniture & Fittings', 'Vehicles', 'Cold Room & Refrigeration', 'Security Equipment & CCTV'],
  },
  {
    industry: 'Construction',
    match: /construct|building|real estate|property|engineering|civil|contractor|developer|architect/i,
    COS: ['Building Materials', 'Subcontractor Fees', 'Site Labour', 'Equipment Hire', 'Haulage & Site Logistics', 'Other COS'],
    OPEX: [
      'Salaries & Wages',
      'Rent',
      'Fuel & Lubricants',
      'Professional & Legal Fees',
      'Licencing & Permits',
      'Insurance',
      'Repairs & Maintenance',
      'Telephone & Internet',
      'Health & Safety (HSE)',
      'General Expenses',
    ],
    ASSET: ['Plant & Machinery', 'Vehicles', 'Tools', 'Buildings / Property', 'Computers & Electronics', 'Site Containers & Structures'],
  },
  {
    industry: 'Logistics',
    match: /logistic|transport|haulage|courier|delivery|freight|shipping|fleet|ride|mobility/i,
    COS: ['Fuel & Diesel (Fleet)', 'Driver Allowances & Trip Costs', 'Tolls & Levies', 'Third-Party Haulage', 'Vehicle Tyres & Parts', 'Other COS'],
    OPEX: [
      'Salaries & Wages',
      'Rent',
      'Vehicle Running Cost',
      'Repairs & Maintenance',
      'Insurance',
      'Telephone & Internet',
      'Licencing & Permits',
      'Bank Charges & Merchant Fees',
      'Professional & Legal Fees',
      'General Expenses',
    ],
    ASSET: ['Trucks & Vans', 'Motorcycles', 'Tracking & Telematics Devices', 'Warehouse Equipment', 'Computers & Electronics', 'Furniture & Fittings'],
  },
  {
    industry: 'Manufacturing',
    match: /manufactur|factory|production|processing|plant|industrial|agro|agri|farm|mill/i,
    COS: ['Raw Materials', 'Packaging Materials', 'Factory Labour', 'Factory Power & Diesel', 'Inbound Freight', 'Other COS'],
    OPEX: [
      'Salaries & Wages',
      'Rent',
      'Repairs & Maintenance',
      'Utilities (Power & Water)',
      'Transport & Delivery',
      'Marketing & Advertising',
      'Insurance',
      'Professional & Legal Fees',
      'Health & Safety (HSE)',
      'General Expenses',
    ],
    ASSET: ['Plant & Machinery', 'Factory Buildings', 'Vehicles', 'Tools', 'Computers & Electronics', 'Furniture & Fittings'],
  },
  {
    industry: 'Professional services',
    match: /consult|agency|law|legal|account|audit|advis|marketing|media|creative|design|tech|software|saas|it\b|digital|studio/i,
    COS: ['Contractor & Freelancer Fees', 'Project Direct Costs', 'Software & Cloud (Delivery)', 'Client Travel', 'Third-Party Licences', 'Other COS'],
    OPEX: [
      'Salaries & Wages',
      'Rent',
      'Telephone & Internet',
      'Subscriptions & Licences',
      'Marketing & Advertising',
      'Travel & Accommodation',
      'Professional & Legal Fees',
      'Staff Training & Development',
      'Utilities (Power & Water)',
      'General Expenses',
    ],
    ASSET: ['Computers & Electronics', 'Furniture & Fittings', 'Office Equipment', 'Software Licenses (capitalised)', 'Vehicles', 'Leasehold Improvements'],
  },
  {
    industry: 'Healthcare',
    match: /health|hospital|clinic|medical|pharma|diagnostic|lab|dental|care/i,
    COS: ['Drugs & Pharmaceuticals', 'Medical Consumables', 'Laboratory Reagents', 'Locum & Visiting Doctors', 'Patient Meals', 'Other COS'],
    OPEX: [
      'Salaries & Wages',
      'Rent',
      'Utilities (Power & Water)',
      'Fuel & Lubricants',
      'Repairs & Maintenance',
      'Cleaning & Sanitation Supplies',
      'Insurance',
      'Licencing & Permits',
      'Professional & Legal Fees',
      'General Expenses',
    ],
    ASSET: ['Medical Equipment', 'Laboratory Equipment', 'Furniture & Fittings', 'Computers & Electronics', 'Vehicles', 'Buildings / Property'],
  },
  {
    industry: 'Education',
    match: /school|education|academy|college|university|training|learning|tutor/i,
    COS: ['Teaching Materials', 'Exam & Assessment Fees', 'Student Meals', 'Visiting Teacher Fees', 'Excursions & Activities', 'Other COS'],
    OPEX: [
      'Salaries & Wages',
      'Rent',
      'Utilities (Power & Water)',
      'Fuel & Lubricants',
      'Repairs & Maintenance',
      'Print & Stationery',
      'Telephone & Internet',
      'Staff Training & Development',
      'Cleaning & Sanitation Supplies',
      'General Expenses',
    ],
    ASSET: ['Furniture & Fittings', 'Computers & Electronics', 'Laboratory Equipment', 'School Buses', 'Library Books', 'Buildings / Property'],
  },
];

const GENERIC: CoaDefaultSet = {
  industry: 'General business',
  COS: ['Purchases – Direct Materials', 'Direct Labour', 'Inbound Freight', 'Packaging Materials', 'Subcontracted Services', 'Other COS'],
  OPEX: BASE_OPEX,
  ASSET: BASE_ASSET,
};

export function coaDefaultsForIndustry(industry?: string | null): CoaDefaultSet {
  const text = (industry ?? '').trim();
  if (!text) return GENERIC;
  const hit = SETS.find((s) => s.match.test(text));
  if (!hit) return { ...GENERIC, industry: text };
  const { match: _match, ...set } = hit;
  return set;
}

/** Which default bucket a category name maps to (for AI-suggest fallbacks). */
export function defaultBucketForCategory(name: string): 'COS' | 'OPEX' | 'ASSET' | null {
  const n = name.toUpperCase();
  if (/\bCOS\b|COST OF SALES|COGS|DIRECT/.test(n)) return 'COS';
  if (/OPEX|OPERAT|EXPENSE|OVERHEAD|ADMIN/.test(n)) return 'OPEX';
  if (/ASSET|CAPEX|CAPITAL|FIXED/.test(n)) return 'ASSET';
  return null;
}

/** A wider pool per bucket used by the deterministic AI-suggest fallback. */
export function suggestionPool(bucket: 'COS' | 'OPEX' | 'ASSET' | null, industry?: string | null): string[] {
  const own = coaDefaultsForIndustry(industry);
  const all = [own, ...SETS, GENERIC];
  if (!bucket) {
    return ['Structural & Construction', 'Consultancy Fees', 'Materials', 'Labour', 'Equipment Hire', 'Permits & Approvals', 'Contingency', 'Project Management Fees'];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of all) {
    for (const t of s[bucket]) {
      if (!seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        out.push(t);
      }
    }
  }
  return out;
}
