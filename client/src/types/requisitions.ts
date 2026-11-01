// Requisitions (spec §5.1) — mirrors api/src/modules/requisitions.

export type RequisitionStatus = 'DRAFT' | 'SUBMITTED' | 'PROCUREMENT_CLEARED' | 'RETURNED' | 'QUEUED' | 'REJECTED'

export type RequisitionFilter = 'open' | 'draft' | 'submitted' | 'cleared' | 'returned' | 'queued' | 'rejected' | 'all'

export interface RequisitionAttachment {
  id: string
  fileName: string
  mimeType: string | null
  sizeBytes: number | null
  fileUrl: string | null
  createdAt: string
}

export interface RequisitionRow {
  id: string
  reqRef: string | null
  date: string
  departmentId: string | null
  departmentName: string | null
  requestedById: string
  requesterName: string | null
  vendorId: string | null
  isNewVendor: boolean
  vendorName: string | null
  vendorBank: string | null
  vendorBankCode: string | null
  vendorAcctNo: string | null
  vendorAcctName: string | null
  description: string
  units: string | number
  unitName: string | null
  unitAmount: string | number
  total: string | number
  bundleId: string | null
  bundleLabel: string | null
  costCenterId: string | null
  locationId: string | null
  payCategoryId: string | null
  coaTagId: string | null
  reason: string | null
  remarks: string | null
  reviewNote: string | null
  rejectionReason: string | null
  attachmentGroupId: string | null
  status: RequisitionStatus
  submittedAt: string | null
  clearedAt: string | null
  returnedAt: string | null
  rejectedAt: string | null
  queuedAt: string | null
  createdAt: string
  vendor: {
    id: string
    name: string
    bankName: string | null
    bankCode: string | null
    bankAccountNumber: string | null
    accountName: string | null
    verifiedAccountName: string | null
  } | null
  department: { id: string; name: string } | null
  payCategory: { id: string; name: string; color: string } | null
  coaTag: { id: string; name: string } | null
  costCenter: { id: string; name: string; code: string | null } | null
  location: { id: string; name: string; isGeneral: boolean } | null
  queueItem: { id: string; status: string } | null
  requestedBy: { id: string; firstName: string; lastName: string; displayName: string | null; email: string } | null
}

export interface RequisitionDetail extends RequisitionRow {
  attachments: RequisitionAttachment[]
}

export interface RequisitionListResponse {
  data: RequisitionRow[]
  meta: { total: number; page: number; limit: number; totalPages: number }
  counts: Record<RequisitionFilter, number>
}

export interface RequisitionHeaderPayload {
  date?: string
  departmentId?: string
  departmentName?: string
  vendorId?: string
  isNewVendor?: boolean
  vendorName?: string
  vendorBank?: string
  vendorBankCode?: string
  vendorAcctNo?: string
  vendorAcctName?: string
  costCenterId?: string
  locationId?: string
  reason?: string
  remarks?: string
  submit?: boolean
}

export interface RequisitionItemPayload {
  description: string
  units?: number
  unitName?: string
  unitAmount: number
}

export type CreateRequisitionPayload = RequisitionHeaderPayload & RequisitionItemPayload

export interface CreateRequisitionBundlePayload extends RequisitionHeaderPayload {
  bundleLabel: string
  items: RequisitionItemPayload[]
}

export interface PushLinePayload {
  requisitionId: string
  payCategoryId?: string
  coaTagId?: string
  costCenterId?: string
  locationId?: string
  pnlPeriod?: string
  whtRateOverride?: number
}

export interface DescriptionIssue {
  id: string
  description: string
  issues: string[]
}

export interface DepartmentSuggestion {
  id: string | null
  name: string
  existing: boolean
}
