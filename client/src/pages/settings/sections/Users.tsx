import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { membersApi } from '@/lib/api/shell'
import { Button } from '@/components/ui/button'
import { SectionCard } from '../SectionCard'

/** Team summary inside Settings; the full Users tab is pages/UsersPage. */
export default function Users() {
  const { data: members = [] } = useQuery({ queryKey: ['users'], queryFn: membersApi.list })
  const invited = members.filter((m) => m.status === 'invited').length
  const noPin = members.filter((m) => (m.role === 'PAYER' || m.role === 'ADMIN') && !m.hasPin && m.status === 'active').length
  return (
    <SectionCard
      title="Team"
      description={
        <>
          {members.length} member{members.length === 1 ? '' : 's'}
          {invited ? ` · ${invited} invited` : ''}
          {noPin ? ` · ${noPin} payer${noPin === 1 ? '' : 's'} without a PIN` : ''}
        </>
      }
      actions={
        <Link to="/app/users">
          <Button size="sm" variant="outline">
            Manage users <ArrowRight size={14} />
          </Button>
        </Link>
      }
    >
      <div className="flex flex-wrap gap-2">
        {members.slice(0, 12).map((m) => (
          <span key={m.id} className="rounded-full border border-border bg-surface2 px-3 py-1 text-xs text-foreground">
            {m.displayName} <span className="text-text-muted">· {m.role.toLowerCase()}</span>
          </span>
        ))}
      </div>
    </SectionCard>
  )
}
