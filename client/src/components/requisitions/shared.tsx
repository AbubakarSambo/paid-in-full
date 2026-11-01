import { Chip } from '@/components/queue/common'
import type { RequisitionStatus } from '@/types/requisitions'

const STATUS: Record<RequisitionStatus, { label: string; tone: 'dim' | 'blue' | 'green' | 'orange' | 'purple' | 'red' }> = {
  DRAFT: { label: 'Draft', tone: 'dim' },
  SUBMITTED: { label: 'Submitted', tone: 'blue' },
  PROCUREMENT_CLEARED: { label: 'Cleared', tone: 'green' },
  RETURNED: { label: 'Returned', tone: 'orange' },
  QUEUED: { label: 'Queued', tone: 'purple' },
  REJECTED: { label: 'Rejected', tone: 'red' },
}

export function StatusBadge({ status }: { status: RequisitionStatus }) {
  const s = STATUS[status] ?? { label: status, tone: 'dim' as const }
  return <Chip tone={s.tone}>{s.label}</Chip>
}

/** Description issues returned by the server (400 errors.issues) or computed locally. */
export function IssuesList({ issues }: { issues: { description: string; issues: string[] }[] }) {
  if (!issues.length) return null
  return (
    <div className="rounded-xl border border-orange/40 bg-orange/5 p-3 text-sm">
      <div className="mb-1 font-semibold text-orange">Fix these before submitting (Description Rules)</div>
      {issues.map((i, idx) => (
        <div key={idx} className="mt-1">
          <div className="text-xs font-medium">{i.description || '(empty description)'}</div>
          <ul className="ml-4 list-disc text-[12px] text-text-dim">
            {i.issues.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
