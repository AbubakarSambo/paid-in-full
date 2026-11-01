import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { useCoaTags, useCostCenters, usePayCategories } from '@/components/shared/hooks'
import { configFlag, lookupKeys, lookupsApi } from '@/lib/api/queue'
import type { CoaTag, CostCenter, PayCategory } from '@/types/spend'

/** Uppercase micro-label chip (spec §12). */
export function Chip({
  children,
  tone = 'dim',
  className,
  title,
}: {
  children: React.ReactNode
  tone?: 'dim' | 'gold' | 'green' | 'red' | 'orange' | 'blue' | 'purple'
  className?: string
  title?: string
}) {
  const tones: Record<string, string> = {
    dim: 'bg-surface2 text-text-dim border-border',
    gold: 'bg-gold/10 text-gold border-gold/30',
    green: 'bg-green/10 text-green border-green/30',
    red: 'bg-red/10 text-red border-red/30',
    orange: 'bg-orange/10 text-orange border-orange/30',
    blue: 'bg-blue/10 text-blue border-blue/30',
    purple: 'bg-purple/10 text-purple border-purple/30',
  }
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] leading-none whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Field wrapper: micro label + control. */
export function Field({
  label,
  required,
  hint,
  className,
  children,
}: {
  label: string
  required?: boolean
  hint?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">
        {label}
        {required && <span className="ml-0.5 text-red">*</span>}
      </div>
      {children}
      {hint && <div className="text-[11px] text-text-muted">{hint}</div>}
    </div>
  )
}

export function ModalFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mt-6 flex flex-wrap items-center justify-end gap-2', className)}>{children}</div>
}

export const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const monthISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export const shortDate = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export const isoDate = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : '')

/** useState persisted to localStorage (wrapped in try/catch). */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* storage unavailable */
    }
  }, [key, value])
  return [value, setValue]
}

export type CategoryWithTags = PayCategory & { coaTags: CoaTag[] }

/** Categories (with their active COA tags), BUs with heads, and the BU-required flag. */
export function useQueueLookups() {
  const cats = usePayCategories()
  const tags = useCoaTags()
  const bus = useCostCenters()
  const cfg = useQuery({ queryKey: lookupKeys.config, queryFn: lookupsApi.appConfig, staleTime: 60_000 })

  const categories = useMemo<CategoryWithTags[]>(() => {
    const byCat = new Map<string, CoaTag[]>()
    for (const t of tags.data ?? []) {
      if (!t.isActive) continue
      const arr = byCat.get(t.payCategoryId) ?? []
      arr.push(t)
      byCat.set(t.payCategoryId, arr)
    }
    return (cats.data ?? []).map((c) => ({ ...c, coaTags: byCat.get(c.id) ?? c.coaTags ?? [] }))
  }, [cats.data, tags.data])

  const costCenters: CostCenter[] = useMemo(() => (bus.data ?? []).filter((b) => b.isActive), [bus.data])

  return {
    categories,
    activeCategories: categories.filter((c) => c.isActive),
    costCenters,
    buRequired: configFlag(cfg.data, 'business_units_required', false),
    isLoading: cats.isLoading || tags.isLoading || bus.isLoading,
  }
}
