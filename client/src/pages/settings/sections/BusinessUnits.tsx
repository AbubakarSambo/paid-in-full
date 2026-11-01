import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { costCentersApi, locationsApi, apiError } from '@/lib/api/spend'
import { usePermissions } from '@/lib/permissions'
import { spendKeys, useCostCenters } from '@/components/shared/hooks'
import { MicroChip } from '@/components/shared/Popover'
import { AdminOnlyNote, ReorderButtons, SettingsSection, moveId } from '@/components/shared/SettingsSection'
import type { CostCenter, Location } from '@/types/spend'

export default function BusinessUnits() {
  const qc = useQueryClient()
  const { isAdmin } = usePermissions()
  const { data: bus = [], isLoading } = useCostCenters()
  const [newName, setNewName] = useState('')
  const [newCode, setNewCode] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: spendKeys.costCenters })
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast.success(ok)
      refresh()
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const add = () => {
    if (!newName.trim()) return
    void act(() => costCentersApi.create({ name: newName.trim(), code: newCode.trim() || undefined, createGeneralHead: true }), 'Business unit added').then(() => {
      setNewName('')
      setNewCode('')
    })
  }

  return (
    <SettingsSection id="business-units" title="Business Units" description="Business units (with a short code) and the BU Heads beneath each. “✦ General (split)” spreads a cost across the unit.">
      {!isAdmin && <AdminOnlyNote />}
      {isLoading && <p className="text-sm text-text-dim">Loading…</p>}
      <div className="space-y-3">
        {bus.map((bu, idx) => (
          <BuRow
            key={bu.id}
            bu={bu}
            isAdmin={isAdmin}
            first={idx === 0}
            last={idx === bus.length - 1}
            onMove={(dir) => act(() => costCentersApi.reorder(moveId(bus.map((b) => b.id), bu.id, dir)))}
            act={act}
          />
        ))}
      </div>
      {isAdmin && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New business unit, e.g. Hotel" className="max-w-xs" onKeyDown={(e) => e.key === 'Enter' && add()} />
          <Input value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} placeholder="Code (YD)" className="w-28" maxLength={20} />
          <Button size="sm" className="h-11" onClick={add} disabled={!newName.trim()}>
            <Plus size={14} /> Add BU
          </Button>
        </div>
      )}
    </SettingsSection>
  )
}

function BuRow({
  bu,
  isAdmin,
  first,
  last,
  onMove,
  act,
}: {
  bu: CostCenter
  isAdmin: boolean
  first: boolean
  last: boolean
  onMove: (dir: -1 | 1) => void
  act: (fn: () => Promise<unknown>, ok?: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(bu.name)
  const [code, setCode] = useState(bu.code ?? '')
  const [headName, setHeadName] = useState('')
  const heads = bu.locations ?? []

  return (
    <div className={`rounded-xl border border-border p-3 ${bu.isActive ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 max-w-xs" />
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="h-9 w-24" placeholder="Code" />
            <button
              className="text-green"
              aria-label="Save"
              onClick={() => act(() => costCentersApi.update(bu.id, { name: name.trim(), code: code.trim() }), 'Saved').then(() => setEditing(false))}
            >
              <Check size={16} />
            </button>
            <button className="text-text-dim" aria-label="Cancel" onClick={() => setEditing(false)}>
              <X size={16} />
            </button>
          </>
        ) : (
          <>
            <span className="font-semibold">{bu.name}</span>
            {bu.code && <MicroChip className="text-gold">{bu.code}</MicroChip>}
            {!bu.isActive && <MicroChip className="text-text-dim">Inactive</MicroChip>}
          </>
        )}
        {isAdmin && !editing && (
          <span className="ml-auto flex items-center gap-1">
            <ReorderButtons onUp={() => onMove(-1)} onDown={() => onMove(1)} disableUp={first} disableDown={last} />
            <button className="rounded p-1 text-text-dim hover:text-foreground" aria-label="Rename" onClick={() => setEditing(true)}>
              <Pencil size={13} />
            </button>
            {!bu.isActive ? (
              <button className="text-xs text-gold hover:underline" onClick={() => act(() => costCentersApi.update(bu.id, { isActive: true }), 'Reactivated')}>
                Reactivate
              </button>
            ) : (
              <button
                className="rounded p-1 text-text-dim hover:text-red"
                aria-label="Delete"
                onClick={() => confirm(`Delete ${bu.name}? If it's in use it will be deactivated instead.`) && act(() => costCentersApi.remove(bu.id), 'Business unit removed')}
              >
                <Trash2 size={13} />
              </button>
            )}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 pl-2">
        {heads.map((h, i) => (
          <HeadChip
            key={h.id}
            head={h}
            isAdmin={isAdmin}
            onMove={(dir) => act(() => locationsApi.reorder(moveId(heads.map((x) => x.id), h.id, dir)))}
            first={i === 0}
            last={i === heads.length - 1}
            act={act}
          />
        ))}
        {heads.length === 0 && <span className="text-xs text-text-dim">No BU heads yet</span>}
      </div>
      {isAdmin && (
        <div className="mt-2 flex gap-2 pl-2">
          <Input
            value={headName}
            onChange={(e) => setHeadName(e.target.value)}
            placeholder="Add BU head, e.g. Site 1"
            className="h-8 max-w-xs text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && headName.trim()) void act(() => locationsApi.create({ costCenterId: bu.id, name: headName.trim() }), 'BU head added').then(() => setHeadName(''))
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={!headName.trim()}
            onClick={() => act(() => locationsApi.create({ costCenterId: bu.id, name: headName.trim() }), 'BU head added').then(() => setHeadName(''))}
          >
            <Plus size={12} /> Head
          </Button>
          {!heads.some((h) => h.isGeneral) && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => act(() => locationsApi.create({ costCenterId: bu.id, name: 'General (split)', isGeneral: true }), 'General head added')}>
              + ✦ General (split)
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function HeadChip({
  head,
  isAdmin,
  first,
  last,
  onMove,
  act,
}: {
  head: Location
  isAdmin: boolean
  first: boolean
  last: boolean
  onMove: (dir: -1 | 1) => void
  act: (fn: () => Promise<unknown>, ok?: string) => Promise<void>
}) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/50 px-2 py-1 text-xs ${head.isActive ? '' : 'opacity-50'}`}>
      {head.isGeneral ? <span className="text-gold">✦ {head.name.replace(/^✦\s*/, '')}</span> : head.name}
      {isAdmin && (
        <>
          <ReorderButtons onUp={() => onMove(-1)} onDown={() => onMove(1)} disableUp={first} disableDown={last} />
          <label className="flex items-center gap-0.5 text-[10px] text-text-dim" title="General (split) head">
            <input type="checkbox" checked={head.isGeneral} onChange={(e) => act(() => locationsApi.update(head.id, { isGeneral: e.target.checked }))} />
            General
          </label>
          <button
            className="text-text-dim hover:text-foreground"
            aria-label="Rename"
            onClick={() => {
              const n = prompt('Rename BU head', head.name)
              if (n && n.trim() && n.trim() !== head.name) void act(() => locationsApi.update(head.id, { name: n.trim() }), 'Renamed')
            }}
          >
            <Pencil size={11} />
          </button>
          <button className="text-text-dim hover:text-red" aria-label="Delete" onClick={() => confirm(`Remove ${head.name}?`) && act(() => locationsApi.remove(head.id), 'Removed')}>
            <X size={12} />
          </button>
        </>
      )}
    </span>
  )
}
