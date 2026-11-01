import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { activityApi } from '@/lib/api/shell'
import { usePermissions } from '@/lib/permissions'
import { ReadOnly, SectionCard } from '../SectionCard'

const fmt = (d: string) => {
  const x = new Date(d)
  return `${x.toISOString().slice(0, 10)} ${x.toTimeString().slice(0, 5)}`
}

/** §5.10 #23 Audit log: the last 100 sensitive actions (admin). */
export default function AuditLog() {
  const { isAdmin } = usePermissions()
  const [q, setQ] = useState('')
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['audit-log'], queryFn: activityApi.auditLog, enabled: isAdmin })
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) => [r.actorName, r.actorEmail, r.action, r.actionLabel, r.target].some((v) => v?.toLowerCase().includes(s)))
  }, [rows, q])

  return (
    <SectionCard
      title="Audit log"
      description="The last 100 sensitive actions in this workspace."
      actions={isAdmin ? <Input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 w-48" /> : undefined}
    >
      {!isAdmin ? (
        <ReadOnly />
      ) : (
        <div className="max-h-[480px] overflow-auto rounded-xl border border-border">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-muted">
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Target</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-text-dim">
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-text-dim">
                    Nothing logged yet.
                  </td>
                </tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-text-dim">{fmt(r.createdAt)}</td>
                  <td className="px-3 py-2 text-foreground">
                    {r.actorName}
                    {r.actorEmail && r.actorEmail !== r.actorName && <span className="block text-[11px] text-text-muted">{r.actorEmail}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-foreground">{r.actionLabel}</span>
                    <span className="block font-mono text-[11px] text-text-muted">{r.action}</span>
                  </td>
                  <td className="max-w-[260px] truncate px-3 py-2 text-text-dim" title={r.target ?? ''}>
                    {r.target ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}
