// Spend-structure types (pay categories, COA tags, business units, WHT, AI). Mirrors the API.

export interface CoaTag {
  id: string
  workspaceId?: string
  payCategoryId: string
  name: string
  sortOrder: number
  isActive: boolean
  payCategory?: { id: string; name: string; color: string }
}

export interface PayCategory {
  id: string
  name: string
  code: string | null
  color: string
  sortOrder: number
  includeInBudgets: boolean
  isActive: boolean
  coaTags?: CoaTag[]
  _count?: { coaTags: number }
}

export interface CoaByCategory {
  industry: string | null
  categories: (PayCategory & { coaTags: CoaTag[] })[]
}

export interface CoaDefaultsPreview {
  industry: string
  existing: Record<string, number>
  requiresConfirmation: boolean
  [key: string]: unknown
}

export interface CoaSuggestResult {
  payCategoryId: string
  payCategoryName: string
  suggestions: string[]
  source: 'ai' | 'rules'
}

export interface UsageResult {
  counts: Record<string, number>
  inUse: boolean
}

/** BU Head (child of a Business Unit). */
export interface Location {
  id: string
  costCenterId: string | null
  name: string
  address?: string | null
  isGeneral: boolean
  sortOrder: number
  isActive: boolean
}

/** Business Unit (spec cost_centers). */
export interface CostCenter {
  id: string
  name: string
  code: string | null
  sortOrder: number
  isActive: boolean
  locations?: Location[]
}

export interface WhtRate {
  id: string
  coa: string
  /** Fraction 0–1 (Decimal serialised as string). */
  rate: string | number
  label: string | null
}

export type WhtSource = 'vendor_exempt' | 'vendor_override' | 'workspace_default' | 'keyword' | 'none'

export interface WhtAmounts {
  gross: number
  wht: number
  net: number
}

export interface WhtResolution {
  rate: number
  source: WhtSource
  label: string
  amounts?: WhtAmounts
}

export interface WhtAccount {
  bankCode: string | null
  bankName: string | null
  accountNumber: string | null
  accountName: string | null
  verified: boolean
  verifiedAt: string | null
  configured: boolean
}

export interface ImproveDescriptionInput {
  /** Caller id echoed back (e.g. a row key). */
  id?: string
  description: string
  vendorName?: string
  /** ISO date; used for the trailing DD/MM/YYYY when the text has none. */
  date?: string
  amount?: number
}

export interface ImprovedDescription {
  id: string | null
  original: string
  improved: string
  changed: boolean
  errors: string[]
  originalErrors: string[]
  suggestion: {
    payCategoryId: string
    payCategoryName: string
    coaTagId: string
    coaTagName: string
    confidence: 'high' | 'medium' | 'low'
  } | null
}

export interface ValidateDescriptionResult {
  valid: boolean
  errors: string[]
  pattern: string
  maxLength: number
}
