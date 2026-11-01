/**
 * Idempotent demo seed (spec §11 hospitality defaults). Run: `npm run prisma:seed`.
 *
 * Logins (password for all: Password123!):
 *   admin@demo.test (ADMIN + Biller), payer@, approver@, poster@, procurement@, requester@,
 *   viewer@, biller@ (VIEWER + Biller), superadmin@ (platform SUPER_ADMIN), clientsetup@ (CLIENT_SETUP).
 * Disbursement PIN for admin@ and payer@: 1234 (bcrypt in user_security.pin_hash).
 */
import { PrismaClient, PlatformRole, Prisma, WorkspaceRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const PASSWORD = 'Password123!';
const DEMO_PIN = '1234';
const WORKSPACE_SLUG = 'demo';

const PALETTE = ['#22D3EE', '#7AB87A', '#5BA8C9', '#C97A7A', '#B59ED4', '#E89B59', '#8B8FA3'];

const CATEGORIES: { name: string; includeInBudgets: boolean; coa: string[] }[] = [
  {
    name: 'OPEX',
    includeInBudgets: true,
    coa: [
      'Salaries & Wages',
      'Employee Benefits & Welfare',
      'Rent',
      'Bank Charges & Merchant Fees',
      'Telephone & Internet',
      'CSR',
      'Utilities (Power & Water)',
      'Professional & Legal Fees',
      'General Expenses',
      'Marketing & Advertising',
      'Fuel & Lubricants',
      'Subscriptions & Licences',
      'Travel & Accommodation',
      'Complimentary Meal-Staff',
      'Transport & Delivery',
      'Rates & Levies',
      'Print & Stationery',
      'Repairs & Maintenance',
      "Directors' Remuneration",
      'Client Entertainment',
      'Vehicle Running Cost',
      'Exceptional / Non-Recurring Items',
      'Insurance',
      'Staff Training & Development',
      'Licencing & Permits',
      'Contracted Services',
      'Kitchen & Housekeeping Consumables',
      'Laundry & Linen Services',
      'Event & Private Dining Costs',
      'Loan Repayment – Lender',
      'Structural & Construction',
      'Equipment & Machinery',
      'Furniture & Fittings',
      'Investment',
      'VAT',
      'Cleaning & Sanitation Supplies',
      'Guest Supplies & Amenities',
      'Packaging & Takeaway Materials',
      'Recruitment Agency Fees',
    ],
  },
  {
    name: 'ASSET',
    includeInBudgets: false,
    coa: [
      'Equipment & Machinery',
      'Vehicles',
      'Furniture & Fittings',
      'Computers & Electronics',
      'Buildings / Property',
      'Tools',
      'Software Licenses (capitalised)',
      'Other',
      'OPS Petty Cash',
    ],
  },
  { name: 'PROJECT', includeInBudgets: false, coa: [] },
  { name: 'PROPERTY', includeInBudgets: false, coa: ['Structural & Construction'] },
  { name: 'COS', includeInBudgets: false, coa: ['Kitchen COS', 'Bar COS', 'Packaging & Takeaways', 'Other COS'] },
];

const BUSINESS_UNITS = [
  { name: 'Hotel', code: 'YD' },
  { name: 'Café', code: 'LR' },
  { name: 'Amenities', code: 'AM' },
  { name: 'Leased Space', code: 'LS' },
];
const BU_HEADS = [
  { name: '✦ General (split)', isGeneral: true },
  { name: 'Site 1', isGeneral: false },
  { name: 'Site 2', isGeneral: false },
  { name: 'Site 3', isGeneral: false },
];

const DEPARTMENTS = ['Kitchen', 'Bar', 'Housekeeping', 'Front Office', 'Maintenance', 'Admin & Finance'];

/**
 * Workspace WHT defaults by COA label (fractions), aligned with Nigerian deduction-at-source
 * practice: services/professional/agency/transport 5%, supply of goods & construction 2%, rent 10%.
 * Editable in Settings → WHT rates.
 */
const WHT_DEFAULTS: { coa: string; rate: number; label: string }[] = [
  { coa: 'Professional & Legal Fees', rate: 0.05, label: 'Professional services · 5%' },
  { coa: 'Contracted Services', rate: 0.05, label: 'Contract of services · 5%' },
  { coa: 'Recruitment Agency Fees', rate: 0.05, label: 'Agency / commission · 5%' },
  { coa: 'Transport & Delivery', rate: 0.05, label: 'Transport & haulage · 5%' },
  { coa: 'Laundry & Linen Services', rate: 0.05, label: 'Services · 5%' },
  { coa: 'Marketing & Advertising', rate: 0.05, label: 'Advertising services · 5%' },
  { coa: 'Repairs & Maintenance', rate: 0.05, label: 'Technical services · 5%' },
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

const USERS: {
  email: string;
  firstName: string;
  lastName: string;
  role: WorkspaceRole;
  isBiller?: boolean;
  platformRole?: PlatformRole;
  pin?: boolean;
}[] = [
  { email: 'admin@demo.test', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN', isBiller: true, pin: true },
  { email: 'payer@demo.test', firstName: 'Pius', lastName: 'Payer', role: 'PAYER', pin: true },
  { email: 'approver@demo.test', firstName: 'Amaka', lastName: 'Approver', role: 'APPROVER' },
  { email: 'poster@demo.test', firstName: 'Tunde', lastName: 'Poster', role: 'POSTER' },
  { email: 'procurement@demo.test', firstName: 'Bola', lastName: 'Procurement', role: 'PROCUREMENT' },
  { email: 'requester@demo.test', firstName: 'Rita', lastName: 'Requester', role: 'REQUESTER' },
  { email: 'viewer@demo.test', firstName: 'Victor', lastName: 'Viewer', role: 'VIEWER' },
  { email: 'biller@demo.test', firstName: 'Bisi', lastName: 'Biller', role: 'VIEWER', isBiller: true },
  { email: 'superadmin@demo.test', firstName: 'Sam', lastName: 'Super', role: 'VIEWER', platformRole: 'SUPER_ADMIN' },
  { email: 'clientsetup@demo.test', firstName: 'Chidi', lastName: 'Setup', role: 'VIEWER', platformRole: 'CLIENT_SETUP' },
];

const VENDORS = [
  {
    name: 'Mama Cass Provisions',
    bankName: 'GTBank',
    bankCode: '058',
    bankAccountNumber: '0123456789',
    accountName: 'MAMA CASS PROVISIONS',
    verified: true,
    contactPerson: 'Cassandra Obi',
    phone: '08031234567',
    tin: '12345678-0001',
    tags: ['provisions', 'kitchen'],
  },
  {
    name: 'Lagos Diesel Supply Ltd',
    bankName: 'Zenith Bank',
    bankCode: '057',
    bankAccountNumber: '1012345678',
    accountName: 'LAGOS DIESEL SUPPLY LTD',
    verified: true,
    contactPerson: 'Emeka Nwosu',
    phone: '08029876543',
    tin: '23456789-0001',
    tags: ['fuel'],
  },
  {
    name: 'Adeyemi & Co Legal',
    bankName: 'Access Bank',
    bankCode: '044',
    bankAccountNumber: '0698765432',
    accountName: 'ADEYEMI AND CO',
    verified: true,
    contactPerson: 'Kunle Adeyemi',
    phone: '08055551234',
    tin: '34567890-0001',
    tags: ['legal', 'professional'],
  },
  {
    name: 'CleanPro Services',
    bankName: 'UBA',
    bankCode: '033',
    bankAccountNumber: '2087654321',
    accountName: 'CLEANPRO SERVICES',
    verified: false,
    contactPerson: null,
    phone: null, // no TIN / phone: shows up under the "No TIN" chip
    tin: null,
    tags: ['cleaning'],
  },
  {
    name: 'BuildRight Materials',
    bankName: 'First Bank',
    bankCode: '011',
    bankAccountNumber: '3045678912',
    accountName: 'BUILDRIGHT MATERIALS NIG',
    verified: true,
    contactPerson: 'Musa Bello',
    phone: '08061112222',
    tin: '45678901-0001',
    tags: ['construction'],
  },
];

const STOCK = [
  { name: 'Bag of Cement', description: 'Cement – Dangote 50kg', category: 'PROPERTY', coa: 'Structural & Construction', vendor: 'BuildRight Materials', unitName: 'Bag', unitAmount: 9500 },
  { name: 'Diesel per litre', description: 'Diesel – Generator', category: 'OPEX', coa: 'Fuel & Lubricants', vendor: 'Lagos Diesel Supply Ltd', unitName: 'Litre', unitAmount: 1250 },
  { name: 'Bag of Rice', description: 'Rice – Long Grain 50kg', category: 'COS', coa: 'Kitchen COS', vendor: 'Mama Cass Provisions', unitName: 'Bag', unitAmount: 78000 },
  { name: 'Crate of Soft Drinks', description: 'Soft Drinks – 35cl Crate', category: 'COS', coa: 'Bar COS', vendor: 'Mama Cass Provisions', unitName: 'Carton', unitAmount: 4800 },
  { name: 'Cleaning Supplies Pack', description: 'Cleaning – Detergent & Bleach', category: 'OPEX', coa: 'Cleaning & Sanitation Supplies', vendor: 'CleanPro Services', unitName: 'Pack', unitAmount: 15000 },
];

const APP_CONFIG: Record<string, Prisma.InputJsonValue> = {
  requisitions_enabled: true,
  business_units_required: true,
  batches_tab_name: 'BATCHES',
  invoices_tab_name: 'INVOICES',
  session_timeout_minutes: 30,
  require_reauth_for_disbursement: false,
  vat_on_new_invoices: true,
  invoice_prefix: 'INV',
  quote_prefix: 'QTE',
  invoice_theme_color: 'F4B942',
  setup_workspace_done: true,
  setup_categories_done: true,
  setup_coa_done: true,
  setup_business_units_done: true,
};

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const pinHash = await bcrypt.hash(DEMO_PIN, 10);

  // ── Workspace
  const workspace = await prisma.workspace.upsert({
    where: { slug: WORKSPACE_SLUG },
    update: {},
    create: {
      name: 'Demo Hospitality',
      slug: WORKSPACE_SLUG,
      currency: 'NGN',
      timezone: 'Africa/Lagos',
      industry: 'Hospitality',
      tin: '98765432-0001',
      status: 'ACTIVE',
      tier: 'GROWTH',
      monthlyAmount: 50000,
      billingDay: 25,
      planTier: 'GROWTH',
      subscriptionStatus: 'ACTIVE',
      businessType: 'Hospitality',
    },
  });
  const workspaceId = workspace.id;

  // ── Users + memberships
  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { passwordHash, platformRole: u.platformRole ?? null, isActive: true },
      create: {
        email: u.email,
        passwordHash,
        firstName: u.firstName,
        lastName: u.lastName,
        displayName: `${u.firstName} ${u.lastName}`,
        isEmailVerified: true,
        onboarded: true,
        platformRole: u.platformRole ?? null,
      },
    });
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
      update: { role: u.role, isBiller: !!u.isBiller, isActive: true },
      create: { workspaceId, userId: user.id, role: u.role, isBiller: !!u.isBiller, joinedAt: new Date() },
    });
    if (u.pin) {
      await prisma.userSecurity.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, pinHash, pinSetAt: new Date() },
      });
    }
  }

  // ── Payment categories + COA tags
  const coaByKey = new Map<string, string>(); // `${category}|${coa}` -> coaTagId
  const categoryIds = new Map<string, string>();
  for (const [i, cat] of CATEGORIES.entries()) {
    const category = await prisma.payCategory.upsert({
      where: { workspaceId_name: { workspaceId, name: cat.name } },
      update: { sortOrder: i, includeInBudgets: cat.includeInBudgets },
      create: {
        workspaceId,
        name: cat.name,
        code: cat.name.slice(0, 4),
        color: PALETTE[i % PALETTE.length],
        sortOrder: i,
        includeInBudgets: cat.includeInBudgets,
      },
    });
    categoryIds.set(cat.name, category.id);
    for (const [j, name] of cat.coa.entries()) {
      const tag = await prisma.coaTag.upsert({
        where: { payCategoryId_name: { payCategoryId: category.id, name } },
        update: { sortOrder: j },
        create: { workspaceId, payCategoryId: category.id, name, sortOrder: j },
      });
      coaByKey.set(`${cat.name}|${name}`, tag.id);
    }
  }

  // ── Business units + BU heads
  const buIds = new Map<string, string>();
  for (const [i, bu] of BUSINESS_UNITS.entries()) {
    const cc = await prisma.costCenter.upsert({
      where: { workspaceId_name: { workspaceId, name: bu.name } },
      update: { code: bu.code, sortOrder: i },
      create: { workspaceId, name: bu.name, code: bu.code, sortOrder: i },
    });
    buIds.set(bu.name, cc.id);
    for (const [j, head] of BU_HEADS.entries()) {
      await prisma.location.upsert({
        where: { workspaceId_costCenterId_name: { workspaceId, costCenterId: cc.id, name: head.name } },
        update: { isGeneral: head.isGeneral, sortOrder: j },
        create: { workspaceId, costCenterId: cc.id, name: head.name, isGeneral: head.isGeneral, sortOrder: j },
      });
    }
  }

  // ── Departments
  for (const name of DEPARTMENTS) {
    await prisma.department.upsert({
      where: { workspaceId_name: { workspaceId, name } },
      update: {},
      create: { workspaceId, name },
    });
  }

  // ── WHT defaults
  for (const w of WHT_DEFAULTS) {
    await prisma.whtRate.upsert({
      where: { workspaceId_coa: { workspaceId, coa: w.coa } },
      update: {},
      create: { workspaceId, coa: w.coa, rate: w.rate, label: w.label },
    });
  }

  // ── Vendors
  const vendorIds = new Map<string, string>();
  for (const v of VENDORS) {
    const vendor = await prisma.vendor.upsert({
      where: { workspaceId_name: { workspaceId, name: v.name } },
      update: {},
      create: {
        workspaceId,
        name: v.name,
        bankName: v.bankName,
        bankCode: v.bankCode,
        bankAccountNumber: v.bankAccountNumber,
        accountName: v.accountName,
        verifiedAccountName: v.verified ? v.accountName : null,
        verifiedAt: v.verified ? new Date() : null,
        isBankVerified: v.verified,
        contactPerson: v.contactPerson,
        phone: v.phone,
        tin: v.tin,
        tags: v.tags,
      },
    });
    vendorIds.set(v.name, vendor.id);
  }

  // ── Stock items
  for (const s of STOCK) {
    await prisma.stockExpense.upsert({
      where: { workspaceId_name: { workspaceId, name: s.name } },
      update: {},
      create: {
        workspaceId,
        name: s.name,
        description: s.description,
        payCategoryId: categoryIds.get(s.category),
        coaTagId: coaByKey.get(`${s.category}|${s.coa}`),
        vendorId: vendorIds.get(s.vendor),
        unitName: s.unitName,
        unitAmount: s.unitAmount,
      },
    });
  }

  // ── A couple of OPEX budgets for this month (Hotel BU)
  const hotelId = buIds.get('Hotel')!;
  const period = currentPeriod();
  for (const [coa, amount] of [
    ['Fuel & Lubricants', 1_500_000],
    ['Rent', 3_000_000],
    ['CSR', 200_000],
  ] as const) {
    const coaTagId = coaByKey.get(`OPEX|${coa}`)!;
    await prisma.budget.upsert({
      where: { workspaceId_periodMonth_costCenterId_coaTagId: { workspaceId, periodMonth: period, costCenterId: hotelId, coaTagId } },
      update: {},
      create: { workspaceId, periodMonth: period, costCenterId: hotelId, coaTagId, monthlyAmount: amount },
    });
  }

  // ── Workspace app config
  for (const [key, value] of Object.entries(APP_CONFIG)) {
    await prisma.appConfig.upsert({
      where: { workspaceId_key: { workspaceId, key } },
      update: {},
      create: { workspaceId, key, value },
    });
  }

  const counts = {
    users: await prisma.workspaceMember.count({ where: { workspaceId } }),
    categories: await prisma.payCategory.count({ where: { workspaceId } }),
    coaTags: await prisma.coaTag.count({ where: { workspaceId } }),
    businessUnits: await prisma.costCenter.count({ where: { workspaceId } }),
    buHeads: await prisma.location.count({ where: { workspaceId } }),
    whtRates: await prisma.whtRate.count({ where: { workspaceId } }),
    vendors: await prisma.vendor.count({ where: { workspaceId } }),
    stock: await prisma.stockExpense.count({ where: { workspaceId } }),
    budgets: await prisma.budget.count({ where: { workspaceId } }),
  };
  console.log(`Seeded workspace "${workspace.name}" (${workspaceId})`, counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
