import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { authApi, apiError } from '@/lib/api/shell'
import { useAuthStore } from '@/stores/authStore'
import { AuthLayout } from './AuthLayout'

/** /verify-email?token — confirm the account email. */
export default function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const signedIn = !!useAuthStore((s) => s.token)
  const updateUser = useAuthStore((s) => s.updateUser)
  const [state, setState] = useState<{ status: 'loading' | 'ok' | 'error'; message?: string }>({ status: token ? 'loading' : 'error', message: token ? undefined : 'This link is missing its token.' })
  const ran = useRef(false)

  useEffect(() => {
    if (!token || ran.current) return
    ran.current = true
    authApi
      .verifyEmail(token)
      .then(() => {
        setState({ status: 'ok' })
        if (signedIn) updateUser({ isEmailVerified: true })
      })
      .catch((e) => setState({ status: 'error', message: apiError(e).message }))
  }, [token, signedIn, updateUser])

  return (
    <AuthLayout title={state.status === 'ok' ? 'Email confirmed' : state.status === 'error' ? "Couldn't confirm your email" : 'Confirming your email…'}>
      <div className="flex flex-col items-center gap-4 text-center">
        {state.status === 'ok' && <CheckCircle2 size={44} className="text-green" />}
        {state.status === 'error' && <XCircle size={44} className="text-red" />}
        {state.status === 'loading' && <div className="h-8 w-8 animate-spin rounded-full border-2 border-surface3 border-t-gold" />}
        <p className="text-sm text-text-dim">
          {state.status === 'ok' ? 'Thanks — your email address is confirmed.' : state.status === 'error' ? `${state.message} You can request a new link from the sign-in page.` : 'One moment.'}
        </p>
        {state.status !== 'loading' && (
          <Link to={signedIn ? '/app' : '/login'} className="w-full">
            <Button className="w-full rounded-full">{signedIn ? 'Go to the app' : 'Sign in'}</Button>
          </Link>
        )}
      </div>
    </AuthLayout>
  )
}
