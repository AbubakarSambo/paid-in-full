import { useEffect, useLayoutEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { useShellUi, userFlag } from './shellStore'

/** Spec §13: 60-second product tour. */
const STEPS = [
  { target: 'queue', title: 'Queue', body: 'Everything waiting to be paid lands here: add items by hand, CSV or quick-add, tag them by category, COA and Business Unit, then select and approve.' },
  { target: 'batches', title: 'Batches & disbursement', body: 'Approved items become one batch per category. A payer disburses the batch through Monnify with their PIN and the typed total.' },
  { target: 'vendors', title: 'Vendors', body: 'Your vendor register. Bank accounts are name-verified, and missing TINs or bank codes are flagged before you pay.' },
  { target: 'settings', title: 'Settings', body: 'Wallet, WHT, categories and COA, Google Sheets sync, your disbursement PIN and notifications all live here.' },
  { target: 'users', title: 'Your team', body: 'Invite people and give each one a role: viewer, requester, procurement, poster, approver, payer or admin. Biller adds invoicing.' },
]

export const WHATS_NEW_VERSION = '2026.11'
const WHATS_NEW = [
  { title: 'New tabbed layout', body: 'Every module is one click away in the tab bar, and it works on your phone too.' },
  { title: 'Wallet pill', body: 'See what you can send right now, plus the Google Sheets sync state, at a glance.' },
  { title: 'Recent activity', body: 'The bell shows what your team did, with relative times.' },
  { title: 'Phone push alerts', body: 'Turn on push in Settings → Notifications to hear about new queue items, batches and payouts.' },
  { title: 'Classic look', body: 'Prefer the original gold accent? Switch it on in Settings → Appearance.' },
]

export function ProductTour() {
  const userId = useAuthStore((s) => s.user?.id)
  const { tourOpen, setTourOpen, setWhatsNewOpen } = useShellUi()
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  // Auto-start for users who haven't seen it; otherwise surface "What's new" if it's unseen.
  useEffect(() => {
    if (!userId) return
    const t = window.setTimeout(() => {
      if (!userFlag.get(userId, 'tour-done')) setTourOpen(true)
      else if (userFlag.get(userId, 'whats-new') !== WHATS_NEW_VERSION) setWhatsNewOpen(true)
    }, 800)
    return () => window.clearTimeout(t)
  }, [userId, setTourOpen, setWhatsNewOpen])

  useEffect(() => {
    if (tourOpen) setStep(0)
  }, [tourOpen])

  useLayoutEffect(() => {
    if (!tourOpen) return
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${STEPS[step].target}"]`)
      el?.scrollIntoView({ block: 'nearest', inline: 'center' })
      setRect(el ? el.getBoundingClientRect() : null)
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [tourOpen, step])

  if (!tourOpen) return null
  const finish = () => {
    userFlag.set(userId, 'tour-done', new Date().toISOString())
    setTourOpen(false)
    if (userFlag.get(userId, 'whats-new') !== WHATS_NEW_VERSION) window.setTimeout(() => setWhatsNewOpen(true), 300)
  }
  const s = STEPS[step]
  const last = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-[55]">
      <div className="absolute inset-0 bg-black/55" onClick={finish} />
      {rect && (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-gold shadow-[0_0_0_9999px_rgba(0,0,0,0.0)] transition-all"
          style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
        />
      )}
      <div
        className="absolute left-1/2 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-border bg-card p-5 shadow-2xl"
        style={{ top: rect ? Math.min(rect.bottom + 16, window.innerHeight - 240) : '30%' }}
      >
        <button onClick={finish} className="absolute right-4 top-4 rounded-full p-1 text-text-dim hover:bg-surface3" aria-label="Close tour">
          <X size={15} />
        </button>
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-gold">
          Step {step + 1} of {STEPS.length}
        </p>
        <h3 className="mt-1 text-lg font-bold text-foreground">{s.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-text-dim">{s.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <span key={i} className={`h-1.5 w-5 rounded-full ${i <= step ? 'bg-gold' : 'bg-surface3'}`} />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <Button size="sm" variant="outline" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
            <Button size="sm" onClick={() => (last ? finish() : setStep(step + 1))}>
              {last ? 'Done' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function WhatsNewModal() {
  const userId = useAuthStore((s) => s.user?.id)
  const { whatsNewOpen, setWhatsNewOpen } = useShellUi()
  const close = () => {
    userFlag.set(userId, 'whats-new', WHATS_NEW_VERSION)
    setWhatsNewOpen(false)
  }
  return (
    <Modal isOpen={whatsNewOpen} onClose={close} title="What's new" description={`Release ${WHATS_NEW_VERSION}`}>
      <ul className="space-y-3">
        {WHATS_NEW.map((n) => (
          <li key={n.title} className="rounded-xl border border-border bg-surface2 p-3">
            <p className="text-sm font-semibold text-foreground">{n.title}</p>
            <p className="mt-0.5 text-sm text-text-dim">{n.body}</p>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex justify-end">
        <Button onClick={close}>Got it</Button>
      </div>
    </Modal>
  )
}
