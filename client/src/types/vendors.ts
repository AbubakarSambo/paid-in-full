// Vendor register + stock expense types. Mirrors the API (Prisma Decimal arrives as string).

export interface Vendor {
  id: string
  name: string
  contactPerson: string | null
  phone: string | null
  email: string | null
  bankAccountNumber: string | null
  bankCode: string | null
  bankName: string | null
  /** As typed by the user (or the bank's name once verified). */
  accountName: string | null
  /** Name returned by the bank's name enquiry. */
  verifiedAccountName: string | null
  verifiedAt: string | null
  isBankVerified: boolean
  tin: string | null
  tags: string[]
  whtExempt: boolean
  /** Vendor-level WHT override as a fraction (0.05 = 5%). */
  whtRate: string | number | null
  isActive: boolean
  createdAt?: string
  updatedAt?: string
}

export interface VendorListResponse {
  data: Vendor[]
  meta: { total: number; page: number; limit: number; totalPages: number }
  totalVendors: number
}

export interface Bank {
  name: string
  code: string
  aliases?: string[]
}

export interface NameEnquiryResult {
  verified: boolean
  accountName: string | null
  accountNumber: string
  bankCode: string
  bankName: string | null
  reason?: string
}

export interface VendorTagCount {
  tag: string
  count: number
}

export type BulkRowStatus = 'ready' | 'mismatch' | 'unverified' | 'invalid' | 'duplicate'

export interface BulkVendorPreviewRow {
  row: number
  status: BulkRowStatus
  importable: boolean
  name: string
  bankInput: string
  bankCode: string | null
  bankName: string | null
  accountNumber: string
  contactName: string | null
  phone: string | null
  tin: string | null
  tags: string[]
  bankAccountName: string | null
  reason: string
}

export interface BulkVendorPreview {
  summary: { total: number; ready: number; mismatch: number; unverified: number; invalid: number; duplicate: number }
  rows: BulkVendorPreviewRow[]
}

export interface BulkVendorCommitResult {
  created: { id: string; name: string; row: number }[]
  failed: { row: number; name: string; reason: string }[]
  skipped: { row: number; name: string; status: string; reason: string }[]
  summary: BulkVendorPreview['summary'] & { imported: number }
}

export interface VendorInput {
  name: string
  contactPerson?: string
  phone?: string
  email?: string
  bankAccountNumber?: string
  bankCode?: string
  accountName?: string
  allowUnverified?: boolean
  tin?: string
  tags?: string[]
  whtExempt?: boolean
  whtRate?: number | null
  isActive?: boolean
}

export interface StockItem {
  id: string
  name: string
  description: string | null
  payCategoryId: string | null
  coaTagId: string | null
  vendorId: string | null
  unitName: string | null
  unitAmount: string | number
  isActive: boolean
  payCategory: { id: string; name: string; color: string } | null
  coaTag: { id: string; name: string } | null
  vendor: { id: string; name: string } | null
}

export interface StockInput {
  name: string
  description?: string
  payCategoryId?: string | null
  coaTagId?: string | null
  vendorId?: string | null
  unitName?: string
  unitAmount?: number
  isActive?: boolean
}

export interface StockImportResult {
  created: string[]
  updated: string[]
  errors: { row: number; name: string; reason: string }[]
}
