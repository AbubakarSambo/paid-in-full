import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiError, whtApi } from '@/lib/api/spend'
import { formatRatePct, toNumber } from '@/lib/money'
import { usePermissions } from '@/lib/permissions'
import { spendKeys } from '@/components/shared/hooks'
import { AdminOnlyNote, SettingsSection } from '@/components/shared/SettingsSection'
import type { WhtRate } from '@/types/spend'

const pctToRate = (s: string) => {
  const n = Number(s)
  return s.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : null
}

export default function WhtRates() {
  const qc = useQueryClient()
  const { isAdmin } = usePermissions()
  const { data: rates = [], isLoading } = useQuery({ queryKey: spendKeys.whtRates, queryFn: whtApi.rates })
  const [coa, setCoa] = useState('')
  const [pct, setPct] = useState('')
  const [label, setLabel] = useState('')
  const [seeding, setSeeding] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['wht'] })

  const add = async () => {
    const rate = pctToRate(pct)
    if (!coa.trim() || rate === null) return toast.error('Enter a COA and a rate between 0 and 100%')
    try {
      await whtApi.upsertRate({ coa: coa.trim(), rate, label: label.trim() || undefined })
      toast.success('WHT rate saved')
      setCoa('')
      setPct('')
      setLabel('')
      refresh()
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const seed = async () => {
    const overwrite = rates.length > 0 && confirm('Overwrite existing rows that match a statutory default? (Cancel keeps your values and only adds missing ones.)')
    setSeeding(true)
    try {
      const r = await whtApi.seedDefaults(overwrite)
      toast.success(`Statutory defaults: ${r.created} added, ${r.updated} updated`)
      refresh()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setSeeding(false)
    }
  }

  return (
    <SettingsSection
      id="wht-rates"
      title="WHT rates by category (COA)"
      description="Nigerian statutory defaults, plus per-COA overrides. Vendor exemptions and vendor-level rates take priority."
      actions={
        isAdmin && (
          <Button size="sm" variant="outline" onClick={seed} isLoading={seeding}>
            Seed statutory defaults
          </Button>
        )
      }
    >
      {!isAdmin && <AdminOnlyNote />}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="bg-secondary text-[10px] uppercase tracking-wider text-text-dim">
            <tr>
              <th className="px-3 py-2">COA / Category</th>
              <th className="px-3 py-2 text-right">Rate</th>
              <th className="px-3 py-2">Label</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-text-dim">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && rates.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-text-dim">
                  No rates yet — seed the statutory defaults.
                </td>
              </tr>
            )}
            {rates.map((r) => (
              <RateRow key={r.id} rate={r} isAdmin={isAdmin} onChanged={refresh} />
            ))}
          </tbody>
        </table>
      </div>
      {isAdmin && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Input value={coa} onChange={(e) => setCoa(e.target.value)} placeholder="COA, e.g. Professional & Legal Fees" className="max-w-xs" />
          <Input value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ''))} placeholder="Rate %" className="w-24" inputMode="decimal" />
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" className="max-w-xs" />
          <Button size="sm" className="h-11" onClick={add}>
            Add rate
          </Button>
        </div>
      )}
    </SettingsSection>
  )
}

function RateRow({ rate, isAdmin, onChanged }: { rate: WhtRate; isAdmin: boolean; onChanged: () => void }) {
  const [edit, setEdit] = useState(false)
  const [pct, setPct] = useState(String(Math.round(toNumber(rate.rate) * 10000) / 100))
  const [label, setLabel] = useState(rate.label ?? '')
  const save = async () => {
    const r = pctToRate(pct)
    if (r === null) return toast.error('Rate must be between 0 and 100%')
    try {
      await whtApi.updateRate(rate.id, { rate: r, label: label.trim() })
      setEdit(false)
      onChanged()
    } catch (e) {
      toast.error(apiError(e))
    }
  }
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2">{rate.coa}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {edit ? <Input value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ''))} className="ml-auto h-8 w-20 text-right" /> : formatRatePct(rate.rate)}
      </td>
      <td className="px-3 py-2 text-text-dim">{edit ? <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-8" /> : rate.label ?? '—'}</td>
      <td className="px-3 py-2 text-right">
        {isAdmin &&
          (edit ? (
            <span className="inline-flex gap-1">
              <button className="text-green" onClick={save} aria-label="Save">
                <Check size={15} />
              </button>
              <button className="text-text-dim" onClick={() => setEdit(false)} aria-label="Cancel">
                <X size={15} />
              </button>
            </span>
          ) : (
            <span className="inline-flex gap-1">
              <button className="rounded p-1 text-text-dim hover:text-foreground" onClick={() => setEdit(true)} aria-label="Edit">
                <Pencil size={13} />
              </button>
              <button
                className="rounded p-1 text-text-dim hover:text-red"
                aria-label="Delete"
                onClick={async () => {
                  if (!confirm(`Delete the WHT rate for ${rate.coa}?`)) return
                  try {
                    await whtApi.removeRate(rate.id)
                    onChanged()
                  } catch (e) {
                    toast.error(apiError(e))
                  }
                }}
              >
                <Trash2 size={13} />
              </button>
            </span>
          ))}
      </td>
    </tr>
  )
}
