export interface Paginated<T> {
  data: T[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
}

export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  roles?: string[]
  role?: string
}

export interface Workspace {
  id: string
  name: string
  [key: string]: unknown
}

export interface Vendor {
  id: string
  name: string
  bankAccountNumber?: string
  accountName?: string
  bankCode?: string
  bankName?: string
  createdAt?: string
  [key: string]: unknown
}

export interface Requisition {
  id: string
  vendorId?: string
  vendorName?: string
  amount: number
  description?: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | string
  createdAt?: string
  [key: string]: unknown
}

export interface QueueItem {
  id: string
  vendorId?: string
  vendorName?: string
  amount: number
  description?: string
  category?: string
  status?: string
  createdAt?: string
  [key: string]: unknown
}

export interface Batch {
  id: string
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'DISBURSING' | 'DISBURSED' | 'PARTIALLY_FAILED' | 'FAILED' | string
  totalAmount?: number
  itemCount?: number
  createdAt?: string
  items?: BatchItem[]
  [key: string]: unknown
}

export interface BatchItem {
  id: string
  vendor?: { id: string; name: string }
  grossAmount: number
  whtAmount: number
  netAmount: number
  payout?: { status: string } | null
  [key: string]: unknown
}

export interface Wallet {
  balance: number
  currency?: string
  [key: string]: unknown
}

export interface LedgerEntry {
  id: string
  type?: string
  amount: number
  balanceAfter?: number
  description?: string
  createdAt?: string
  [key: string]: unknown
}

export interface Budget {
  id: string
  costCenterId?: string
  period?: string
  amount: number
  [key: string]: unknown
}

export interface Customer {
  id: string
  name: string
  email?: string
  phone?: string
  [key: string]: unknown
}

export interface Invoice {
  id: string
  customerId?: string
  customerName?: string
  status?: string
  total?: number
  amountPaid?: number
  createdAt?: string
  [key: string]: unknown
}
