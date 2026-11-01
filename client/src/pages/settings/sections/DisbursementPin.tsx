import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { KeyRound, ShieldCheck, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiError, meApi } from '@/lib/api/shell'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import { SectionCard, ymd } from '../SectionCard'

type Mode = null | 'set' | 'change' | 'reset'
const PIN_RE = /^\d{4,8}$/

/** §5.10 #14 Vendor Disbursements: set / change / reset my disbursement PIN (4–8 digits). */
export default function DisbursementPin() {
  const qc = useQueryClient()
  const updateUser = useAuthStore((s) => s.updateUser)
  const { data: status, isLoading } = useQuery({ queryKey: ['me', 'pin'], queryFn: meApi.pinStatus })
  const [mode, setMode] = useState<Mode>(null)
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')

  const close = () => {
    setMode(null)
    setCurrent('')
    setPassword('')
    setPin('')
    setConfirm('')
  }
  const submit = useMutation({
    mutationFn: () => (mode === 'reset' ? meApi.resetPin({ password, pin }) : meApi.setPin({ pin, currentPin: mode === 'change' ? current : undefined })),
    onSuccess: (s) => {
      qc.setQueryData(['me', 'pin'], s)
      updateUser({ hasPin: s.hasPin })
      toast.success(mode === 'set' ? 'PIN set' : mode === 'change' ? 'PIN changed' : 'PIN reset')
      close()
    },
    onError: (e) => toast.error(apiError(e).message),
  })

  const hasPin = !!status?.hasPin
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8)

  return (
    <SectionCard
      title="Vendor disbursements"
      description="Payers confirm every disbursement with a personal PIN and the typed batch total. Your PIN is stored hashed and never shown to anyone."
    >
      <div
        className={cn(
          'flex items-center gap-3 rounded-xl border px-4 py-3',
          isLoading ? 'border-border' : hasPin ? 'border-green/30 bg-green/5' : 'border-orange/30 bg-orange/5'
        )}
      >
        {hasPin ? <ShieldCheck size={20} className="text-green" /> : <ShieldAlert size={20} className="text-orange" />}
        <div className="flex-1 text-sm">
          <p className={cn('font-semibold', hasPin ? 'text-green' : 'text-orange')}>
            {isLoading ? 'Checking…' : status?.message ?? (hasPin ? 'Your disbursement PIN is set.' : 'You have not set your PIN — you cannot pay until you do.')}
          </p>
          {status?.pinSetAt && <p className="text-xs text-text-dim">Set on {ymd(status.pinSetAt)}</p>}
          {status?.lockedUntil && <p className="text-xs text-red">Locked after too many wrong attempts until {new Date(status.lockedUntil).toLocaleTimeString()}. Reset it with your password.</p>}
        </div>
      </div>

      {!mode && (
        <div className="mt-4 flex flex-wrap gap-2">
          {!hasPin ? (
            <Button onClick={() => setMode('set')}>
              <KeyRound size={15} /> Set my PIN
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setMode('change')}>
                Change PIN
              </Button>
              <Button variant="ghost" onClick={() => setMode('reset')}>
                Forgot PIN? Reset it
              </Button>
            </>
          )}
        </div>
      )}

      {mode && (
        <form
          className="mt-4 grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (mode === 'change' && !current) return toast.error('Enter your current PIN.')
            if (mode === 'reset' && !password) return toast.error('Enter your account password.')
            if (!PIN_RE.test(pin)) return toast.error('PIN must be 4–8 digits.')
            if (pin !== confirm) return toast.error("The PINs don't match.")
            submit.mutate()
          }}
        >
          <p className="text-sm font-bold text-foreground sm:col-span-2">{mode === 'set' ? 'Set your PIN' : mode === 'change' ? 'Change your PIN' : 'Reset your PIN'}</p>
          {mode === 'change' && (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="pin-cur">Current PIN</Label>
              <Input id="pin-cur" type="password" inputMode="numeric" autoComplete="off" value={current} onChange={(e) => setCurrent(digits(e.target.value))} />
            </div>
          )}
          {mode === 'reset' && (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="pin-pw">Account password</Label>
              <Input id="pin-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="pin-new">New PIN (4–8 digits)</Label>
            <Input id="pin-new" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(digits(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pin-confirm">Confirm PIN</Label>
            <Input id="pin-confirm" type="password" inputMode="numeric" autoComplete="off" value={confirm} onChange={(e) => setConfirm(digits(e.target.value))} />
          </div>
          <div className="flex justify-end gap-3 sm:col-span-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" isLoading={submit.isPending}>
              Save PIN
            </Button>
          </div>
        </form>
      )}
    </SectionCard>
  )
}
