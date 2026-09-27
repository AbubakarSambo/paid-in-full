import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { UserPlus, Trash2 } from 'lucide-react'
import { usersApi, workspaceApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { getInitials } from '@/lib/utils'

export default function TeamSettings() {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('MEMBER')

  const { data: members, isLoading } = useQuery({ queryKey: ['users', 'workspace-members'], queryFn: usersApi.workspaceMembers })

  const inviteMutation = useMutation({
    mutationFn: () => workspaceApi.addMember({ email, role }),
    onSuccess: () => {
      toast.success('Invitation sent')
      setEmail('')
      qc.invalidateQueries({ queryKey: ['users', 'workspace-members'] })
    },
    onError: () => toast.error('Could not invite member'),
  })

  const removeMutation = useMutation({
    mutationFn: (userId: string) => workspaceApi.removeMember(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users', 'workspace-members'] }),
  })

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Invite a teammate</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!email) return
              inviteMutation.mutate()
            }}
          >
            <Input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-xs" />
            <Select value={role} onChange={(e) => setRole(e.target.value)} className="max-w-[160px]">
              <option value="ADMIN">Admin</option>
              <option value="MEMBER">Member</option>
              <option value="APPROVER">Approver</option>
            </Select>
            <Button type="submit" isLoading={inviteMutation.isPending}>
              <UserPlus size={16} /> Invite
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {members?.map((m) => (
            <div key={m.id} className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-gold/15 flex items-center justify-center text-sm font-bold text-gold">
                  {getInitials(m.firstName, m.lastName)}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {m.firstName} {m.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                </div>
              </div>
              <button onClick={() => removeMutation.mutate(m.id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {!isLoading && (members?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">No teammates yet.</p>}
        </CardContent>
      </Card>
    </div>
  )
}
