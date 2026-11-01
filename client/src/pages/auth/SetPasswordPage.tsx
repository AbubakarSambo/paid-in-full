import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authApi, apiError } from '@/lib/api/shell'
import { AuthLayout, FormError } from './AuthLayout'
import { useFinishSession } from './useFinishSession'

/**
 * /set-password?token (accept invite) and /reset-password?token (password reset).
 * Links are single-use; min 8 characters (spec §2).
 */
export default function SetPasswordPage({ mode = 'invite' }: { mode?: 'invite' | 'reset' }) {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const finish = useFinishSession()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)

  const info = useQuery({ queryKey: ['auth', 'token', token], queryFn: () => authApi.tokenInfo(token), enabled: !!token, retry: false })
  const isReset = mode === 'reset' || info.data?.type === 'PASSWORD_RESET' || params.get('reset') === '1'

  const submit = useMutation({
    mutationFn: () =>
      isReset ? authApi.resetPassword({ token, password }) : authApi.setPassword({ token, password, name: info.data?.needsName ? name.trim() : undefined }),
    onSuccess: (s) => finish(s),
    onError: (e) => setError(apiError(e).message),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (info.data?.needsName && !isReset && !name.trim()) return setError('Enter your name.')
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (password !== confirm) return setError("The two passwords don't match.")
    submit.mutate()
  }

  if (!token || info.isError) {
    return (
      <AuthLayout title="Link not valid" subtitle={token ? apiError(info.error).message : 'This link is missing its token.'}>
        <p className="text-sm text-text-dim">Ask your admin to resend the invite, or request a new reset link.</p>
        <div className="mt-5 flex gap-3">
          <Link to="/login" className="flex-1">
            <Button variant="outline" className="w-full">
              Back to sign in
            </Button>
          </Link>
        </div>
      </AuthLayout>
    )
  }

  const ws = info.data?.workspace
  return (
    <AuthLayout
      title={isReset ? 'Choose a new password' : ws ? `Join ${ws.name}` : 'Set your password'}
      subtitle={info.isLoading ? 'Checking your link…' : info.data?.email ? <>For <span className="font-semibold text-foreground">{info.data.email}</span></> : null}
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={error} />
        {!isReset && info.data?.needsName && (
          <div className="space-y-2">
            <Label htmlFor="name">Your name</Label>
            <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="pw">Password</Label>
          <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pw2">Confirm password</Label>
          <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <Button type="submit" className="w-full rounded-full" isLoading={submit.isPending} disabled={info.isLoading}>
          {isReset ? 'Save password & sign in' : 'Set password & continue'}
        </Button>
      </form>
    </AuthLayout>
  )
}
