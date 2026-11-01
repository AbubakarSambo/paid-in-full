import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authApi, apiError } from '@/lib/api/shell'
import { AuthLayout, FormError, FormNotice } from './AuthLayout'
import { GoogleButton, googleEnabled } from './GoogleButton'
import { useFinishSession } from './useFinishSession'

type Mode = 'signin' | 'signup' | 'forgot' | 'resend'

const TITLES: Record<Mode, { title: string; subtitle: string }> = {
  signin: { title: 'Welcome back', subtitle: 'Sign in to your workspace.' },
  signup: { title: 'Create your workspace', subtitle: 'Set up Paid in Full for your business in a minute.' },
  forgot: { title: 'Reset your password', subtitle: "Enter your email and we'll send you a reset link." },
  resend: { title: 'Resend confirmation', subtitle: "We'll send a fresh email confirmation link." },
}

/** Spec §2 /login: sign in + create workspace + Google + forgot password + resend confirmation. */
export default function LoginPage() {
  const [params] = useSearchParams()
  const location = useLocation()
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
  const finish = useFinishSession()
  const [mode, setModeRaw] = useState<Mode>(params.get('mode') === 'signup' ? 'signup' : 'signin')
  const [name, setName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(params.get('reason') === 'idle' ? 'You were signed out after a period of inactivity. Sign in again to continue.' : null)
  const [errorCode, setErrorCode] = useState<string | undefined>()
  const [pendingGoogleToken, setPendingGoogleToken] = useState<string | null>(null)

  const setMode = (m: Mode) => {
    setModeRaw(m)
    setError(null)
    setErrorCode(undefined)
    if (m !== 'signin') setNotice(null)
  }
  const fail = (e: unknown) => {
    const err = apiError(e)
    setError(err.message)
    setErrorCode(err.code)
    setNotice(null)
  }

  const login = useMutation({ mutationFn: authApi.login, onSuccess: (s) => finish(s, from), onError: fail })
  const register = useMutation({ mutationFn: authApi.register, onSuccess: (s) => finish(s), onError: fail })
  const google = useMutation({
    mutationFn: authApi.google,
    onSuccess: (s) => finish(s, from),
    onError: (e, vars) => {
      const err = apiError(e)
      if (err.code === 'NO_ACCOUNT' && !vars.workspaceName) {
        // New Google user: ask for a workspace name, then retry with the same credential.
        setPendingGoogleToken(vars.idToken)
        setModeRaw('signup')
        setError(null)
        setNotice(`${err.message} Enter a workspace name below and continue with Google again to create one.`)
        return
      }
      fail(e)
    },
  })
  const forgot = useMutation({
    mutationFn: authApi.forgotPassword,
    onSuccess: (r) => {
      setError(null)
      setNotice(r.message)
    },
    onError: fail,
  })
  const resend = useMutation({
    mutationFn: authApi.resendConfirmation,
    onSuccess: (r) => {
      setError(null)
      setNotice(r.message)
    },
    onError: fail,
  })

  const busy = login.isPending || register.isPending || google.isPending || forgot.isPending || resend.isPending

  const onGoogle = (idToken: string) => {
    setError(null)
    if (mode === 'signup') {
      if (workspaceName.trim().length < 2) {
        setPendingGoogleToken(idToken)
        setError('Enter a workspace name (2+ characters) first.')
        return
      }
      google.mutate({ idToken, workspaceName: workspaceName.trim() })
    } else {
      google.mutate({ idToken })
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const em = email.trim()
    if (!/^\S+@\S+\.\S+$/.test(em)) return setError('Enter a valid email address.')
    if (mode === 'forgot') return forgot.mutate(em)
    if (mode === 'resend') return resend.mutate(em)
    if (mode === 'signin') {
      if (!password) return setError('Enter your password.')
      return login.mutate({ email: em, password })
    }
    if (!name.trim()) return setError('Enter your name.')
    if (workspaceName.trim().length < 2) return setError('Workspace name must be at least 2 characters.')
    if (pendingGoogleToken && !password) return google.mutate({ idToken: pendingGoogleToken, workspaceName: workspaceName.trim() })
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    register.mutate({ name: name.trim(), workspaceName: workspaceName.trim(), email: em, password })
  }

  // Confirmation emails link to /login?verify=<token>.
  const verifyToken = params.get('verify')
  if (verifyToken) return <Navigate to={`/verify-email?token=${encodeURIComponent(verifyToken)}`} replace />

  const t = TITLES[mode]
  return (
    <AuthLayout
      title={t.title}
      subtitle={t.subtitle}
      footer={
        mode === 'signin' ? (
          <>
            New to Paid in Full?{' '}
            <button className="font-semibold text-gold hover:underline" onClick={() => setMode('signup')}>
              Create a workspace
            </button>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <button className="font-semibold text-gold hover:underline" onClick={() => setMode('signin')}>
              Sign in
            </button>
          </>
        )
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormNotice message={notice} />
        <FormError message={error} />
        {errorCode === 'INVITE_PENDING' && (
          <button type="button" className="text-sm font-semibold text-gold hover:underline" onClick={() => forgot.mutate(email.trim())}>
            Email me a fresh invite link
          </button>
        )}
        {(errorCode === 'BAD_CREDENTIALS' || errorCode === 'RATE_LIMITED' || errorCode === 'GOOGLE_ACCOUNT') && (
          <button type="button" className="text-sm font-semibold text-gold hover:underline" onClick={() => setMode('forgot')}>
            Reset your password
          </button>
        )}

        {mode === 'signup' && (
          <>
            <div className="space-y-2">
              <Label htmlFor="name">Your name</Label>
              <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Obi" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ws">Workspace name</Label>
              <Input id="ws" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="Your business name" />
            </div>
          </>
        )}

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </div>

        {(mode === 'signin' || mode === 'signup') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              {mode === 'signin' && (
                <button type="button" className="text-xs font-semibold text-gold hover:underline" onClick={() => setMode('forgot')}>
                  Forgot password?
                </button>
              )}
            </div>
            <Input
              id="password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
            />
          </div>
        )}

        <Button type="submit" className="w-full rounded-full" isLoading={busy}>
          {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create workspace' : mode === 'forgot' ? 'Send reset link' : 'Resend confirmation'}
        </Button>

        {(mode === 'signin' || mode === 'signup') && googleEnabled && (
          <>
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
            </div>
            <GoogleButton onCredential={onGoogle} text={mode === 'signup' ? 'signup_with' : 'continue_with'} />
          </>
        )}

        {mode === 'signin' && (
          <p className="text-center text-xs text-text-dim">
            Didn't get your confirmation email?{' '}
            <button type="button" className="font-semibold text-gold hover:underline" onClick={() => setMode('resend')}>
              Resend it
            </button>
          </p>
        )}
        {(mode === 'forgot' || mode === 'resend') && (
          <p className="text-center text-xs">
            <button type="button" className="font-semibold text-gold hover:underline" onClick={() => setMode('signin')}>
              Back to sign in
            </button>
          </p>
        )}
      </form>
    </AuthLayout>
  )
}
