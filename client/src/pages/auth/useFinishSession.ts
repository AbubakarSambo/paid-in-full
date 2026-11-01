import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import type { Session } from '@/types/shell'

/** Store a session and route: onboarding → wizard; platform staff without workspace → console; else /app. */
export function useFinishSession() {
  const setSession = useAuthStore((s) => s.setSession)
  const navigate = useNavigate()
  return (session: Session, from?: string) => {
    setSession(session)
    if (session.needsOnboarding) navigate('/onboarding', { replace: true })
    else if (!session.workspace && session.user.platformRole) navigate('/super-admin', { replace: true })
    else navigate(from && from.startsWith('/app') ? from : '/app/queue', { replace: true })
  }
}
