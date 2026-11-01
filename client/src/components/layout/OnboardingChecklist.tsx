import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, ChevronDown, ListTodo, X } from 'lucide-react'
import { onboardingApi, apiError } from '@/lib/api/shell'
import { usePermissions } from '@/lib/permissions'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import type { Checklist } from '@/types/shell'

/** Spec §13 onboarding checklist panel. Admins only; manual steps are ticked by hand. */
export function OnboardingChecklist() {
  const { isAdmin } = usePermissions()
  const workspaceId = useAuthStore((s) => s.workspace?.id)
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  const { data } = useQuery({
    queryKey: ['onboarding', 'checklist'],
    queryFn: onboardingApi.checklist,
    enabled: isAdmin && !!workspaceId,
    staleTime: 60_000,
  })

  const setCache = (c: Checklist) => qc.setQueryData(['onboarding', 'checklist'], c)
  const tick = useMutation({
    mutationFn: ({ key, done }: { key: string; done: boolean }) => onboardingApi.setStep(key, done),
    onSuccess: setCache,
    onError: (e) => toast.error(apiError(e).message),
  })
  const dismiss = useMutation({
    mutationFn: () => onboardingApi.dismiss(true),
    onSuccess: (c) => {
      setCache(c)
      toast.success('Checklist hidden')
    },
    onError: (e) => toast.error(apiError(e).message),
  })

  if (!isAdmin || !data || data.dismissed || data.allDone) return null

  return (
    <div className="mb-4 rounded-2xl border border-gold/30 bg-gold/5">
      <div className="flex items-center gap-3 px-4 py-3">
        <ListTodo size={18} className="shrink-0 text-gold" />
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">Set up your workspace</p>
            <p className="text-xs text-text-dim">
              {data.completed} of {data.total} done
            </p>
          </div>
          <div className="hidden h-1.5 w-40 overflow-hidden rounded-full bg-surface3 sm:block">
            <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${data.percent}%` }} />
          </div>
          <span className="text-xs font-bold tabular-nums text-gold">{data.percent}%</span>
          <ChevronDown size={16} className={cn('text-text-dim transition-transform', open && 'rotate-180')} />
        </button>
        <button
          type="button"
          onClick={() => dismiss.mutate()}
          className="rounded-full p-1 text-text-dim hover:bg-surface3 hover:text-foreground"
          aria-label="Dismiss checklist"
          title="Dismiss"
        >
          <X size={15} />
        </button>
      </div>
      {open && (
        <ol className="grid gap-1 border-t border-gold/20 px-2 py-2 sm:grid-cols-2">
          {data.steps.map((s, i) => {
            const manual = !s.autoDetected
            return (
              <li key={s.key}>
                <button
                  type="button"
                  disabled={!manual || tick.isPending}
                  onClick={() => tick.mutate({ key: s.key, done: !s.manuallyTicked })}
                  className={cn('flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm', manual && 'hover:bg-surface2')}
                  title={s.autoDetected ? 'Detected automatically' : 'Tick when done'}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      s.done ? 'border-green bg-green text-white' : 'border-border'
                    )}
                  >
                    {s.done && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className={cn('flex-1', s.done ? 'text-text-dim line-through' : 'text-foreground')}>
                    {i + 1}. {s.label}
                    {s.optional && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">optional</span>}
                    {s.autoDetected && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-green">auto</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
