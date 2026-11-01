import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Copy, Mail, MoreHorizontal, Pencil, Plus, Trash2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog, Modal } from '@/components/ui/dialog'
import { membersApi, apiError } from '@/lib/api/shell'
import { ROLE_BADGE_CLASS, ROLE_LABELS, ROLE_ORDER, usePermissions, type WorkspaceRole } from '@/lib/permissions'
import { useAuthStore } from '@/stores/authStore'
import { Chip, Dropdown, MenuItem } from '@/components/layout/Dropdown'
import { copyText } from '@/components/layout/shellStore'
import type { Member, WorkspaceRoleName } from '@/types/shell'

const ROLES_DESC = [...ROLE_ORDER].reverse() as WorkspaceRole[]

export function RoleBadge({ role }: { role: string }) {
  const r = (role?.toUpperCase() as WorkspaceRole) || 'VIEWER'
  return <Chip className={ROLE_BADGE_CLASS[r] ?? ROLE_BADGE_CLASS.VIEWER}>{ROLE_LABELS[r] ?? role}</Chip>
}

function InviteLinkBox({ url }: { url: string }) {
  return (
    <div className="space-y-2 rounded-xl border border-orange/30 bg-orange/10 p-3">
      <p className="text-sm text-orange">The invite email couldn't be sent. Copy this link and share it with them directly. It works once.</p>
      <div className="flex gap-2">
        <Input readOnly value={url} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          onClick={async () => ((await copyText(url)) ? toast.success('Invite link copied') : toast.error('Copy failed'))}
        >
          <Copy size={14} />
        </Button>
      </div>
    </div>
  )
}

