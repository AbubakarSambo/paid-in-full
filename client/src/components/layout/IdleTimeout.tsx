import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { useWorkspaceConfig } from './hooks'

const LAST_ACTIVITY_KEY = 'pif-last-activity'
const WARN_MS = 60_000

function readLast(): number {
  try {
    return Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || Date.now()
  } catch {
    return Date.now()
  }
}

/**
 * Spec §2: sign out after N idle minutes (app-config session_timeout_minutes), warning 1 minute before.
 * Last activity is shared across tabs through localStorage.
 */
export function IdleTimeout() {
  const { data: ws } = useWorkspaceConfig()
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const minutes = ws?.settings?.sessionTimeoutMinutes || 30
  const timeoutMs = Math.max(2, minutes) * 60_000
  const [remaining, setRemaining] = useState<number | null>(null)
  const lastWrite = useRef(0)

  useEffect(() => {
    const mark = () => {
      const now = Date.now()
      if (now - lastWrite.current < 5_000) return
      lastWrite.current = now
      try {
        localStorage.setItem(LAST_ACTIVITY_KEY, String(now))
      } catch {
        /* ignore */
      }
    }
    lastWrite.current = 0
    mark()
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'] as const
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }))

    const tick = window.setInterval(() => {
      const idle = Date.now() - readLast()
      if (idle >= timeoutMs) {
        window.clearInterval(tick)
        logout()
        navigate('/login?reason=idle', { replace: true })
      } else if (idle >= timeoutMs - WARN_MS) {
        setRemaining(Math.ceil((timeoutMs - idle) / 1000))
      } else {
        setRemaining(null)
      }
    }, 1_000)

    return () => {
      events.forEach((e) => window.removeEventListener(e, mark))
      window.clearInterval(tick)
    }
  }, [timeoutMs, logout, navigate])

  if (remaining === null) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl">
        <h3 className="text-lg font-bold text-foreground">Still there?</h3>
        <p className="mt-2 text-sm text-text-dim">
          For security you'll be signed out in <span className="font-bold tabular-nums text-foreground">{remaining}s</span> because you've been inactive.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <Button
            variant="outline"
            onClick={() => {
              logout()
              navigate('/login')
            }}
          >
            Sign out
          </Button>
          <Button
            onClick={() => {
              try {
                localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()))
              } catch {
                /* ignore */
              }
              setRemaining(null)
            }}
          >
            Stay signed in
          </Button>
        </div>
      </div>
    </div>
  )
}
