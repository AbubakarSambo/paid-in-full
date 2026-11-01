import { useEffect, useRef } from 'react'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

interface GoogleId {
  accounts: {
    id: {
      initialize: (opts: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }) => void
      renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void
    }
  }
}
declare global {
  interface Window {
    google?: GoogleId
  }
}

let scriptPromise: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      scriptPromise = null
      reject(new Error('Google sign-in failed to load'))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

export const googleEnabled = !!CLIENT_ID

/** "Continue with Google" (Google Identity Services). Renders nothing unless VITE_GOOGLE_CLIENT_ID is set. */
export function GoogleButton({ onCredential, text = 'continue_with' }: { onCredential: (idToken: string) => void; text?: 'continue_with' | 'signup_with' }) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onCredential)
  useEffect(() => {
    cb.current = onCredential
  }, [onCredential])

  useEffect(() => {
    if (!CLIENT_ID) return
    let cancelled = false
    loadGis()
      .then(() => {
        if (cancelled || !ref.current || !window.google) return
        window.google.accounts.id.initialize({ client_id: CLIENT_ID, callback: (r) => cb.current(r.credential) })
        ref.current.innerHTML = ''
        window.google.accounts.id.renderButton(ref.current, {
          theme: document.documentElement.classList.contains('dark') ? 'filled_black' : 'outline',
          size: 'large',
          shape: 'pill',
          text,
          width: Math.min(ref.current.offsetWidth || 360, 400),
        })
      })
      .catch(() => {
        /* script blocked: the email form still works */
      })
    return () => {
      cancelled = true
    }
  }, [text])

  if (!CLIENT_ID) return null
  return <div ref={ref} className="flex min-h-[44px] w-full justify-center" />
}
