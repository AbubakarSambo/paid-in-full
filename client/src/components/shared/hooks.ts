import { useQuery } from '@tanstack/react-query'
import { vendorsApi } from '@/lib/api/vendors'
import { stockApi } from '@/lib/api/stock'
import { coaTagsApi, costCentersApi, payCategoriesApi } from '@/lib/api/spend'

/** Shared query keys so pages can invalidate pickers after edits. */
export const spendKeys = {
  vendorsAll: ['vendors', 'all'] as const,
  vendors: ['vendors'] as const,
  banks: ['vendors', 'banks'] as const,
  vendorTags: ['vendors', 'tags'] as const,
  stock: ['stock'] as const,
  stockActive: ['stock', 'active'] as const,
  payCategories: ['pay-categories'] as const,
  coaTags: ['coa-tags'] as const,
  coaByCategory: ['coa-tags', 'by-category'] as const,
  costCenters: ['cost-centers'] as const,
  whtRates: ['wht', 'rates'] as const,
  whtAccount: ['wht', 'account'] as const,
}

/** Every active vendor (for pickers). */
export const useAllVendors = () => useQuery({ queryKey: spendKeys.vendorsAll, queryFn: vendorsApi.listAll, staleTime: 60_000 })
/** Nigerian banks with CBN codes. */
export const useBanks = () => useQuery({ queryKey: spendKeys.banks, queryFn: vendorsApi.banks, staleTime: 3_600_000 })
/** Active stock items (picker). */
export const useActiveStock = () =>
  useQuery({ queryKey: spendKeys.stockActive, queryFn: () => stockApi.list({ active: true }), staleTime: 60_000 })
/** Pay categories (sorted). */
export const usePayCategories = () =>
  useQuery({ queryKey: spendKeys.payCategories, queryFn: () => payCategoriesApi.list(), staleTime: 60_000 })
/** Active COA tags across all categories. */
export const useCoaTags = () => useQuery({ queryKey: spendKeys.coaTags, queryFn: () => coaTagsApi.list(), staleTime: 60_000 })
/** Business units with their BU heads. */
export const useCostCenters = () =>
  useQuery({ queryKey: spendKeys.costCenters, queryFn: () => costCentersApi.list({ includeHeads: true }), staleTime: 60_000 })
