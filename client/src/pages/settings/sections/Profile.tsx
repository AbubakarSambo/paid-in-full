import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Camera, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiError, meApi } from '@/lib/api/shell'
import { useAuthStore } from '@/stores/authStore'
import type { SessionUser } from '@/types/shell'
import { SectionCard } from '../SectionCard'

const AVATAR_MAX = 1024 * 1024

/** §5.10 #1 Your profile: display name, email (read-only), avatar (≤ 1 MB), change password (8+). */
export default function Profile() {
  const user = useAuthStore((s) => s.user)
  const updateUser = useAuthStore((s) => s.updateUser)
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  useEffect(() => setDisplayName(user?.displayName ?? ''), [user?.displayName])

  const applyMe = (me: SessionUser) => updateUser({ displayName: me.displayName, avatarUrl: me.avatarUrl, firstName: me.firstName, lastName: me.lastName, hasPassword: me.hasPassword })

  const save = useMutation({
    mutationFn: () => meApi.update({ displayName: displayName.trim() }),
    onSuccess: (me) => {
      applyMe(me)
      toast.success('Profile saved')
    },
    onError: (e) => toast.error(apiError(e).message),
  })
  const avatar = useMutation({
    mutationFn: meApi.uploadAvatar,
    onSuccess: (me) => {
      applyMe(me)
      toast.success('Avatar updated')
    },
    onError: (e) => toast.error(apiError(e).message),
  })
  const removeAvatar = useMutation({ mutationFn: meApi.removeAvatar, onSuccess: applyMe, onError: (e) => toast.error(apiError(e).message) })
  const password = useMutation({
    mutationFn: () => meApi.changePassword({ currentPassword: user?.hasPassword ? current : undefined, newPassword: next }),
    onSuccess: () => {
      toast.success('Password changed')
      updateUser({ hasPassword: true })
      setCurrent('')
      setNext('')
      setConfirm('')
    },
    onError: (e) => toast.error(apiError(e).message),
  })

  return (
    <SectionCard title="Your profile" description="How you appear to your team.">
      <div className="grid gap-6 lg:grid-cols-2">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!displayName.trim()) return toast.error('Display name cannot be empty.')
            save.mutate()
          }}
        >
          <div className="flex items-center gap-4">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-16 w-16 rounded-full border border-border object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gold/15 font-display text-xl font-bold text-gold">
                {(user?.displayName || user?.email || '?').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-foreground hover:border-gold/40">
                <Camera size={14} /> {avatar.isPending ? 'Uploading…' : 'Upload avatar'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (!f) return
                    if (f.size > AVATAR_MAX) return toast.error('Avatar must be 1 MB or smaller.')
                    avatar.mutate(f)
                  }}
                />
              </label>
              {user?.avatarUrl && (
                <Button type="button" size="sm" variant="ghost" onClick={() => removeAvatar.mutate()} disabled={removeAvatar.isPending}>
                  <Trash2 size={14} /> Remove
                </Button>
              )}
              <p className="w-full text-xs text-text-muted">Max 1 MB.</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-name">Display name</Label>
            <Input id="p-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-email">Email</Label>
            <Input id="p-email" value={user?.email ?? ''} readOnly disabled />
          </div>
          <div className="flex justify-end">
            <Button type="submit" isLoading={save.isPending}>
              Save
            </Button>
          </div>
        </form>

        <form
          className="space-y-4 rounded-xl border border-border p-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (user?.hasPassword && !current) return toast.error('Enter your current password.')
            if (next.length < 8) return toast.error('Password must be at least 8 characters.')
            if (next !== confirm) return toast.error("The new passwords don't match.")
            password.mutate()
          }}
        >
          <p className="text-sm font-bold text-foreground">{user?.hasPassword ? 'Change password' : 'Add a password'}</p>
          {!user?.hasPassword && <p className="text-xs text-text-dim">You sign in with Google. Add a password to also sign in with email.</p>}
          {user?.hasPassword && (
            <div className="space-y-2">
              <Label htmlFor="pw-cur">Current password</Label>
              <Input id="pw-cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="pw-new">New password</Label>
            <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 8 characters" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw-confirm">Confirm new password</Label>
            <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="outline" isLoading={password.isPending}>
              Update password
            </Button>
          </div>
        </form>
      </div>
    </SectionCard>
  )
}