/** Spec §5.9 Users tab. Everyone can view; admins edit. */
export default function UsersPage() {
  const qc = useQueryClient()
  const me = useAuthStore((s) => s.user)
  const { isAdmin } = usePermissions()
  const { data: members = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: membersApi.list })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] })

  const [inviteOpen, setInviteOpen] = useState(false)
  const [editing, setEditing] = useState<Member | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [resendLink, setResendLink] = useState<string | null>(null)

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: WorkspaceRoleName }) => membersApi.setRole(id, role),
    onSuccess: () => {
      toast.success('Role updated')
      invalidate()
    },
    onError: (e) => toast.error(apiError(e).message),
  })
  const setBiller = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => membersApi.setBiller(id, on),
    onSuccess: (_, v) => {
      toast.success(v.on ? 'Biller access granted' : 'Biller access removed')
      invalidate()
    },
    onError: (e) => toast.error(apiError(e).message),
  })
  const resend = useMutation({
    mutationFn: membersApi.resendInvite,
    onSuccess: (r) => {
      if (r.emailSent) toast.success('Invite re-sent')
      else if (r.inviteUrl) setResendLink(r.inviteUrl)
      else toast.error("Couldn't send the invite.")
    },
    onError: (e) => toast.error(apiError(e).message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => membersApi.remove(id),
    onSuccess: () => {
      toast.success('Removed from workspace')
      setRemoving(null)
      invalidate()
    },
    onError: (e) => toast.error(apiError(e).message),
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Users</h1>
          <p className="mt-1 max-w-3xl text-sm text-text-dim">
            Viewer can sign in &amp; see, Poster can create in Queue, Approver can move to Batches, Payer can pay out, Admin manages everything. Biller is an add-on that can be
            granted to any role for invoicing access.
          </p>
        </div>
        {isAdmin ? (
          <Button onClick={() => setInviteOpen(true)} className="rounded-full">
            <UserPlus size={16} /> Invite user
          </Button>
        ) : (
          <Chip className="border-border bg-surface2 text-text-dim">View mode</Chip>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-muted">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Biller</th>
                <th className="px-4 py-3 font-semibold">Set role</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-text-dim">
                    Loading…
                  </td>
                </tr>
              )}
              {members.map((m) => {
                const self = m.id === me?.id
                return (
                  <tr key={m.id} className="border-b border-border last:border-0 hover:bg-surface2/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        {m.avatarUrl ? (
                          <img src={m.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface3 text-xs font-bold text-text-dim">
                            {(m.displayName || m.email).charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="font-semibold text-foreground">
                            {m.displayName}
                            {self && <span className="ml-1.5 text-xs font-normal text-text-muted">(you)</span>}
                          </p>
                          {!m.hasPin && (m.role === 'PAYER' || m.role === 'ADMIN') && <p className="text-[11px] text-orange">No disbursement PIN</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-dim">{m.email}</td>
                    <td className="px-4 py-3">
                      <Chip className={m.status === 'active' ? 'border-green/30 bg-green/10 text-green' : 'border-orange/30 bg-orange/10 text-orange'}>
                        {m.status === 'active' ? 'Active' : 'Invited'}
                      </Chip>
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={m.role} />
                    </td>
                    <td className="px-4 py-3">
                      <Switch
                        checked={m.isBiller}
                        disabled={!isAdmin || setBiller.isPending}
                        onChange={(on) => setBiller.mutate({ id: m.id, on })}
                        label={`Biller for ${m.displayName}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin ? (
                        <Select
                          value={m.role}
                          disabled={(self && m.role === 'ADMIN') || setRole.isPending}
                          title={self && m.role === 'ADMIN' ? "You can't remove your own admin role" : undefined}
                          onChange={(e) => setRole.mutate({ id: m.id, role: e.target.value as WorkspaceRoleName })}
                          className="h-9 w-36 text-xs"
                        >
                          {ROLES_DESC.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin && (
                        <Dropdown
                          trigger={() => (
                            <button type="button" className="rounded-lg p-1.5 text-text-dim hover:bg-surface3" aria-label="Actions">
                              <MoreHorizontal size={16} />
                            </button>
                          )}
                        >
                          {(close) => (
                            <>
                              {m.status === 'invited' && (
                                <MenuItem
                                  icon={<Mail size={15} />}
                                  onClick={() => {
                                    close()
                                    resend.mutate(m.id)
                                  }}
                                >
                                  Resend invite
                                </MenuItem>
                              )}
                              <MenuItem
                                icon={<Pencil size={15} />}
                                onClick={() => {
                                  close()
                                  setEditing(m)
                                }}
                              >
                                Edit name
                              </MenuItem>
                              <MenuItem
                                danger
                                disabled={self}
                                icon={<Trash2 size={15} />}
                                onClick={() => {
                                  close()
                                  setRemoving(m)
                                }}
                              >
                                {self ? "You can't remove yourself" : 'Remove from workspace'}
                              </MenuItem>
                            </>
                          )}
                        </Dropdown>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} onDone={invalidate} />
      {editing && <EditNameDialog member={editing} onClose={() => setEditing(null)} onDone={invalidate} />}
      <ConfirmDialog
        isOpen={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.id)}
        title="Remove from workspace?"
        description={removing ? `${removing.displayName} (${removing.email}) will lose access to this workspace immediately.` : ''}
        confirmText="Remove"
        isDangerous
        isLoading={remove.isPending}
      />
      <Modal isOpen={!!resendLink} onClose={() => setResendLink(null)} title="Share the invite link">
        {resendLink && <InviteLinkBox url={resendLink} />}
        <div className="mt-4 flex justify-end">
          <Button onClick={() => setResendLink(null)}>Done</Button>
        </div>
      </Modal>
    </div>
  )
}

function InviteDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<WorkspaceRoleName>('POSTER')
  const [isBiller, setIsBiller] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const reset = () => {
    setName('')
    setEmail('')
    setRole('POSTER')
    setIsBiller(false)
    setLink(null)
  }
  const close = () => {
    reset()
    onClose()
  }
  const invite = useMutation({
    mutationFn: () => membersApi.invite({ name: name.trim(), email: email.trim(), role, isBiller }),
    onSuccess: (r) => {
      onDone()
      if (r.emailSent) {
        toast.success(`Invite sent to ${r.email}`)
        close()
      } else if (r.inviteUrl) {
        setLink(r.inviteUrl)
      } else {
        toast.warning('User added, but the invite email could not be sent.')
        close()
      }
    },
    onError: (e) => toast.error(apiError(e).message),
  })

  return (
    <Modal isOpen={open} onClose={close} title="Invite user" description="They'll get an email link to set their own password.">
      {link ? (
        <div className="space-y-4">
          <InviteLinkBox url={link} />
          <div className="flex justify-end">
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return toast.error('Enter a name.')
            if (!/^\S+@\S+\.\S+$/.test(email.trim())) return toast.error('Enter a valid email address.')
            invite.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="inv-name">Name</Label>
            <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inv-email">Email</Label>
            <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inv-role">Role</Label>
            <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as WorkspaceRoleName)}>
              {ROLES_DESC.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-2.5 text-sm text-foreground">
            <Switch checked={isBiller} onChange={setIsBiller} label="Biller" /> Biller (invoicing access)
          </label>
          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" isLoading={invite.isPending}>
              <Plus size={15} /> Send invite
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

function EditNameDialog({ member, onClose, onDone }: { member: Member; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(member.displayName)
  const save = useMutation({
    mutationFn: () => membersApi.editName(member.id, name.trim()),
    onSuccess: () => {
      toast.success('Name updated')
      onDone()
      onClose()
    },
    onError: (e) => toast.error(apiError(e).message),
  })
  return (
    <Modal isOpen onClose={onClose} title="Edit name" description={member.email}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) save.mutate()
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={save.isPending} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}
